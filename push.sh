#!/bin/bash
set -e

if [ -z "$GITHUB_TOKEN" ] || [ -z "$GITHUB_REPO_URL" ]; then
  echo "❌ GITHUB_TOKEN or GITHUB_REPO_URL not set in secrets"
  exit 1
fi

REPO_PATH="${GITHUB_REPO_URL#https://github.com/}"
AUTH_URL="https://drs:${GITHUB_TOKEN}@github.com/${REPO_PATH}.git"

git push "$AUTH_URL" main
echo "✅ Pushed to GitHub successfully"
