#!/usr/bin/env bash
# One-time repository setup (needs admin rights on the repo and an authenticated `gh`):
# protects `main` so nothing reaches it without passing CI, and nobody can rewrite its history.
#
#   ./infra/scripts/protect-main.sh [owner/repo]        # defaults to the current repository
#
# What it enforces on `main`:
#   * both CI jobs must pass, on a branch that is up to date with main  -> a failing test blocks the merge
#   * force-pushes and branch deletion are refused, for administrators too
# Run it again after renaming a CI job: the names below must match the `name:` of the jobs in
# .github/workflows/ci.yml. To allow an emergency bypass for admins, set "enforce_admins" to false.
set -euo pipefail

REPO="${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"

gh api --method PUT "repos/${REPO}/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Lint, typecheck, test, build",
      "Secret scan and dependency audit"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON

echo "Branch protection enabled on ${REPO}:main"
