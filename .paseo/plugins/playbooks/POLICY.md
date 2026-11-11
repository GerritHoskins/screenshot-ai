# Implementation workflow contract

This is one bounded task per run. Follow applicable AGENTS.md and the assigned package's
scope, evidence conventions and acceptance checks. A free-text request must become a
specific plan before implementation. Do not continue automatically to the next package.

## Human decisions
1. The first gate approves the investigation scope, workspace, task and profile mapping.
2. Investigation reports the actual baseline, candidate files and exact verification commands.
3. The plan gate approves the edit scope, checks, and each named baseline-failure exception.
4. Required live checks need a separate, explicit approval of exact commands, data, destination,
   costs and duration. A declined required check is incomplete, never passed.
5. Independent review precedes publication. Final review in Paseo follows the draft PR
   (or the local evidence bundle for Avatar). Final approval does not authorize merging,
   deployment, media publication, releases or marking unrelated work Done.

Gate decisions must come from a human in the panel or an unambiguous human chat reply.
The manager must never infer approval from silence or call resume on its own behalf.
Gate details must include evidence, scope and consequences, not just a generic question.

## Scope and permissions
Offline checks with synthetic fixtures and existing dependencies may run automatically.
Inspect unfamiliar test entry points first. Do not indiscriminately run test_*.py files.
No real microphone/screen capture, device interaction, provider calls, downloads, database
resets or media overwrites without the relevant exact approval. Local disposable test
databases may be used only after verifying their destination and the approved plan.
Installing locked dependencies in a fresh environment must be included in approved scope;
changing dependencies, lockfiles, snapshots or generated tracked files needs explicit approval.
Never weaken a test, security boundary, coverage floor or budget to manufacture a pass.
For every non-failure report, return all declared outputs, including on blocked outcomes.
Use an explicit 'not-produced: <reason>' string where no artifact exists; never invent one.
Do not read or include private recordings, knowledge bundles, secrets or credentials in
agent prompts, artifacts or PR text. Use synthetic substitutes. Read a token only through
its normal authenticated client, without printing it. Never invent evidence.

## Isolation and evidence
Use the built-in Start menu to choose current workspace or a new worktree.
For a new worktree, the configuration and package must exist in the selected base commit;
inspect that base explicitly before launch. Existing uncommitted changes are not copied.
Current-checkout mode requires a clean index and no overlap between approved paths and
pre-existing dirty files. On overlap, pause and request a fresh worktree; never stash,
reset, clean, discard, stage or commit unrelated changes.
Record all runtime evidence under runs/<run-id>/ inside this playbooks folder (ignored).
Preserve repository-owned handoffs/manifests when required; list them in approved scope.
The source guard is a drift check, not a security sandbox or proof of human approval.
A snapshot freezes evidence identity; it cannot prove that an agent's report is truthful.
Preserve exact command, cwd, exit code, test counts, relevant output and native/live limits.

## Review and publication
A fresh reviewer checks actual files and evidence. A reviewer cannot grant human authority.
At most two automatic implementation/review repair cycles are allowed. The plugin's
loop-limit gate requires a human decision before more work; no manager self-approval.
A changed scope or baseline requires a new investigation/plan approval and a new run.
The seven Git projects may commit the reviewed files, push a playbooks/* task branch and
create/update a draft PR after checks and review pass. No force-push, direct default-branch
push, merge or deployment. Verify remote owner/repository and base before any push.
If authentication is unavailable, pause; do not create credentials or change account settings.
Publish a minimal evidence summary, not raw local run files, logs or private source context.
Avatar has no Git actions. Its finish is a local handoff and human acceptance.

## Launch settings
Profiles are materialized launch settings, not live references. profiles.json records the
approved profile snapshot; a changed Paseo profile does not automatically update these files.
The manager follows Coordinator; investigator is a separate Coordinator session.
Implementer/verifier/publisher use Implementer A; reviewer uses Reviewer.
Use tools/configure_agents.py for explicit role overrides before a run, or edit the
agent object in a role.yaml (these files use JSON syntax, which is valid YAML).
Do not change models mid-run silently. Validate provider/model/mode availability before launch.
Changing a profile's permissions never bypasses the gates or authorizes external side effects.
