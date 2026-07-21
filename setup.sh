#!/bin/bash
set -e

PI_ROOT="$(cd "$(dirname "$0")" && pwd)"
CONTAINERS_DIR="$PI_ROOT/containers/searxng"
SETTINGS_FILE="$CONTAINERS_DIR/settings.yml"
CONFIG_FILE="$PI_ROOT/config.json"
CONTAINER_NAME="pi-searxng"

echo "=== pi setup ==="

# 1. Install shared npm dependencies
echo "[1/4] Installing shared npm dependencies..."
cd "$PI_ROOT"
npm install

# 2. Install Playwright browser binaries
echo "[2/4] Installing Playwright browsers..."
npx playwright install chromium

# 3. Validate config.json
echo "[3/4] Validating config and generating SearXNG settings..."
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
echo "  config.json OK"

# 4. Generate settings.yml and recreate SearXNG container
echo "[4/4] Setting up SearXNG..."

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
echo "  Generated $SETTINGS_FILE"

# Remove existing container if present
if podman ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^$CONTAINER_NAME$"; then
  echo "  Removing existing container $CONTAINER_NAME..."
  podman rm -f "$CONTAINER_NAME" > /dev/null 2>&1
fi

echo "  Creating container $CONTAINER_NAME on 127.0.0.1:$PORT..."
podman run -d \
  --name "$CONTAINER_NAME" \
  --restart=always \
  -p "127.0.0.1:$PORT:8080" \
  -v "$SETTINGS_FILE:/etc/searxng/settings.yml:ro" \
  docker.io/searxng/searxng:latest

echo ""
echo "=== Setup complete ==="
echo "SearXNG is running at http://127.0.0.1:$PORT"
echo "Run 'podman logs $CONTAINER_NAME' to check the container status"
