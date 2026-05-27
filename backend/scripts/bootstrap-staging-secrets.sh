#!/usr/bin/env bash
# Apply secrets to distill-api-staging from backend/.env and optional backend/.env.staging.
# Values are never printed. Fly-only keys (DATABASE_URL, EXTENSION_CORS_ORIGINS) often live
# only on production — add them to .env.staging (see env.staging.example).
set -euo pipefail

APP="distill-api-staging"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${1:-$ROOT/.env}"
STAGING_ENV="${2:-$ROOT/.env.staging}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy .env.example to .env and set secrets." >&2
  exit 1
fi

if ! command -v fly >/dev/null 2>&1; then
  echo "Install Fly CLI: https://fly.io/docs/hands-on/install-flyctl/" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
if [[ -f "$STAGING_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$STAGING_ENV"
fi
set +a

if [[ -z "${BACKEND_SECRET:-}" ]]; then
  echo "BACKEND_SECRET is required in $ENV_FILE" >&2
  exit 1
fi

if [[ -z "${ANTHROPIC_API_KEY:-}" && -z "${GEMINI_API_KEY:-}" ]]; then
  echo "Set ANTHROPIC_API_KEY and/or GEMINI_API_KEY in $ENV_FILE" >&2
  exit 1
fi

# Prefer staging-specific secret so tokens are not interchangeable with production.
if [[ -n "${STAGING_BACKEND_SECRET:-}" ]]; then
  BACKEND_SECRET="$STAGING_BACKEND_SECRET"
fi

PUBLIC_BACKEND="${PUBLIC_BACKEND:-1}"

args=(
  "BACKEND_SECRET=$BACKEND_SECRET"
  "PUBLIC_BACKEND=$PUBLIC_BACKEND"
)

[[ -n "${ANTHROPIC_API_KEY:-}" ]] && args+=("ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY")
[[ -n "${GEMINI_API_KEY:-}" ]] && args+=("GEMINI_API_KEY=$GEMINI_API_KEY")
[[ -n "${DATABASE_URL:-}" ]] && args+=("DATABASE_URL=$DATABASE_URL")
[[ -n "${EXTENSION_CORS_ORIGINS:-}" ]] && args+=("EXTENSION_CORS_ORIGINS=$EXTENSION_CORS_ORIGINS")
[[ -n "${DAILY_CREDITS:-}" ]] && args+=("DAILY_CREDITS=$DAILY_CREDITS")

echo "Setting ${#args[@]} secret(s) on $APP…"
fly secrets set -a "$APP" "${args[@]}"

if [[ -z "${EXTENSION_CORS_ORIGINS:-}" ]]; then
  echo ""
  echo "Note: EXTENSION_CORS_ORIGINS not set — Chrome extension calls may be blocked on staging."
  echo "  Add chrome-extension://<id> to backend/.env.staging (see env.staging.example), then re-run this script."
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo ""
  echo "Note: DATABASE_URL not set — staging will use ephemeral file state on the machine."
  echo "  For durable QA data, add a staging Postgres URL to backend/.env.staging."
fi

echo "Done. Deploy with: npm run deploy:staging"
