/**
 * Saúde da org — a nota de 0 a 100 da central Organizações (regras OR-6, OR-7).
 *
 * Os fatos vêm de `master_org_health_signals` (migration 20271105000200); a
 * nota é calculada aqui, com os pesos à vista e testados. Quatro sinais, cada
 * um respondendo uma pergunta que o suporte já faz à mão:
 *
 *   login     35  — alguém do cliente entrou?            (o sinal mais forte de churn)
 *   uso       25  — o produto está sendo usado?          (eventos em 7 dias)
 *   whatsapp  20  — o canal principal está de pé?
 *   chamados  20  — o cliente está brigando com a gente?
 *
 * OR-6: em risco = nota abaixo de 45 OU 14 dias sem login. O segundo critério
 * é independente de propósito: uma org com chip e automação rodando sozinha
 * pode pontuar bem e não ter ninguém olhando há um mês.
 */

export const RISK_SCORE_THRESHOLD = 45;
export const RISK_NO_LOGIN_DAYS = 14;
/** OR-7. */
export const QUOTA_WARN_RATIO = 0.9;

export interface OrgHealthSignals {
  organization_id: string;
  members_active: number;
  last_login_at: string | null;
  active_users_7d: number;
  events_7d: number;
  whatsapp_instances: number;
  whatsapp_connected: number;
  open_tickets: number;
  reopen_alert_tickets: number;
  quota_max_ratio: number | null;
  quota_max_resource: string | null;
}

export interface HealthPart {
  key: "login" | "uso" | "whatsapp" | "chamados";
  label: string;
  points: number;
  max: number;
  detail: string;
}

export interface OrgHealth {
  score: number;
  parts: HealthPart[];
  daysSinceLogin: number | null;
  atRisk: boolean;
  riskReasons: string[];
  quotaWarning: { resource: string; ratio: number } | null;
}

export const QUOTA_RESOURCE_LABELS: Record<string, string> = {
  max_whatsapp_instances: "chips de WhatsApp",
  max_users: "usuários",
  max_copilot_agents: "copilots",
};

const DAY = 86_400_000;

function loginPart(days: number | null): HealthPart {
  const max = 35;
  if (days === null) return { key: "login", label: "Login", points: 0, max, detail: "ninguém do cliente entrou ainda" };
  const points = days <= 2 ? 35 : days <= 7 ? 25 : days < RISK_NO_LOGIN_DAYS ? 10 : 0;
  return { key: "login", label: "Login", points, max, detail: days === 0 ? "entrou hoje" : `último login há ${days} d` };
}

function usoPart(events: number): HealthPart {
  const max = 25;
  const points = events >= 200 ? 25 : events >= 50 ? 18 : events > 0 ? 10 : 0;
  return { key: "uso", label: "Uso", points, max, detail: `${events.toLocaleString("pt-BR")} eventos em 7 dias` };
}

function whatsappPart(total: number, conectados: number): HealthPart {
  const max = 20;
  if (total === 0) return { key: "whatsapp", label: "WhatsApp", points: 0, max, detail: "nenhum chip cadastrado" };
  const points = conectados === total ? 20 : conectados > 0 ? 12 : 0;
  return { key: "whatsapp", label: "WhatsApp", points, max, detail: `${conectados} de ${total} chips conectados` };
}

function chamadosPart(abertos: number, reabertos: number): HealthPart {
  const max = 20;
  const points = reabertos > 0 ? 0 : abertos === 0 ? 20 : abertos === 1 ? 12 : 5;
  const detail =
    reabertos > 0
      ? `${reabertos} chamado${reabertos > 1 ? "s" : ""} reaberto 3×`
      : abertos === 0
        ? "nenhum chamado aberto"
        : `${abertos} chamado${abertos > 1 ? "s" : ""} aberto${abertos > 1 ? "s" : ""}`;
  return { key: "chamados", label: "Chamados", points, max, detail };
}

export function orgHealth(s: OrgHealthSignals, now: Date = new Date()): OrgHealth {
  const daysSinceLogin = s.last_login_at
    ? Math.max(0, Math.floor((now.getTime() - new Date(s.last_login_at).getTime()) / DAY))
    : null;

  const parts = [
    loginPart(daysSinceLogin),
    usoPart(s.events_7d),
    whatsappPart(s.whatsapp_instances, s.whatsapp_connected),
    chamadosPart(s.open_tickets, s.reopen_alert_tickets),
  ];
  const score = parts.reduce((acc, p) => acc + p.points, 0);

  const riskReasons: string[] = [];
  if (score < RISK_SCORE_THRESHOLD) riskReasons.push(`nota ${score} abaixo de ${RISK_SCORE_THRESHOLD}`);
  if (daysSinceLogin === null || daysSinceLogin >= RISK_NO_LOGIN_DAYS) {
    riskReasons.push(daysSinceLogin === null ? "nunca houve login" : `${daysSinceLogin} dias sem login`);
  }

  const quotaWarning =
    s.quota_max_ratio !== null && s.quota_max_ratio >= QUOTA_WARN_RATIO && s.quota_max_resource
      ? { resource: s.quota_max_resource, ratio: s.quota_max_ratio }
      : null;

  return { score, parts, daysSinceLogin, atRisk: riskReasons.length > 0, riskReasons, quotaWarning };
}

/**
 * Org EM USO — o número real de clientes usando o Torque.
 *
 * Em uso = alguém do cliente (membro ativo, master não conta) entrou nos
 * últimos 30 dias. É o único sinal que só existe com gente usando: status de
 * assinatura não diz nada (medido 2026-10-08: dezenas de orgs `active` sem
 * login há meses), e mensagem recebida, lead de webhook e evento de automação
 * continuam chegando com o chip conectado e ninguém olhando.
 */
export const IN_USE_LOGIN_DAYS = 30;

export function isOrgInUse(s: OrgHealthSignals | undefined, now: Date = new Date()): boolean {
  if (!s?.last_login_at) return false;
  return now.getTime() - new Date(s.last_login_at).getTime() < IN_USE_LOGIN_DAYS * DAY;
}

export type HealthBand = "good" | "warn" | "bad";

export function healthBand(score: number): HealthBand {
  return score >= 70 ? "good" : score >= RISK_SCORE_THRESHOLD ? "warn" : "bad";
}
