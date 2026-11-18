#!/usr/bin/env bash
# Creates a local demo account for development and prints a cookie jar path.
# These credentials are for local testing only.
set -euo pipefail
API="${API:-http://localhost:8080}"
EMAIL="${DEMO_EMAIL:-demo@docdoctor.test}"
PASSWORD="${DEMO_PASSWORD:-demo-password-123}"
ORG="${DEMO_ORG:-Biuro Rachunkowe Łoś i Wspólnicy}"
JAR="${JAR:-/tmp/docdoctor-demo.cookies}"

body=$(printf '{"org_name":"%s","email":"%s","password":"%s"}' "$ORG" "$EMAIL" "$PASSWORD")
code=$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" -H 'Content-Type: application/json' -d "$body" "$API/api/auth/register")
if [ "$code" = "409" ]; then
  curl -sf -o /dev/null -c "$JAR" -H 'Content-Type: application/json' \
    -d "$(printf '{"email":"%s","password":"%s"}' "$EMAIL" "$PASSWORD")" "$API/api/auth/login"
elif [ "$code" != "200" ]; then
  echo "register failed with HTTP $code" >&2; exit 1
fi
echo "$JAR"
