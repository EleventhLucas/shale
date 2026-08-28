#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for the Shale smoke test." >&2
  exit 1
fi

smoke_dir="$(mktemp -d)"
data_dir="$smoke_dir/data"
container_name="shale-smoke-$RANDOM"
image_name="shale:smoke"
cookie_jar="$smoke_dir/cookies.txt"
mkdir "$data_dir"
chmod 0777 "$data_dir"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  rm -rf -- "$smoke_dir"
}
trap cleanup EXIT

docker build --platform linux/amd64 --tag "$image_name" .

start_shale() {
  docker run --detach --name "$container_name" \
    --publish 127.0.0.1::3000 \
    --env SHALE_PASSWORD=disposable-smoke-password \
    --volume "$data_dir:/data" \
    "$image_name" >/dev/null
  host_port="$(docker port "$container_name" 3000/tcp | sed 's/.*://')"
  for _ in $(seq 1 30); do
    if curl --fail --silent "http://127.0.0.1:$host_port/healthz" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  echo "Shale did not become healthy within 30 seconds." >&2
  return 1
}

start_shale
origin="http://127.0.0.1:$host_port"
curl --fail --silent "$origin/" | grep -q "<title>Shale</title>"
curl --fail --silent "$origin/_shale/boards/sample-workspace/sample-board" | \
  bun -e 'const body=await Bun.stdin.json();process.exit(body.columns?.length===3?0:1)'

curl --fail --silent \
  --cookie-jar "$cookie_jar" \
  --header "content-type: application/json" \
  --header "origin: $origin" \
  --data '{"password":"disposable-smoke-password"}' \
  "$origin/_shale/session/unlock" >/dev/null

participant_id="$(curl --fail --silent \
  --cookie "$cookie_jar" \
  --header "content-type: application/json" \
  --header "origin: $origin" \
  --data '{"displayName":"Smoke Editor"}' \
  "$origin/_shale/participants" | bun -e 'const body=await Bun.stdin.json();process.stdout.write(body.id)')"

curl --fail --silent \
  --request PATCH \
  --cookie "$cookie_jar" \
  --header "content-type: application/json" \
  --header "origin: $origin" \
  --header "x-shale-participant: $participant_id" \
  --data '{"title":"Docker persistence verified","description":"Smoke test mutation","revision":1}' \
  "$origin/_shale/cards/card-welcome" >/dev/null

docker rm -f "$container_name" >/dev/null
start_shale
origin="http://127.0.0.1:$host_port"
curl --fail --silent "$origin/_shale/boards/sample-workspace/sample-board" | \
  bun -e 'const body=await Bun.stdin.json();const card=body.columns.flatMap((column)=>column.cards).find((item)=>item.id==="card-welcome");process.exit(card?.title==="Docker persistence verified"?0:1)'

echo "Shale Docker smoke test passed."
