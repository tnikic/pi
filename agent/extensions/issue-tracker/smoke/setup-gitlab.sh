#!/usr/bin/env bash
# Setup a temporary GitLab CE instance in Podman for smoke testing.
# Usage:
#   source agent/extensions/issue-tracker/smoke/setup-gitlab.sh
#   gitlab_smoke_setup
#   npx tsx --test agent/extensions/issue-tracker/smoke/gitlab-smoke.test.ts
#   gitlab_smoke_teardown
#
# Or run the full smoke test in one shot:
#   agent/extensions/issue-tracker/smoke/setup-gitlab.sh --run

set -euo pipefail

CONTAINER_NAME="pi-gitlab-smoke"
GITLAB_PORT="${GITLAB_PORT:-9980}"
GITLAB_IMAGE="${GITLAB_IMAGE:-gitlab/gitlab-ce:latest}"
ADMIN_USER="${ADMIN_USER:-root}"
ADMIN_PASS="${ADMIN_PASS:-ci-password}"
ADMIN_EMAIL="${ADMIN_EMAIL:-ci@test.local}"
REPO_NAME="${REPO_NAME:-smoke-test}"
GITLAB_URL="http://localhost:${GITLAB_PORT}"
GITLAB_HOSTNAME="${GITLAB_HOSTNAME:-localhost}"

# ─── setup ──────────────────────────────────────────────────────

gitlab_smoke_setup() {
	echo "=== Pulling GitLab CE image: ${GITLAB_IMAGE}"
	podman pull "${GITLAB_IMAGE}"

	echo "=== Starting GitLab CE container on port ${GITLAB_PORT}"
	echo "    (This can take 3-5 minutes on first start)"
	podman run -d --name "${CONTAINER_NAME}" --rm \
		-p "${GITLAB_PORT}:${GITLAB_PORT}" \
		--hostname "${GITLAB_HOSTNAME}" \
		-e GITLAB_OMNIBUS_CONFIG="external_url '${GITLAB_URL}'; gitlab_rails['initial_root_password'] = '${ADMIN_PASS}'" \
		--memory 4096m \
		"${GITLAB_IMAGE}"

	echo "=== Waiting for GitLab to be healthy (this can take a few minutes)..."
	for i in $(seq 1 90); do
		if curl -s "${GITLAB_URL}/api/v4/version" > /dev/null 2>&1; then
			echo "GitLab is up!"
			break
		fi
		if [ "$i" -eq 90 ]; then
			echo "ERROR: GitLab did not start in time" >&2
			gitlab_smoke_teardown
			return 1
		fi
		echo -n "."
		sleep 5
	done

	echo ""
	echo "=== Creating access token"
	# GitLab API: create personal access token
	TOKEN_RESPONSE=$(curl -s -X POST "${GITLAB_URL}/api/v4/personal_access_tokens" \
		-u "${ADMIN_USER}:${ADMIN_PASS}" \
		-H "Content-Type: application/json" \
		-d '{"name": "smoke-test-token", "scopes": ["api", "read_user", "write_repository"]}')

	GITLAB_TOKEN=$(echo "${TOKEN_RESPONSE}" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)

	if [ -z "${GITLAB_TOKEN}" ]; then
		echo "ERROR: Failed to create token. Response: ${TOKEN_RESPONSE}" >&2
		gitlab_smoke_teardown
		return 1
	fi
	echo "Token: ${GITLAB_TOKEN:0:8}..."

	echo "=== Creating test repo: ${REPO_NAME}"
	curl -s -X POST "${GITLAB_URL}/api/v4/projects" \
		-H "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
		-H "Content-Type: application/json" \
		-d "{\"name\": \"${REPO_NAME}\", \"visibility\": \"private\"}" > /dev/null

	export GITLAB_URL
	export GITLAB_TOKEN
	export GITLAB_OWNER="${ADMIN_USER}"
	export GITLAB_REPO="${REPO_NAME}"

	echo ""
	echo "=== GitLab smoke instance ready ==="
	echo "export GITLAB_URL=${GITLAB_URL}"
	echo "export GITLAB_TOKEN=${GITLAB_TOKEN}"
	echo "export GITLAB_OWNER=${ADMIN_USER}"
	echo "export GITLAB_REPO=${REPO_NAME}"
	echo ""
}

# ─── teardown ───────────────────────────────────────────────────

gitlab_smoke_teardown() {
	echo "=== Tearing down GitLab container"
	podman stop "${CONTAINER_NAME}" 2>/dev/null || true
	podman rm -f "${CONTAINER_NAME}" 2>/dev/null || true
	echo "Done."
}

# ─── run mode ───────────────────────────────────────────────────

if [ "${1:-}" = "--run" ]; then
	trap gitlab_smoke_teardown EXIT
	gitlab_smoke_setup
	echo "=== Running smoke tests..."
	GITLAB_URL="${GITLAB_URL}" GITLAB_TOKEN="${GITLAB_TOKEN}" \
		GITLAB_OWNER="${ADMIN_USER}" GITLAB_REPO="${REPO_NAME}" \
		npx tsx --test agent/extensions/issue-tracker/smoke/gitlab-smoke.test.ts
	echo "=== Smoke tests complete"
fi
