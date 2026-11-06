"""Local, dependency-free change/evidence guard. Never stages, commits or uses network."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

HOME = Path(__file__).resolve().parents[1]
ROOT = HOME.parents[2]
RUNTIME = '.paseo/plugins/playbooks/runs/'
IGNORE = {'.git', '.venv', 'node_modules', '__pycache__', '_stage_tmp'}


def fail(message):
    raise ValueError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git(*args):
    result = subprocess.run(['git', '-C', str(ROOT), *args], capture_output=True)
    if result.returncode:
        fail('Git check failed: ' + ' '.join(args[:2]))
    return result.stdout


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')


def safe(relative):
    value = relative.replace('\\', '/')
    if not value or value.startswith('/') or ':' in value or '..' in value.split('/'):
        fail('Expected a repository-relative path without traversal')
    candidate = ROOT / value
    if not candidate.resolve().is_relative_to(ROOT.resolve()):
        fail('Path escapes repository')
    cursor = candidate
    while cursor != ROOT:
        if cursor.is_symlink():
            fail('Symlink/reparse paths require separate review')
        cursor = cursor.parent
    return value


def sensitive(name):
    parts = name.lower().replace('\\', '/').split('/')
    return any(p in {'.git', '.env', '.ssh', 'credentials', 'secrets'} or p.startswith('.env.') for p in parts) or name.lower().endswith(('.pem', '.key', '.p12', '.pfx'))


def snapshot():
    config = read(HOME / 'project.json')
    is_git = config['git']
    files, protected = {}, {}
    if is_git:
        root = git('rev-parse', '--show-toplevel').decode().strip()
        if Path(root).resolve() != ROOT.resolve():
            fail('Unexpected Git root')
        names = git('ls-files', '--cached', '--others', '--exclude-standard', '-z').decode('utf-8').split('\0')
    else:
        names = []
        for directory, dirs, leaves in os.walk(ROOT):
            dirs[:] = [d for d in dirs if d not in IGNORE and not (Path(directory) / d).is_symlink()]
            for name in leaves:
                p = Path(directory) / name
                rel = p.relative_to(ROOT).as_posix()
                if rel.startswith(RUNTIME):
                    continue
                if any(rel == item or rel.startswith(item + '/') for item in config.get('protected_paths', [])) or p.suffix.lower() in {'.wav', '.mp3', '.mp4', '.png', '.jpg'}:
                    stat = p.stat()
                    protected[rel] = [stat.st_size, stat.st_mtime_ns]
                else:
                    names.append(rel)
    for name in sorted(set(names)):
        if not name or name.startswith(RUNTIME):
            continue
        name = safe(name)
        p = ROOT / name
        if p.is_file():
            files[name] = [digest(p), p.stat().st_mode & 0o777]
        elif p.exists():
            fail('Unsupported file type in source inventory')
    result = {'files': files, 'protected': protected}
    if is_git:
        result['head'] = git('rev-parse', 'HEAD').decode().strip()
        result['index'] = hashlib.sha256(git('ls-files', '--stage', '-z')).hexdigest()
    return result


def changed(a, b):
    return sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))


def state(run):
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', run):
        fail('Invalid run id')
    directory = HOME / 'runs' / run
    if directory.is_symlink() or directory.parent.is_symlink() or not directory.resolve().is_relative_to(HOME.resolve()):
        fail('Runtime directory must not be a symlink')
    return directory


def capture(directory):
    if (directory / 'baseline.json').exists():
        fail('Baseline exists; reuse it, do not recapture after edits')
    baseline = snapshot()
    if read(HOME / 'project.json')['git']:
        if git('diff', '--cached', '--name-only', '-z'):
            fail('Index already contains staged work; use a fresh worktree')
        dirty = git('diff', '--name-only', '-z').decode().split('\0')
        untracked = git('ls-files', '--others', '--exclude-standard', '-z').decode().split('\0')
        baseline['preexisting'] = [n for n in dirty + untracked if n and not n.startswith(RUNTIME)]
    else:
        baseline['preexisting'] = []
    save(directory / 'baseline.json', baseline)
    return {'captured': True, 'preexisting_count': len(baseline['preexisting'])}


def set_scope(directory, filename):
    if (directory / 'scope.json').exists():
        fail('Scope exists; a changed plan requires a new run and approval')
    scope = read(Path(filename))
    allowed = scope.get('allowed_paths')
    if not isinstance(allowed, list) or not allowed or any(not isinstance(p, str) for p in allowed):
        fail('allowed_paths must be a nonempty list of exact relative file paths')
    allowed = [safe(p) for p in allowed]
    baseline = read(directory / 'baseline.json')
    protected = read(HOME / 'project.json').get('protected_paths', [])
    for name in allowed:
        if sensitive(name) or name.startswith(RUNTIME) or any(name == p or name.startswith(p + '/') for p in protected):
            fail('Scope includes a protected or secret path')
        if name in baseline['preexisting']:
            fail('Scope overlaps pre-existing changes; use a clean worktree')
        if any(c in name for c in '*?['):
            fail('Scope must list exact paths, not patterns')
    if snapshot() != {k: v for k, v in baseline.items() if k != 'preexisting'}:
        fail('Source changed since investigation; investigate again in a new run')
    exceptions = scope.get('baseline_exceptions', [])
    if not isinstance(exceptions, list) or any(not isinstance(x, str) for x in exceptions):
        fail('baseline_exceptions must list explicitly approved check ids')
    checks = scope.get('check_plan', [])
    ids = [item.get('id') for item in checks if isinstance(item, dict)]
    if not ids or len(ids) != len(checks) or any(not isinstance(i, str) or not i for i in ids) or len(set(ids)) != len(ids):
        fail('check_plan must contain unique nonempty required check ids')
    if set(exceptions) - set(ids):
        fail('Baseline exceptions must belong to approved checks')
    save(directory / 'scope.json', {'allowed_paths': sorted(set(allowed)), 'baseline_exceptions': exceptions, 'required_check_ids': ids})
    return {'scope_recorded': True}


def check(directory):
    baseline, scope, current = read(directory / 'baseline.json'), read(directory / 'scope.json'), snapshot()
    if baseline.get('head') != current.get('head') or baseline.get('index') != current.get('index'):
        fail('HEAD or index changed before publication')
    if baseline['protected'] != current['protected']:
        fail('Protected local inputs or media changed')
    paths = changed(baseline['files'], current['files'])
    if set(paths) - set(scope['allowed_paths']):
        fail('Changes outside the approved scope')
    return current, paths


def evidence_ok(directory, filename):
    evidence = read(filename)
    scope = read(directory / 'scope.json')
    checks = evidence.get('checks', [])
    if not checks or evidence.get('status') not in ('passed', 'accepted_baseline_failures'):
        fail('Missing successful verification evidence')
    ids = [item.get('id') for item in checks]
    if len(set(ids)) != len(ids) or set(scope['required_check_ids']) - set(ids):
        fail('Missing or duplicate required verification checks')
    has_baseline_failure = False
    for item in checks:
        if type(item.get('exit_code')) is not int or not item.get('command') or not item.get('id') or not item.get('result'):
            fail('Each check needs id, command, exit_code and result')
        if item.get('classification') == 'passed' and item['exit_code'] == 0:
            continue
        if item.get('classification') == 'baseline_failure' and item['exit_code'] != 0 and item['id'] in scope['baseline_exceptions'] and item.get('unchanged_from_baseline') is True:
            has_baseline_failure = True
            continue
        fail('New, incomplete or unapproved failing check blocks publication')
    expected_status = 'accepted_baseline_failures' if has_baseline_failure else 'passed'
    if evidence['status'] != expected_status:
        fail('Overall status must disclose accepted baseline failures accurately')
    return evidence


def seal(directory, filename):
    if not filename.resolve().is_relative_to(directory.resolve()):
        fail('Verification evidence must belong to this run')
    current, paths = check(directory)
    evidence_ok(directory, filename)
    if not paths:
        fail('No task changes to seal')
    save(directory / 'seal.json', {'snapshot': current, 'paths': paths, 'evidence': str(filename.resolve()), 'evidence_hash': digest(filename), 'scope_hash': digest(directory / 'scope.json')})
    return {'sealed_paths': paths}


def verify_seal(directory, staged=False, committed=False):
    sealed = read(directory / 'seal.json')
    current = snapshot()
    if digest(Path(sealed['evidence'])) != sealed['evidence_hash'] or digest(directory / 'scope.json') != sealed['scope_hash']:
        fail('Evidence or scope changed after review')
    expected = sealed['snapshot']
    if current['files'] != expected['files'] or current['protected'] != expected['protected']:
        fail('Source changed after review')
    if committed:
        if git('rev-list', '--parents', '-n', '1', 'HEAD').decode().split()[1:] != [expected['head']]:
            fail('Expected exactly one new task commit')
        names = git('diff', '--name-only', expected['head'], 'HEAD', '-z').decode().split('\0')
        if sorted(n for n in names if n) != sealed['paths'] or git('diff', '--cached', '--name-only', '-z'):
            fail('Commit contents differ from reviewed paths or index is dirty')
        # Compare HEAD to the sealed working tree using Git's own clean-filter and
        # legacy-CRLF rules. A raw hash would reject valid Windows line endings.
        if git('diff', '--name-only', 'HEAD', '--', *sealed['paths']):
            fail('Committed content differs from reviewed working files')
    elif staged:
        if current.get('head') != expected.get('head'):
            fail('HEAD changed after review')
        names = git('diff', '--cached', '--name-only', '-z').decode().split('\0')
        if sorted(n for n in names if n) != sealed['paths']:
            fail('Staged paths differ from reviewed paths')
        if git('diff', '--name-only', '--', *sealed['paths']):
            fail('Staged content differs from reviewed working files')
    elif current != expected:
        fail('HEAD or index changed after review')
    return {'reviewed_paths': sealed['paths'], 'valid': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['capture', 'scope', 'check', 'seal', 'check-seal', 'check-staged', 'check-commit'])
    parser.add_argument('--run', required=True)
    parser.add_argument('--file')
    args = parser.parse_args()
    directory = state(args.run)
    if args.action == 'capture':
        result = capture(directory)
    elif args.action == 'scope':
        result = set_scope(directory, args.file)
    elif args.action == 'check':
        _, paths = check(directory)
        result = {'changed_paths': paths, 'valid': True}
    elif args.action == 'seal':
        result = seal(directory, Path(args.file))
    else:
        result = verify_seal(directory, args.action == 'check-staged', args.action == 'check-commit')
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError) as exc:
        print('BLOCKED: ' + str(exc), file=sys.stderr)
        sys.exit(1)
