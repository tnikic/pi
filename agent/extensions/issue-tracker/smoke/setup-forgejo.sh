#!/usr/bin/env bash
# Setup a temporary Forgejo instance in Podman for smoke testing.
# Usage:
#   source agent/extensions/issue-tracker/smoke/setup-forgejo.sh
#   forgejo_smoke_setup
#   npx tsx --test agent/extensions/issue-tracker/smoke/forgejo-smoke.test.ts
#   forgejo_smoke_teardown
#
# Or run the full smoke test in one shot:
#   agent/extensions/issue-tracker/smoke/setup-forgejo.sh --run

set -euo pipefail

CONTAINER_NAME="pi-forgejo-smoke"
FORGEJO_PORT="${FORGEJO_PORT:-9876}"
FORGEJO_IMAGE="${FORGEJO_IMAGE:-codeberg.org/forgejo/forgejo:16.0}"
ADMIN_USER="${ADMIN_USER:-ci}"
ADMIN_PASS="${ADMIN_PASS:-ci-password}"
ADMIN_EMAIL="${ADMIN_EMAIL:-ci@test.local}"
REPO_NAME="${REPO_NAME:-smoke-test}"
FORGEJO_URL="http://localhost:${FORGEJO_PORT}"

# ─── setup ──────────────────────────────────────────────────────

forgejo_smoke_setup() {
	echo "=== Pulling Forgejo image: ${FORGEJO_IMAGE}"
	podman pull "${FORGEJO_IMAGE}"

	echo "=== Starting Forgejo container on port ${FORGEJO_PORT}"
	podman run -d --name "${CONTAINER_NAME}" --rm \
		-p "${FORGEJO_PORT}:3000" \
		-e FORGEJO__security__INSTALL_LOCK=true \
		"${FORGEJO_IMAGE}"

	echo "=== Waiting for Forgejo to be healthy..."
	for i in $(seq 1 30); do
		if curl -s "${FORGEJO_URL}/api/v1/version" > /dev/null 2>&1; then
			echo "Forgejo is up!"
			break
		fi
		if [ "$i" -eq 30 ]; then
			echo "ERROR: Forgejo did not start in time" >&2
			forgejo_smoke_teardown
			return 1
		fi
		sleep 2
	done

	echo "=== Creating admin user"
	podman exec -u 1000 "${CONTAINER_NAME}" \
		forgejo admin user create \
			--admin \
			--username "${ADMIN_USER}" \
			--password "${ADMIN_PASS}" \
			--email "${ADMIN_EMAIL}" \
			--must-change-password=false

	echo "=== Creating access token"
	TOKEN_RESPONSE=$(curl -s -X POST "${FORGEJO_URL}/api/v1/users/${ADMIN_USER}/tokens" \
		-u "${ADMIN_USER}:${ADMIN_PASS}" \
		-H "Content-Type: application/json" \
		-d '{"name": "smoke-test-token", "scopes": ["all"]}')
	FORGEJO_TOKEN=$(echo "${TOKEN_RESPONSE}" | grep -o '"sha1":"[^"]*"' | head -1 | cut -d'"' -f4)

	if [ -z "${FORGEJO_TOKEN}" ]; then
		echo "ERROR: Failed to create token. Response: ${TOKEN_RESPONSE}" >&2
		forgejo_smoke_teardown
		return 1
	fi
	echo "Token: ${FORGEJO_TOKEN:0:8}..."

	echo "=== Creating test repo: ${REPO_NAME}"
	curl -s -X POST "${FORGEJO_URL}/api/v1/user/repos" \
		-H "Authorization: token ${FORGEJO_TOKEN}" \
		-H "Content-Type: application/json" \
		-d "{\"name\": \"${REPO_NAME}\", \"private\": false}" > /dev/null

	export FORGEJO_URL
	export FORGEJO_TOKEN
	export FORGEJO_OWNER="${ADMIN_USER}"
	export FORGEJO_REPO="${REPO_NAME}"

	echo ""
	echo "=== Forgejo smoke instance ready ==="
	echo "export FORGEJO_URL=${FORGEJO_URL}"
	echo "export FORGEJO_TOKEN=${FORGEJO_TOKEN}"
	echo "export FORGEJO_OWNER=${ADMIN_USER}"
	echo "export FORGEJO_REPO=${REPO_NAME}"
	echo ""
}

# ─── teardown ───────────────────────────────────────────────────

forgejo_smoke_teardown() {
	echo "=== Tearing down Forgejo container"
	podman stop "${CONTAINER_NAME}" 2>/dev/null || true
	podman rm -f "${CONTAINER_NAME}" 2>/dev/null || true
	echo "Done."
}

# ─── run mode ───────────────────────────────────────────────────

if [ "${1:-}" = "--run" ]; then
	trap forgejo_smoke_teardown EXIT
	forgejo_smoke_setup
	echo "=== Running smoke tests..."
	FORGEJO_URL="${FORGEJO_URL}" FORGEJO_TOKEN="${FORGEJO_TOKEN}" \
		FORGEJO_OWNER="${ADMIN_USER}" FORGEJO_REPO="${REPO_NAME}" \
		npx tsx --test agent/extensions/issue-tracker/smoke/forgejo-smoke.test.ts
	echo "=== Smoke tests complete"
fi
