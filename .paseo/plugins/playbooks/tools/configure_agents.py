"""Set one role's launch settings from the saved profile catalog or explicit values."""
import argparse
import json
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--role', required=True, choices=['manager', 'investigator', 'implementer', 'verifier', 'reviewer', 'publisher'])
    parser.add_argument('--profile')
    parser.add_argument('--provider')
    parser.add_argument('--model')
    parser.add_argument('--mode')
    parser.add_argument('--thinking')
    parser.add_argument('--apply', action='store_true', help='Write after inspecting the default dry-run output')
    args = parser.parse_args()
    filename = BASE / ('defaults/main.yaml' if args.role == 'manager' else f'roles/{args.role}/role.yaml')
    document = json.loads(filename.read_text(encoding='utf-8-sig'))
    key = 'manager' if args.role == 'manager' else 'agent'
    settings = dict(document.get(key, {}))
    if args.profile:
        profiles = json.loads((BASE / 'profiles.json').read_text(encoding='utf-8'))['profiles']
        matches = [p for p in profiles if args.profile in (p['name'], p['id'])]
        if len(matches) != 1:
            parser.error('Profile must match exactly one saved name or id')
        profile = matches[0]
        if profile.get('featureValues'):
            parser.error('This Playbooks version cannot pass featureValues; do not silently omit them')
        settings = {target: profile[source] for source, target in [('provider', 'provider'), ('model', 'model'), ('modeId', 'mode'), ('thinkingOptionId', 'thinking')] if profile.get(source)}
    if args.provider and args.provider != settings.get('provider') and not args.model:
        parser.error('Changing provider requires an explicit model')
    if args.provider and args.provider != settings.get('provider'):
        settings = {}
    for field in ('provider', 'model', 'mode', 'thinking'):
        if getattr(args, field):
            settings[field] = getattr(args, field)
    if not settings.get('provider') or not settings.get('model'):
        parser.error('Provider and model are required')
    document[key] = settings
    print(json.dumps({'file': str(filename), 'settings': settings, 'applied': args.apply}, indent=2))
    if args.apply:
        filename.write_text(json.dumps(document, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
