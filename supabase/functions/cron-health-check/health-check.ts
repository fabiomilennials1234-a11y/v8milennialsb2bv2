/**
 * Pure health-check logic, isolated from Deno-only imports so it can be
 * unit-tested in node/vitest.
 */

export const PROBE_TIMEOUT_MS = 8_000;

export interface HealthReport {
  healthy: boolean;
  env_secret_present: boolean;
  table_secret_present: boolean;
  secrets_match: boolean;
  edge_probe_status: number | null;
  message: string;
}

export interface HealthCheckDeps {
  fetchTableSecret: () => Promise<string | null>;
  envSecret: string;
  probe: (secret: string) => Promise<number | null>;
}

export async function runHealthCheck(deps: HealthCheckDeps): Promise<HealthReport> {
  const tableSecret = await deps.fetchTableSecret();
  const tablePresent = !!tableSecret;
  const envPresent = !!deps.envSecret;
  const match = tablePresent && envPresent && tableSecret === deps.envSecret;

  const probeSecret = tableSecret ?? deps.envSecret;

  if (!probeSecret) {
    return {
      healthy: false,
      env_secret_present: envPresent,
      table_secret_present: tablePresent,
      secrets_match: false,
      edge_probe_status: null,
      message: "No CRON secret found in env or cron_config table",
    };
  }

  const probeStatus = await deps.probe(probeSecret);
  const healthy = probeStatus !== null && probeStatus !== 401 && probeStatus < 500;

  let message: string;
  if (probeStatus === null) {
    message = "Probe failed — edge function unreachable or timed out";
  } else if (probeStatus === 401) {
    message = "CRON_SECRET drift detected — pg_cron secret rejected by edge function";
  } else if (!match && tablePresent && envPresent) {
    message = `Probe ok (HTTP ${probeStatus}) but env/table secret values differ — investigate`;
  } else {
    message = `Healthy (HTTP ${probeStatus})`;
  }

  return {
    healthy,
    env_secret_present: envPresent,
    table_secret_present: tablePresent,
    secrets_match: match,
    edge_probe_status: probeStatus,
    message,
  };
}
