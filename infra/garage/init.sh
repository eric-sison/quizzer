#!/bin/sh
# Provision the local Garage node: one-zone layout, the quizzer-media bucket,
# and the fixed dev credentials apps/api/.env.example ships with.
#
# Idempotent - run it after `docker compose up -d`:
#
#   ./infra/garage/init.sh
#
# It talks to the daemon through `docker compose exec`, which is the one way to
# reach the admin RPC without publishing it on the host.
set -eu

g() {
  docker compose exec -T garage /garage "$@"
}

echo "[garage-init] waiting for the node to answer..."
for _ in $(seq 1 30); do
  if g status >/dev/null 2>&1; then break; fi
  sleep 1
done

NODE_ID=$(g node id -q | cut -d@ -f1)
echo "[garage-init] node ${NODE_ID}"

if g layout show | grep -q "$NODE_ID"; then
  echo "[garage-init] layout already assigned"
else
  g layout assign -z dev -c 10G "$NODE_ID"
  g layout apply --version 1
fi

# Fixed dev credentials, matching apps/api/.env.example. `key import` refuses a
# duplicate, which is exactly the idempotency we want.
if g key info quizzer-dev >/dev/null 2>&1; then
  echo "[garage-init] key quizzer-dev already present"
else
  g key import --yes -n quizzer-dev \
    GK0123456789abcdef01234567 \
    9086f2e2367a4f5c7f89ac35bcb541b1f4ba1041c352c9d5e02e28de0a166d9a
fi

if g bucket info quizzer-media >/dev/null 2>&1; then
  echo "[garage-init] bucket quizzer-media already present"
else
  g bucket create quizzer-media
fi

g bucket allow --read --write quizzer-media --key quizzer-dev >/dev/null
echo "[garage-init] done - quizzer-media is ready"
