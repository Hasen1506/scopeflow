#!/bin/sh
# First Koyeb service for ScopeFlow. Run once, from a machine with the Koyeb CLI
# logged in (`koyeb login`). It does not print or embed secret values.
#
#   scripts/koyeb-create.sh [git-branch]
#
# The default branch is the hosting branch. After this change is on main, update
# the service's git branch to main (docs/DEPLOY-KOYEB.md). Create deploys once.
# `--git-no-deploy-on-push` keeps later pushes from deploying ahead of
# db:migrate:deploy. Later releases go through .github/workflows/deploy-koyeb.yml.
#
# Instance type `free` and region `fra` are the free tier closest to India.
# Frankfurt and Washington, D.C. are the only free regions.
# https://www.koyeb.com/docs/reference/instances
set -eu
branch="${1:-cursor/koyeb-hosting-5e80}"
exec koyeb services create scopeflow \
  --app scopeflow \
  --git github.com/Hasen1506/scopeflow \
  --git-branch "$branch" \
  --git-builder docker \
  --git-docker-dockerfile Dockerfile \
  --git-no-deploy-on-push \
  --instance-type free \
  --regions fra \
  --type web \
  --env PORT=8000 \
  --env NODE_ENV=production \
  --env APP_URL=https://scope-flow.tech \
  --env SCOPEFLOW_TRUSTED_PROXY=cloudflare \
  --env SCOPEFLOW_TRUSTED_HOPS=1 \
  --env SCOPEFLOW_ANALYTICS=on \
  --env POSTHOG_HOST=https://eu.i.posthog.com \
  --env SCOPEFLOW_TSA_URL=https://freetsa.org/tsr \
  --env PG_POOL_MAX=4 \
  --ports 8000:http \
  --routes /:8000 \
  --checks 8000:http:/api/health \
  --checks-grace-period 8000=180
