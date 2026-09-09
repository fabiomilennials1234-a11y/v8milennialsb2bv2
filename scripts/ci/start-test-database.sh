#!/usr/bin/env bash
# GitHub runner only. Replay immutable migrations with a synthetic legacy row
# before the retirement migration verifies that its backup is non-empty.
set -euo pipefail

if [[ "${CI:-}" != true || "${GITHUB_ACTIONS:-}" != true || "${RUNNER_TEMP:-}" != /* ]]; then
  echo 'Refusing database bootstrap outside a GitHub Actions runner.' >&2
  exit 1
fi

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
staging_dir="${RUNNER_TEMP}/torque-ci-db"
if [[ -e "$staging_dir" ]]; then
  echo "Refusing to reuse database staging directory: $staging_dir" >&2
  exit 1
fi
mkdir -p "$staging_dir/supabase/migrations"
python3 - "$repo_dir" "$staging_dir" <<'PY'
from pathlib import Path
import shutil
import sys

source, destination = (Path(arg) / 'supabase' for arg in sys.argv[1:])
config = (source / 'config.toml').read_text()
config = config.replace('project_id = "jsjsmuncfkbsbzqzqhfq"', 'project_id = "torque_ci"', 1)
if not config.startswith('project_id = "torque_ci"'):
    raise SystemExit('Unexpected source project configuration')
if '[db.seed]' in config:
    raise SystemExit('Review bootstrap: source config now declares db.seed')
(destination / 'config.toml').write_text(config + '\n[db.seed]\nenabled = false\n')
(destination / 'functions').symlink_to(source / 'functions', target_is_directory=True)
for migration in sorted((source / 'migrations').glob('*.sql')):
    if migration.name[:14] < '20270925000000':
        shutil.copy2(migration, destination / 'migrations' / migration.name)
PY

supabase start --workdir "$staging_dir"
# No configurable connection string: this command can only enter our local
# disposable container. ON_ERROR_STOP makes fixture failures block the job.
docker exec -i supabase_db_torque_ci psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < "$repo_dir/scripts/ci/legacy-retirement-fixture.sql"
cp "$repo_dir"/supabase/migrations/*.sql "$staging_dir/supabase/migrations/"
supabase migration up --local --include-all --workdir "$staging_dir"
