# Implementation playbook

Requires Paseo >=0.14 and the installed Playbooks 0.23.1 format.
Read PROJECT.md for this project's checks and boundaries.

1. Open this repository in Paseo. Use the implementation card's Start menu:
   Start / Start on a new agent uses this checkout; Start in a new workspace uses a worktree.
   Avatar supports only the current local workspace.
2. Supply a request and/or a repository-relative task_file. Supply the intended PR base
   branch for Git projects. The launch path determines isolation; do not create a second
   worktree inside a running playbook. Commit the configuration separately before new-worktree
   launches, and ensure the desired task/package exists at the selected base.
3. Approve investigation scope. Review the investigation and approve the bounded plan,
   including any named, unchanged baseline failures. Rejection returns to investigation.
4. Implementation, verification and independent review run in order. Required live checks
   pause for permission. Review findings return to implementation, for at most two automatic
   repair cycles. A new scope requires a new run.
5. Git runs create a draft PR after review; Avatar produces a local handoff.
   Final review remains in Paseo. Acceptance does not merge or deploy.

## Role overrides

Run with an existing Python 3 interpreter (py -3.11 on this machine):
    py -3.11 .paseo/plugins/playbooks/tools/configure_agents.py --role implementer --profile "Implementer B"
Inspect the dry run, then repeat with --apply. For explicit settings:
    py -3.11 .paseo/plugins/playbooks/tools/configure_agents.py --role reviewer --provider codex --model <available-model> --mode <available-mode> --thinking high
The same --apply rule applies. For a provider change, specify a matching model and mode.
Use --role manager to update the new-manager default. Existing managers retain their own
settings. Role files are JSON-form YAML to allow dependency-free, lossless configuration.
Revalidate with validate_playbooks in Paseo after changes.

## Evidence and guard

Agents use tools/guard.py with --run <run-id>. It only reads Git/source state and writes
ignored runtime metadata; it never stages, commits, pushes or contacts a network.
Commands: capture, scope --file <scope-json>, check, seal --file <verification-json>,
check-seal, check-staged, check-commit. Run all commands from the repository root.
capture is write-once; scope is write-once. A restart reuses them and checks for drift.
The scope file must contain allowed_paths (exact relative files), check_plan (each required
check with a unique id), and baseline_exceptions (check ids explicitly approved at the plan
gate). No overlap with pre-existing dirty files. Every approved check must appear in evidence.
An evidence document contains status (passed or accepted_baseline_failures) and checks:
    {"id":"unit","command":"exact command","exit_code":0,"classification":"passed","result":"counts and evidence"}
An approved unchanged failure uses classification baseline_failure, its actual nonzero
exit code, and unchanged_from_baseline: true. Blocked/skipped required checks cannot seal.
The reviewer seals after reading evidence. The publisher verifies the seal, stages only its
listed paths, checks staged content, commits once, then checks the resulting commit.
If a hook edits reviewed source, stop and return to review. Never fix the seal silently.

Keep runs/ ignored. Commit the workflow, project guidance, tools and role definitions.
The hidden Hello workflow is retained only as an earlier demo where it already existed.

Local guard and profile-override regression tests (temporary synthetic repositories only):
    py -3.11 -m unittest discover -s .paseo/plugins/playbooks/tests -v
