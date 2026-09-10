$ErrorActionPreference = 'Stop'
$taskContainer = ('torque-deal-transfer-qa-' + [guid]::NewGuid().ToString('N').Substring(0,8))
$taskCreated = $false
try {
 docker run --rm -d --name $taskContainer -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine
 if ($LASTEXITCODE -ne 0) { throw 'Container creation failed' }
 $taskCreated = $true
 for ($i=0;$i -lt 30;$i++) { docker exec $taskContainer pg_isready -U postgres *> $null; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep -Seconds 1 }
 docker cp tests/integration/fixtures/deal-transfer-baseline.sql "${taskContainer}:/tmp/baseline.sql"
 docker cp tests/integration/deal-transfer-history.sql "${taskContainer}:/tmp/test.sql"
 docker cp supabase/migrations/20271019000007_deal_transfer_history.sql "${taskContainer}:/tmp/migration.sql"
 docker exec $taskContainer psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/baseline.sql
 if ($LASTEXITCODE -ne 0) { throw 'Baseline failed' }
 docker exec $taskContainer psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/test.sql
 if ($LASTEXITCODE -eq 0) { throw 'Expected baseline regression failure' }
 docker exec $taskContainer psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/migration.sql
 if ($LASTEXITCODE -ne 0) { throw 'Migration failed' }
 docker exec $taskContainer psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/test.sql
 if ($LASTEXITCODE -ne 0) { throw 'Regression failed' }
} finally {
 if ($taskCreated) { docker stop $taskContainer }
 docker ps -a --filter "name=^/${taskContainer}$" --format '{{.Names}}'
}
