/**
 * PROTOTYPE — wipe me. Mock data for the Observability cockpit prototype.
 * Shaped like the real tables (runtime_logs, application_logs, system_alerts,
 * audit_log, whatsapp_health_checks) so the layouts are judgeable on real
 * density. No DB calls — the question is "what should it look like".
 */

export type Health = "ok" | "warn" | "down";

export interface ServiceHealth { name: string; status: Health; latencyMs: number; }
export interface CronJob { name: string; schedule: string; lastRun: string; status: Health; }
export interface DriftRow { instance: string; org: string; driftPct: number; severity: Health; }
export interface ErrorGroup {
  id: string; title: string; source: "edge" | "frontend" | "db";
  fn: string; count: number; lastSeen: string; firstSeen: string;
  trend: "up" | "down" | "flat"; org: string;
}
export interface EdgeFnStat { fn: string; calls: number; errorRatePct: number; p95ms: number; trend: "up" | "down" | "flat"; }
export interface AlertRow { id: string; severity: "critical" | "warning" | "info"; category: string; title: string; org: string; ageMin: number; }
export interface AuditRow { actor: string; action: string; table: string; org: string; atMin: number; }
export interface StreamEvent {
  id: string; kind: "error" | "alert" | "audit" | "health"; severity: Health | "info";
  title: string; meta: string; org: string; atMin: number;
}

export const services: ServiceHealth[] = [
  { name: "Postgres", status: "ok", latencyMs: 12 },
  { name: "Uazapi", status: "ok", latencyMs: 240 },
  { name: "OpenRouter", status: "warn", latencyMs: 1850 },
  { name: "Embeddings (Gemini)", status: "ok", latencyMs: 410 },
  { name: "Asaas", status: "ok", latencyMs: 320 },
  { name: "Meta API", status: "down", latencyMs: 0 },
];

export const crons: CronJob[] = [
  { name: "process-outbound-dispatches", schedule: "*/1", lastRun: "há 38s", status: "ok" },
  { name: "workflow-executions", schedule: "*/1", lastRun: "há 52s", status: "ok" },
  { name: "blast-plan-release", schedule: "0 9 * * *", lastRun: "há 4h", status: "ok" },
  { name: "whatsapp-health-monitor", schedule: "*/5", lastRun: "há 2min", status: "warn" },
  { name: "campaign-rule-dispatch", schedule: "*/1", lastRun: "há 14min", status: "down" },
];

export const drift: DriftRow[] = [
  { instance: "milennials-01", org: "Milennials", driftPct: 4, severity: "ok" },
  { instance: "basic4u-01", org: "Basic4u", driftPct: 38, severity: "warn" },
  { instance: "bertin-01", org: "Bertin", driftPct: 71, severity: "down" },
];

// hourly error counts, last 24h (for sparkline/bars)
export const errorsByHour: number[] = [2, 1, 0, 0, 3, 1, 4, 2, 6, 9, 14, 8, 5, 3, 2, 7, 11, 4, 2, 1, 0, 3, 5, 2];

export const errorGroups: ErrorGroup[] = [
  { id: "e1", title: "TypeError: cannot read 'phone' of null", source: "edge", fn: "agent-message", count: 142, lastSeen: "há 3min", firstSeen: "há 2d", trend: "up", org: "Bertin" },
  { id: "e2", title: "sendMedia timeout after 30s", source: "edge", fn: "whatsapp-api-proxy", count: 88, lastSeen: "há 11min", firstSeen: "há 5d", trend: "flat", org: "Basic4u" },
  { id: "e3", title: "Unhandled promise rejection (Kanban drag)", source: "frontend", fn: "PipeBoard.tsx", count: 41, lastSeen: "há 26min", firstSeen: "há 1d", trend: "up", org: "Milennials" },
  { id: "e4", title: "duplicate key value violates unique constraint", source: "db", fn: "lead-webhook", count: 23, lastSeen: "há 1h", firstSeen: "há 8d", trend: "down", org: "Vários" },
  { id: "e5", title: "402 OpenRouter insufficient credits", source: "edge", fn: "generate-business-context", count: 7, lastSeen: "há 2h", firstSeen: "há 2h", trend: "up", org: "Lion" },
];

