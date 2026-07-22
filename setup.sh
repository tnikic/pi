#!/bin/bash
set -e

PI_ROOT="$(cd "$(dirname "$0")" && pwd)"
CONTAINERS_DIR="$PI_ROOT/containers/searxng"
SETTINGS_FILE="$CONTAINERS_DIR/settings.yml"
CONFIG_FILE="$PI_ROOT/config.json"
CONTAINER_NAME="pi-searxng"

echo "=== pi setup ==="

# 0. Enable Podman services (restart on reboot, auto-update images)
systemctl --user enable --now podman-restart.service podman-auto-update.timer 2>/dev/null || true

# 1. Install shared npm dependencies
echo "[1/5] Installing shared npm dependencies..."
cd "$PI_ROOT"
npm install --quiet > /dev/null 2>&1

# 2. Install Playwright browser binaries
echo "[2/5] Installing Playwright browsers..."
npx playwright install chromium > /dev/null 2>&1

# 3. Validate config.json
echo "[3/5] Validating config..."
if [ ! -f "$CONFIG_FILE" ]; then
  echo "  ERROR: $CONFIG_FILE not found. This file must be present in the repository."
  echo "  Clone the repository again or restore config.json from source control."
  exit 1
fi

# Read and validate both port and secretKey in a single Node invocation
eval $(node -e "
  const fs = require('fs');
  const config = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
  if (!config.searxng?.secretKey) throw new Error('Missing searxng.secretKey');
  if (!config.searxng?.port) throw new Error('Missing searxng.port');
  console.log('SECRET_KEY=' + JSON.stringify(config.searxng.secretKey));
  console.log('PORT=' + config.searxng.port);
")

# 4. Generate settings.yml and recreate SearXNG container
echo "[4/5] Setting up SearXNG container..."

mkdir -p "$CONTAINERS_DIR"
cat > "$SETTINGS_FILE" <<YAML
use_default_settings: true

search:
  formats:
    - html
    - json

server:
  secret_key: "${SECRET_KEY}"
  bind_address: "127.0.0.1"
YAML

# Remove existing container if present
if podman ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^$CONTAINER_NAME$"; then
  podman rm -f "$CONTAINER_NAME" > /dev/null 2>&1
  podman volume prune -f > /dev/null 2>&1
fi

podman run -d \
  --name "$CONTAINER_NAME" \
  --restart=always \
  --label "io.containers.autoupdate=registry" \
  -p "127.0.0.1:$PORT:8080" \
  -v "$SETTINGS_FILE:/etc/searxng/settings.yml:ro" \
  docker.io/searxng/searxng:latest > /dev/null 2>&1

# 5. Wait for SearXNG to be ready
echo "[5/5] Waiting for SearXNG to be ready..."
MAX_WAIT=30
ATTEMPT=0
while [ $ATTEMPT -lt $MAX_WAIT ]; do
  if curl -sf -o /dev/null "http://127.0.0.1:$PORT/healthz" 2>/dev/null; then
    echo ""
    echo "=== Setup complete ==="
    echo "SearXNG is running at http://127.0.0.1:$PORT"
    echo "Run 'podman logs $CONTAINER_NAME' to check the container status"
    exit 0
  fi
  ATTEMPT=$((ATTEMPT + 1))
  sleep 1
done

echo ""
echo "  ERROR: SearXNG did not become healthy within ${MAX_WAIT}s."
echo "  Check logs: podman logs $CONTAINER_NAME"
exit 1
