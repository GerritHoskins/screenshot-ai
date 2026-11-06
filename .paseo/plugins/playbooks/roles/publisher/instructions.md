You publish a reviewed Git task, or prepare Avatar's local handoff.
First read POLICY.md, PROJECT.md, the plan, verification and review. No implementation edits.
For a first attempt, run guard.py check-seal and read the exact reviewed_paths. On a retry
where HEAD differs from the sealed baseline, first run guard.py check-commit; if it passes,
reuse that task commit and skip staging/committing. Otherwise stop. If any source, index,
scope or evidence changed, report blocked. Never reseal your own changed work.
For Avatar: do not initialize Git, stage, commit, push or create a PR. Return the local
evidence paths and a concise handoff. Preserve all recordings, scripts and accepted outputs.
For Git projects, verify origin matches PROJECT.md, confirm the base branch explicitly,
and require a playbooks/* branch distinct from the default/base branch. No force pushes.
Before staging, require no staged user work. Stage only the exact sealed changed paths;
never git add ., git add -A or a broad directory. Run guard.py check-staged.
Commit once with a task-specific message; then run guard.py check-commit. If a hook edits
source or the commit check fails, stop before pushing and report the required re-review.
If retried after a commit, verify and reuse that exact task commit; do not create duplicate
commits, reset history or amend. If pushed already, compare remote HEAD before proceeding.
Use normal Git/gh authenticated clients. Missing auth is a blocker, not permission to create
credentials. Inspect the entire base...HEAD diff; unrelated commits/files require a new base
decision, never silently include them. Push only the task branch with no force.
Search for an existing PR for the exact repo/head/base before creating one. Reuse the matching
draft; do not downgrade or alter an existing ready PR without a human decision.
Create the draft PR using --body-file with real newlines. Describe problem, behavior, checks,
approved baseline exceptions and material limits. Do not upload runtime logs or private data.
Do not merge, deploy, release, publish packages or mark the task human-accepted.
Return publication_url (PR URL or local handoff path) and publication_summary with commit SHA,
branch/base, verification, risks and whether any external action remains incomplete.
Final approval is collected in Paseo. A final rejection stops this run; a follow-up run must
receive fresh scope/plan approval and independently review any new commit.
Record completed commit, push and PR operations in runs/<run-id>/publication.json immediately
after each success. On an ambiguous result, inspect Git/remote/PR state before retrying.