export const edgeFns: EdgeFnStat[] = [
  { fn: "agent-message", calls: 12840, errorRatePct: 1.1, p95ms: 2400, trend: "up" },
  { fn: "whatsapp-webhook", calls: 48210, errorRatePct: 0.2, p95ms: 180, trend: "flat" },
  { fn: "whatsapp-api-proxy", calls: 9120, errorRatePct: 0.9, p95ms: 880, trend: "down" },
  { fn: "lead-webhook", calls: 3410, errorRatePct: 0.7, p95ms: 320, trend: "flat" },
  { fn: "process-workflow-executions", calls: 1440, errorRatePct: 2.3, p95ms: 1200, trend: "up" },
  { fn: "api", calls: 612, errorRatePct: 0.0, p95ms: 95, trend: "flat" },
];

export const alerts: AlertRow[] = [
  { id: "a1", severity: "critical", category: "whatsapp", title: "Bertin: drift 71% — rebind falhou 2x", org: "Bertin", ageMin: 6 },
  { id: "a2", severity: "critical", category: "cron", title: "campaign-rule-dispatch parado há 14min", org: "—", ageMin: 14 },
  { id: "a3", severity: "warning", category: "integration", title: "Meta API retornando 500", org: "—", ageMin: 22 },
  { id: "a4", severity: "warning", category: "copilot", title: "agent-message erro subindo (+38%)", org: "Bertin", ageMin: 31 },
  { id: "a5", severity: "info", category: "billing", title: "Lion: créditos OpenRouter baixos", org: "Lion", ageMin: 120 },
];

export const audit: AuditRow[] = [
  { actor: "gabriel@milennials", action: "UPDATE", table: "feature_flags", org: "Basic4u", atMin: 4 },
  { actor: "dev-junior", action: "DELETE", table: "workflows", org: "Lion", atMin: 18 },
  { actor: "service_role", action: "INSERT", table: "pipe_propostas", org: "Milennials", atMin: 27 },
  { actor: "gabriel@milennials", action: "UPDATE", table: "copilot_agents", org: "Bertin", atMin: 44 },
];

export const stream: StreamEvent[] = [
  { id: "s1", kind: "alert", severity: "down", title: "campaign-rule-dispatch parado", meta: "cron · 14min sem rodar", org: "—", atMin: 2 },
  { id: "s2", kind: "error", severity: "down", title: "TypeError 'phone' of null", meta: "agent-message · 142×", org: "Bertin", atMin: 3 },
  { id: "s3", kind: "audit", severity: "info", title: "feature_flags atualizado", meta: "gabriel@milennials", org: "Basic4u", atMin: 4 },
  { id: "s4", kind: "health", severity: "warn", title: "OpenRouter lento (1.85s)", meta: "integração", org: "—", atMin: 9 },
  { id: "s5", kind: "error", severity: "warn", title: "sendMedia timeout 30s", meta: "whatsapp-api-proxy · 88×", org: "Basic4u", atMin: 11 },
  { id: "s6", kind: "audit", severity: "info", title: "workflows deletado", meta: "dev-junior", org: "Lion", atMin: 18 },
  { id: "s7", kind: "health", severity: "down", title: "Meta API 500", meta: "integração caída", org: "—", atMin: 22 },
  { id: "s8", kind: "error", severity: "warn", title: "Unhandled rejection (Kanban)", meta: "PipeBoard.tsx · 41×", org: "Milennials", atMin: 26 },
];

export const kpis = {
  errors24h: 109,
  errors24hTrend: +18,
  openAlerts: 5,
  criticalAlerts: 2,
  p95GlobalMs: 640,
  uptimePct: 99.2,
  eventsToday: 71240,
};
