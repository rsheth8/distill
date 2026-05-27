#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8787}"
ADMIN_SECRET="${ADMIN_SECRET:-}"

usage() {
  echo "Usage:"
  echo "  ADMIN_SECRET=... $0 status <userId>"
  echo "  ADMIN_SECRET=... $0 revoke <userId>"
  echo "  ADMIN_SECRET=... $0 reset <userId>"
  echo ""
  echo "Optional:"
  echo "  BASE_URL=http://localhost:8787"
  echo ""
  echo "Note:"
  echo "  Admin routes must be enabled via ENABLE_ADMIN_ROUTES=1 in backend/.env"
}

if [[ -z "${ADMIN_SECRET}" ]]; then
  echo "ERROR: ADMIN_SECRET is required."
  usage
  exit 1
fi

if [[ $# -lt 2 ]]; then
  usage
  exit 1
fi

CMD="$1"
USER_ID="$2"

case "${CMD}" in
  status)
    curl -sS "${BASE_URL}/v1/admin/user-state/${USER_ID}" \
      -H "x-admin-secret: ${ADMIN_SECRET}"
    echo
    ;;
  revoke)
    curl -sS -X POST "${BASE_URL}/v1/admin/revoke-user" \
      -H "Content-Type: application/json" \
      -H "x-admin-secret: ${ADMIN_SECRET}" \
      -d "{\"userId\":\"${USER_ID}\"}"
    echo
    ;;
  reset)
    curl -sS -X POST "${BASE_URL}/v1/admin/reset-usage" \
      -H "Content-Type: application/json" \
      -H "x-admin-secret: ${ADMIN_SECRET}" \
      -d "{\"userId\":\"${USER_ID}\"}"
    echo
    ;;
  *)
    echo "ERROR: Unknown command '${CMD}'."
    usage
    exit 1
    ;;
esac
