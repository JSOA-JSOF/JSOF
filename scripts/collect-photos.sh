#!/usr/bin/env bash
#
# Download everything a drop has collected.
#
#   DROP_ADMIN_KEY=... scripts/collect-photos.sh <code> [outdir]
#
# Writes the photographs into <outdir>/, one file each, plus a manifest.csv
# listing the filename, who asked for the credit, and what the file was
# called on their phone. Re-running skips anything already downloaded, so
# it is safe to run again the next morning when the stragglers come in.
#
# The key is a Worker secret, not a thing to paste into a shared document:
#
#   openssl rand -base64 32 | npx wrangler secret put DROP_ADMIN_KEY
#
set -euo pipefail

CODE="${1:-}"
OUT="${2:-event-photos/$CODE}"
BASE="${DROP_BASE:-https://thejsof.org}"

if [ -z "$CODE" ]; then
  echo "usage: DROP_ADMIN_KEY=... $0 <code> [outdir]" >&2
  exit 2
fi
if [ -z "${DROP_ADMIN_KEY:-}" ]; then
  echo "DROP_ADMIN_KEY is not set." >&2
  exit 2
fi

mkdir -p "$OUT"
MANIFEST="$OUT/manifest.json"

curl -fsS -H "Authorization: Bearer $DROP_ADMIN_KEY" \
  "$BASE/api/drop/$CODE/manifest" -o "$MANIFEST"

COUNT=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["count"])' "$MANIFEST")
BYTES=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["bytes"])' "$MANIFEST")
echo "$COUNT photographs, $(( BYTES / 1024 / 1024 ))MB"

python3 -c '
import json, sys
m = json.load(open(sys.argv[1]))
for o in m["objects"]:
    print(o["key"])
' "$MANIFEST" | while read -r KEY; do
  NAME="$OUT/$(basename "$KEY")"
  if [ -s "$NAME" ]; then continue; fi
  printf "  %s\n" "$(basename "$KEY")"
  curl -fsS -H "Authorization: Bearer $DROP_ADMIN_KEY" \
    --get --data-urlencode "key=$KEY" \
    "$BASE/api/drop/$CODE/object" -o "$NAME"
done

python3 -c '
import csv, json, sys
m = json.load(open(sys.argv[1]))
with open(sys.argv[2], "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["file", "credit", "original name", "uploaded", "bytes"])
    for o in m["objects"]:
        w.writerow([
            o["key"].rsplit("/", 1)[-1],
            o.get("credit", ""),
            o.get("originalName", ""),
            o["uploaded"],
            o["size"],
        ])
' "$MANIFEST" "$OUT/manifest.csv"

echo "into $OUT"
