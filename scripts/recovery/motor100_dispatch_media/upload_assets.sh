#!/usr/bin/env bash
# Upload Motor 100 dispatch media to PROD storage (bucket `media`).
# Usage: upload_assets.sh <audio_prospeccao.mp3> <audio_pos.mp3> <imagem.png>
# Prints the public URLs. service_role fetched via Management API (PAT in .env.development).
set -euo pipefail
ENVF="${ENV_FILE:-$(dirname "$0")/../../../.env.development}"
REF="jsjsmuncfkbsbzqzqhfq"
ORG="1003870a-ceea-487b-8dd5-910018c7a7d7"
UA="motor100-asset-upload/1.0"

PAT=$(grep -m1 '^SUPABASE_ACCESS_TOKEN=sbp_' "$ENVF" | cut -d= -f2- | tr -d '"')
KEYS=$(curl -s -H "Authorization: Bearer $PAT" -H "User-Agent: $UA" \
  "https://api.supabase.com/v1/projects/$REF/api-keys?reveal=true")
SR=$(echo "$KEYS" | python -c "import sys,json;print([k['api_key'] for k in json.load(sys.stdin) if k.get('name')=='service_role'][0])")

BASE="https://$REF.supabase.co/storage/v1/object/media"
uid() { python -c "import uuid;print(uuid.uuid4())"; }

up() { # file dest ctype
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/$2" \
    -H "Authorization: Bearer $SR" -H "apikey: $SR" -H "Content-Type: $3" -H "x-upsert: true" \
    --data-binary "@$1")
  echo "[$code] https://$REF.supabase.co/storage/v1/object/public/media/$2"
}

up "$1" "workflow-audios/$ORG/$(uid).mp3" "audio/mpeg"
up "$2" "workflow-audios/$ORG/$(uid).mp3" "audio/mpeg"
up "$3" "workflow-assets/$ORG/$(uid).png" "image/png"
