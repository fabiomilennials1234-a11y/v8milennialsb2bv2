/**
 * Pure health-check logic, isolated from Deno-only imports so it can be
 * unit-tested in node/vitest.
 */

import {
  assessWatchdogDelivery,
  type WatchdogDeliveryFailureRow,
  type WatchdogDeliveryReport,
} from "./watchdog-delivery.ts";

export const PROBE_TIMEOUT_MS = 8_000;

export interface HealthReport {
  healthy: boolean;
  env_secret_present: boolean;
  table_secret_present: boolean;
  secrets_match: boolean;
  edge_probe_status: number | null;
  message: string;
  /** Falha de ENVIO do alerta do infra-watchdog. Ver watchdog-delivery.ts. */
  watchdog_delivery?: WatchdogDeliveryReport;
}

export interface HealthCheckDeps {
  fetchTableSecret: () => Promise<string | null>;
  envSecret: string;
  probe: (secret: string) => Promise<number | null>;
  /**
   * Opcional: linhas de `runtime_logs` com module='job_monitor',
   * action='watchdog_alert', status='error'. Ausente = comportamento de antes,
   * que é o que mantém os testes originais válidos.
   */
  fetchWatchdogDeliveryFailures?: () => Promise<WatchdogDeliveryFailureRow[]>;
  now?: Date;
}

/**
 * Junta a falha de envio do watchdog ao relatório, sem deixar uma sonda calar a
 * outra: segredo do cron ausente não pode esconder alerta perdido, e vice-versa.
 */
function withWatchdog(report: HealthReport, watchdog: WatchdogDeliveryReport | null): HealthReport {
  if (!watchdog) return report;
  return {
    ...report,
    watchdog_delivery: watchdog,
    healthy: report.healthy && !watchdog.failing,
    message: watchdog.failing ? `${report.message} | ${watchdog.message}` : report.message,
  };
}

export async function runHealthCheck(deps: HealthCheckDeps): Promise<HealthReport> {
  // Antes da sonda: se o probe estourar, o alerta perdido ainda tem que aparecer.
  let watchdog: WatchdogDeliveryReport | null = null;
  if (deps.fetchWatchdogDeliveryFailures) {
    try {
      watchdog = assessWatchdogDelivery(await deps.fetchWatchdogDeliveryFailures(), deps.now);
    } catch (err) {
      // Consulta quebrada é diferente de "não há falha" — e dizer que não há
      // seria a mentira exata que este código existe para impedir.
      watchdog = {
        failing: true,
        // NULO, não 0: gravar 0 aqui daria a MESMA linha de log do caso
        // saudável, e quem lesse depois não separaria "nenhuma falha" de "não
        // consegui contar". É o mesmo princípio de total real vs lista truncada.
        count: null,
        oldest_at: null,
        readable: false,
        message: `não deu para ler as falhas de envio do watchdog: ${String(err)}`,
      };
    }
  }

  const tableSecret = await deps.fetchTableSecret();
  const tablePresent = !!tableSecret;
  const envPresent = !!deps.envSecret;
  const match = tablePresent && envPresent && tableSecret === deps.envSecret;

  const probeSecret = tableSecret ?? deps.envSecret;

  if (!probeSecret) {
    return withWatchdog({
      healthy: false,
      env_secret_present: envPresent,
      table_secret_present: tablePresent,
      secrets_match: false,
      edge_probe_status: null,
      message: "No CRON secret found in env or cron_config table",
    }, watchdog);
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

  return withWatchdog({
    healthy,
    env_secret_present: envPresent,
    table_secret_present: tablePresent,
    secrets_match: match,
    edge_probe_status: probeStatus,
    message,
  }, watchdog);
}
