import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'tools/guard.py'
spec = importlib.util.spec_from_file_location('guard', SOURCE)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='playbooks-guard-test-')
        self.root = Path(self.temp.name)
        guard.ROOT = self.root
        guard.HOME = self.root / '.paseo/plugins/playbooks'
        guard.HOME.mkdir(parents=True)
        (guard.HOME / 'project.json').write_text('{"git":true}', encoding='utf-8')
        (guard.HOME / '.gitignore').write_text('runs/\n', encoding='utf-8')
        (self.root / 'a.py').write_text('old\n', encoding='utf-8')
        (self.root / 'b.py').write_text('untouched\n', encoding='utf-8')
        for args in [('init',), ('config','user.name','Synthetic test'), ('config','user.email','fixture@example.invalid'), ('config','core.autocrlf','false'), ('add','.'), ('commit','-m','fixture')]:
            self.git(*args)
        self.directory = guard.state('run_test')

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        subprocess.run(['git','-C',str(self.root),*args], check=True, capture_output=True)

    def begin(self, allowed=None, exceptions=None):
        guard.capture(self.directory)
        p=self.directory/'input.json'
        p.write_text(json.dumps({'allowed_paths':allowed or ['a.py'], 'baseline_exceptions':exceptions or [], 'check_plan':[{'id':'unit'}]}), encoding='utf-8')
        guard.set_scope(self.directory, str(p))

    def evidence(self, classification='passed', exit_code=0, extra=None):
        p=self.directory/'verification.json'
        status = 'accepted_baseline_failures' if classification == 'baseline_failure' else 'passed'
        p.write_text(json.dumps({'status':status,'checks':[{'id':'unit','command':'synthetic tests','result':'1 test', 'classification':classification,'exit_code':exit_code, **(extra or {})}]}), encoding='utf-8')
        return p

    def edit(self):
        (self.root/'a.py').write_text('new\n', encoding='utf-8')

    def test_seal_exact_commit(self):
        self.begin();self.edit();guard.seal(self.directory,self.evidence())
        self.assertTrue(guard.verify_seal(self.directory)['valid'])
        self.git('add','a.py');guard.verify_seal(self.directory,staged=True)
        self.git('commit','-m','synthetic task');guard.verify_seal(self.directory,committed=True)

    def test_preexisting_dirty_file_rejected(self):
        self.edit()
        with self.assertRaisesRegex(ValueError,'pre-existing'):self.begin()

    def test_unrelated_dirty_file_preserved(self):
        (self.root/'b.py').write_text('user change\n',encoding='utf-8')
        self.begin();self.edit();guard.check(self.directory)
        (self.root/'b.py').write_text('overwritten\n',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'outside'):guard.check(self.directory)

    def test_stale_review_rejected(self):
        self.begin();self.edit();guard.seal(self.directory,self.evidence())
        (self.root/'a.py').write_text('newer\n',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'Source changed'):guard.verify_seal(self.directory)

    def test_deletion_commit(self):
        self.begin();(self.root/'a.py').unlink();guard.seal(self.directory,self.evidence())
        self.git('add','a.py');guard.verify_seal(self.directory,staged=True)
        self.git('commit','-m','synthetic deletion');guard.verify_seal(self.directory,committed=True)

    def test_line_ending_filters(self):
        self.git('config','core.autocrlf','true');self.begin()
        (self.root/'a.py').write_bytes(b'new\r\n');guard.seal(self.directory,self.evidence())
        self.git('add','a.py');guard.verify_seal(self.directory,staged=True)
        self.git('commit','-m','synthetic line endings');guard.verify_seal(self.directory,committed=True)

    def test_evidence_from_another_run_rejected(self):
        self.begin();self.edit();p=self.root/'outside-evidence.json';p.write_text('{}',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'belong'):guard.seal(self.directory,p)

    def test_new_unscoped_file_rejected(self):
        self.begin();(self.root/'extra.py').write_text('x',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'outside'):guard.check(self.directory)

    def test_staged_unrelated_file_rejected(self):
        self.git('add','a.py');self.edit();self.git('add','a.py')
        with self.assertRaisesRegex(ValueError,'staged work'):guard.capture(self.directory)

    def test_extra_staged_path_rejected(self):
        self.begin();self.edit();guard.seal(self.directory,self.evidence())
        self.git('add','a.py');(self.root/'b.py').write_text('bad',encoding='utf-8');self.git('add','b.py')
        with self.assertRaises(ValueError):guard.verify_seal(self.directory,staged=True)

    def test_baseline_capture_write_once(self):
        guard.capture(self.directory)
        with self.assertRaisesRegex(ValueError,'exists'):guard.capture(self.directory)

    def test_scope_write_once(self):
        self.begin()
        with self.assertRaisesRegex(ValueError,'exists'):guard.set_scope(self.directory,str(self.directory/'input.json'))

    def test_traversal_and_secrets_rejected(self):
        with self.assertRaises(ValueError):guard.safe('../outside')
        with self.assertRaises(ValueError):guard.state('../outside')
        self.assertTrue(guard.sensitive('.env.local'))
        with self.assertRaisesRegex(ValueError,'protected'):self.begin(['.env'])

    def test_unapproved_failures_rejected(self):
        self.begin();self.edit()
        with self.assertRaisesRegex(ValueError,'unapproved'):guard.seal(self.directory,self.evidence('baseline_failure',1,{'unchanged_from_baseline':True}))

    def test_approved_unchanged_baseline_failure(self):
        self.begin(exceptions=['unit']);self.edit()
        guard.seal(self.directory,self.evidence('baseline_failure',1,{'unchanged_from_baseline':True}))

    def test_incomplete_check_rejected(self):
        self.begin();self.edit()
        with self.assertRaises(ValueError):guard.seal(self.directory,self.evidence('blocked',0))

    def test_missing_required_check_rejected(self):
        self.begin();self.edit();p=self.evidence(extra={'id':'different'})
        with self.assertRaisesRegex(ValueError,'Missing'):guard.seal(self.directory,p)

    def test_baseline_failure_cannot_claim_passed(self):
        self.begin(exceptions=['unit']);self.edit();p=self.evidence('baseline_failure',1,{'unchanged_from_baseline':True})
        value=json.loads(p.read_text());value['status']='passed';p.write_text(json.dumps(value),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'Overall status'):guard.seal(self.directory,p)

    def test_wrong_committed_content_rejected(self):
        self.begin();self.edit();guard.seal(self.directory,self.evidence())
        (self.root/'a.py').write_text('unreviewed\n',encoding='utf-8');self.git('add','a.py')
        self.git('commit','-m','synthetic wrong content');self.edit()
        with self.assertRaisesRegex(ValueError,'Committed content'):guard.verify_seal(self.directory,committed=True)

    def test_evidence_drift_rejected(self):
        self.begin();self.edit();p=self.evidence();guard.seal(self.directory,p)
        p.write_text('{}',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'Evidence'):guard.verify_seal(self.directory)

    def test_source_drift_before_scope_rejected(self):
        guard.capture(self.directory);self.edit();p=self.directory/'input.json';p.write_text('{"allowed_paths":["a.py"]}',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'Source changed'):guard.set_scope(self.directory,str(p))

    def test_runtime_files_excluded(self):
        self.begin();(self.directory/'notes.txt').write_text('runtime only',encoding='utf-8')
        self.assertEqual(guard.check(self.directory)[1],[])

    def test_avatar_protected_media_metadata(self):
        (guard.HOME/'project.json').write_text('{"git":false,"protected_paths":["assets"]}',encoding='utf-8')
        (self.root/'assets').mkdir();media=self.root/'assets/private.wav';media.write_bytes(b'synthetic')
        self.begin();media.write_bytes(b'changed synthetic')
        with self.assertRaisesRegex(ValueError,'Protected'):guard.check(self.directory)


if __name__ == '__main__':
    unittest.main(verbosity=2)
