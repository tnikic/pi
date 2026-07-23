#!/usr/bin/env bash
# Setup a temporary GitHub repo for smoke testing.
# Usage:
#   source agent/extensions/issue-tracker/smoke/setup-github.sh
#   github_smoke_setup
#   npx tsx --test agent/extensions/issue-tracker/smoke/github-smoke.test.ts
#   github_smoke_teardown
#
# Or run the full smoke test in one shot:
#   agent/extensions/issue-tracker/smoke/setup-github.sh --run

set -euo pipefail

GITHUB_API="${GITHUB_API:-https://api.github.com}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
REPO_OWNER="${REPO_OWNER:-}"
REPO_NAME="${REPO_NAME:-smoke-test-$(date +%s)}"

# ─── helpers ────────────────────────────────────────────────────

_gh_api() {
	local method="$1" path="$2" body="${3:-}"
	local url="${GITHUB_API}${path}"
	if [ -n "$body" ]; then
		curl -s -X "$method" "$url" \
			-H "Authorization: Bearer ${GITHUB_TOKEN}" \
			-H "Accept: application/vnd.github+json" \
			-H "X-GitHub-Api-Version: 2022-11-28" \
			-H "Content-Type: application/json" \
			-d "$body"
	else
		curl -s -X "$method" "$url" \
			-H "Authorization: Bearer ${GITHUB_TOKEN}" \
			-H "Accept: application/vnd.github+json" \
			-H "X-GitHub-Api-Version: 2022-11-28"
	fi
}

# ─── setup ──────────────────────────────────────────────────────

github_smoke_setup() {
	if [ -z "${GITHUB_TOKEN}" ]; then
		echo "ERROR: GITHUB_TOKEN is not set. Create one at:" >&2
		echo "  https://github.com/settings/tokens" >&2
		echo "Required scopes: repo (full private repo access), or at least:" >&2
		echo "  - repo:status, repo_deployment, public_repo" >&2
		echo "For fine-grained tokens also: issues:read+write, metadata:read" >&2
		return 1
	fi

	# Verify token works and get username
	echo "=== Verifying token..."
	USER_RESPONSE=$(_gh_api GET /user)
	REPO_OWNER=$(echo "${USER_RESPONSE}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('login',''))" 2>/dev/null)
	if [ -z "${REPO_OWNER}" ]; then
		echo "ERROR: Failed to authenticate with GitHub. Response: ${USER_RESPONSE}" >&2
		return 1
	fi
	echo "Authenticated as: ${REPO_OWNER}"

	# Create test repo
	echo "=== Creating test repo: ${REPO_NAME}"
	CREATE_RESPONSE=$(_gh_api POST /user/repos \
		"{\"name\":\"${REPO_NAME}\",\"private\":true,\"auto_init\":true}")
	REPO_FULL=$(echo "${CREATE_RESPONSE}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('full_name',''))" 2>/dev/null)
	if [ -z "${REPO_FULL}" ]; then
		# Repo might already exist — check and use it
		REPO_FULL="${REPO_OWNER}/${REPO_NAME}"
		echo "Repo may already exist, using: ${REPO_FULL}"
	else
		echo "Created repo: ${REPO_FULL}"
	fi

	# Enable issues on the repo (should be on by default, but just in case)
	_gh_api PATCH "/repos/${REPO_FULL}" '{"has_issues":true}' > /dev/null 2>&1 || true

	export GITHUB_TOKEN
	export GITHUB_OWNER="${REPO_OWNER}"
	export GITHUB_REPO="${REPO_NAME}"

	echo ""
	echo "=== GitHub smoke test repo ready ==="
	echo "export GITHUB_TOKEN=<your-token>"
	echo "export GITHUB_OWNER=${REPO_OWNER}"
	echo "export GITHUB_REPO=${REPO_NAME}"
	echo ""
}

# ─── teardown ───────────────────────────────────────────────────

github_smoke_teardown() {
	if [ -z "${GITHUB_TOKEN:-}" ] || [ -z "${GITHUB_OWNER:-}" ] || [ -z "${GITHUB_REPO:-}" ]; then
		echo "Nothing to tear down (missing token/owner/repo)."
		return 0
	fi
	echo "=== Deleting test repo: ${GITHUB_OWNER}/${GITHUB_REPO}"
	DELETE_RESPONSE=$(_gh_api DELETE "/repos/${GITHUB_OWNER}/${GITHUB_REPO}")
	if echo "${DELETE_RESPONSE}" | grep -q '"message"'; then
		echo "Warning: Could not delete repo (may need delete_repo scope): $(echo ${DELETE_RESPONSE} | python3 -c "import sys,json; print(json.load(sys.stdin).get('message',''))" 2>/dev/null || echo "unknown error")"
		echo "Manual cleanup: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/settings#danger-zone"
	else
		echo "Done."
	fi
}

# ─── run mode ───────────────────────────────────────────────────

if [ "${1:-}" = "--run" ]; then
	trap github_smoke_teardown EXIT
	github_smoke_setup || exit 1
	echo "=== Running smoke tests..."
	GITHUB_TOKEN="${GITHUB_TOKEN}" \
		GITHUB_OWNER="${GITHUB_OWNER}" \
		GITHUB_REPO="${GITHUB_REPO}" \
		npx tsx --test agent/extensions/issue-tracker/smoke/github-smoke.test.ts
	echo "=== Smoke tests complete"
fi
