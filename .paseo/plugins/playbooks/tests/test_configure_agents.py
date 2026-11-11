import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

COMMON = Path(__file__).resolve().parents[1]


class ConfigureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='playbooks-profile-test-')
        self.root = Path(self.temp.name)
        shutil.copytree(COMMON, self.root, dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__'))

    def tearDown(self):
        self.temp.cleanup()

    def run_tool(self, *args, ok=True):
        result = subprocess.run([sys.executable, str(self.root/'tools/configure_agents.py'), *args], capture_output=True, text=True)
        self.assertEqual(result.returncode == 0, ok, result.stderr)
        return json.loads(result.stdout) if ok else result.stderr

    def test_default_dry_run_preserves_file(self):
        p=self.root/'roles/implementer/role.yaml';before=p.read_bytes()
        result=self.run_tool('--role','implementer','--profile','Implementer B')
        self.assertFalse(result['applied']);self.assertEqual(result['settings']['thinking'],'high')
        self.assertEqual(p.read_bytes(),before)

    def test_apply_preserves_role_contract(self):
        p=self.root/'roles/reviewer/role.yaml';before=json.loads(p.read_text())
        self.run_tool('--role','reviewer','--profile','Second Opinion','--apply')
        after=json.loads(p.read_text());self.assertEqual(after['agent']['provider'],'codex')
        self.assertEqual({k:v for k,v in before.items() if k!='agent'},{k:v for k,v in after.items() if k!='agent'})

    def test_manager_mapping(self):
        result=self.run_tool('--role','manager','--profile','Coordinator','--apply')
        p=self.root/'defaults/main.yaml'
        self.assertEqual(json.loads(p.read_text())['manager'],result['settings'])

    def test_provider_switch_needs_model(self):
        self.assertIn('requires an explicit model',self.run_tool('--role','reviewer','--provider','codex',ok=False))

    def test_provider_switch_clears_old_settings(self):
        result=self.run_tool('--role','reviewer','--provider','codex','--model','test-model')
        self.assertEqual(result['settings'],{'provider':'codex','model':'test-model'})

    def test_unknown_profile_rejected(self):
        self.run_tool('--role','reviewer','--profile','unknown',ok=False)

    def test_role_traversal_rejected(self):
        self.run_tool('--role','../escape','--profile','Coordinator',ok=False)


if __name__ == '__main__':
    unittest.main(verbosity=2)
