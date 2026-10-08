/**
 * Monitoramento — a fila única de incidentes (regras MO-1…MO-6).
 *
 * Cada fonte que já existe (alertas de sistema, saúde do WhatsApp, erros da
 * aplicação) vira o mesmo formato, e o que é o MESMO problema vira UM item:
 *
 *   MO-1  todo incidente tem uma origem
 *   MO-2  aponta a org quando ela é conhecida; sem org é da plataforma
 *   MO-4  mesmo erro não vira dois itens — as ocorrências somam
 *   MO-5  o mesmo erro em várias orgs é UM incidente global (ex.: bloqueio da
 *         Uazapi), não N incidentes de org
 *   MO-3  crítico com mais de 10 ocorrências é marcado para virar chamado
 *
 * Puro: recebe linhas, devolve a fila. As fontes e o "abrir chamado sozinho"
 * (MO-3 automático, via cron) ficam no hook e no backend.
 */

export type IncidentOrigin = "sentry" | "automacao" | "whatsapp" | "meta" | "aplicacao";
export type IncidentSeverity = "critico" | "erro" | "aviso";

export const ORIGIN_LABELS: Record<IncidentOrigin, string> = {
  sentry: "Sentry",
  automacao: "Automação",
  whatsapp: "WhatsApp",
  meta: "Meta",
  aplicacao: "Aplicação",
};

export const SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  critico: "Crítico",
  erro: "Erro",
  aviso: "Aviso",
};

const SEVERITY_RANK: Record<IncidentSeverity, number> = { critico: 3, erro: 2, aviso: 1 };

/** MO-3. */
export const AUTO_TICKET_MIN_OCCURRENCES = 10;
/** MO-5: a partir de quantas orgs o mesmo erro deixa de ser "de uma org". */
export const GLOBAL_MIN_ORGS = 3;

/** Uma ocorrência crua, já normalizada pela fonte. */
export interface IncidentEvent {
  origin: IncidentOrigin;
  severity: IncidentSeverity;
  organizationId: string | null;
  organizationName: string | null;
  /** O que identifica "o mesmo erro" dentro da origem — sem id de org nem número variável. */
  signature: string;
  title: string;
  detail: string | null;
  at: string;
  /** Ocorrências que esta linha representa (uma linha de alerta pode já agregar várias). */
  count?: number;
}

export interface Incident {
  id: string;
  origin: IncidentOrigin;
  severity: IncidentSeverity;
  scope: "org" | "global" | "plataforma";
  organizationId: string | null;
  organizationName: string | null;
  /** MO-5: as orgs atingidas, quando global. */
  affectedOrgs: { id: string; name: string | null }[];
  title: string;
  detail: string | null;
  occurrences: number;
  firstAt: string;
  lastAt: string;
  /** MO-3. */
  shouldOpenTicket: boolean;
}

/**
 * Tira o que muda de uma ocorrência para outra (uuids, números, telefones)
 * para que o mesmo erro tenha a mesma assinatura.
 */
export function normalizeSignature(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function maxSeverity(a: IncidentSeverity, b: IncidentSeverity): IncidentSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

interface Bucket {
  events: IncidentEvent[];
  orgs: Map<string, string | null>;
}

export function buildIncidents(events: readonly IncidentEvent[]): Incident[] {
  // 1º passo: agrupa por origem + assinatura, ignorando a org.
  const bySignature = new Map<string, Bucket>();
  for (const e of events) {
    const key = `${e.origin}|${e.signature}`;
    const b: Bucket = bySignature.get(key) ?? { events: [], orgs: new Map() };
    b.events.push(e);
    if (e.organizationId) b.orgs.set(e.organizationId, e.organizationName);
    bySignature.set(key, b);
  }

  const out: Incident[] = [];
  for (const [key, b] of bySignature) {
    // MO-5: espalhado em várias orgs → um incidente global.
    if (b.orgs.size >= GLOBAL_MIN_ORGS) {
      out.push(merge(`${key}|global`, b.events, "global", null, null, b.orgs));
      continue;
    }
    // Senão, um incidente por org (MO-2) — e um da plataforma para o que não tem org.
    const porOrg = new Map<string | null, IncidentEvent[]>();
    for (const e of b.events) {
      const lista = porOrg.get(e.organizationId) ?? [];
      lista.push(e);
      porOrg.set(e.organizationId, lista);
    }
    for (const [orgId, evs] of porOrg) {
      out.push(
        merge(
          `${key}|${orgId ?? "plataforma"}`,
          evs,
          orgId ? "org" : "plataforma",
          orgId,
          evs[0].organizationName,
          new Map(orgId ? [[orgId, evs[0].organizationName]] : []),
        ),
      );
    }
  }

  return out.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      (b.scope === "global" ? 1 : 0) - (a.scope === "global" ? 1 : 0) ||
      b.lastAt.localeCompare(a.lastAt),
  );
}

function merge(
  id: string,
  events: IncidentEvent[],
  scope: Incident["scope"],
  organizationId: string | null,
  organizationName: string | null,
  orgs: Map<string, string | null>,
): Incident {
  let severity: IncidentSeverity = "aviso";
  let occurrences = 0;
  let firstAt = events[0].at;
  let lastAt = events[0].at;
  let latest = events[0];
  for (const e of events) {
    severity = maxSeverity(severity, e.severity);
    occurrences += e.count ?? 1;
    if (e.at < firstAt) firstAt = e.at;
    if (e.at > lastAt) {
      lastAt = e.at;
      latest = e;
    }
  }
  return {
    id,
    origin: latest.origin,
    severity,
    scope,
    organizationId,
    organizationName,
    affectedOrgs: [...orgs].map(([oid, name]) => ({ id: oid, name })),
    title: latest.title,
    detail: latest.detail,
    occurrences,
    firstAt,
    lastAt,
    // MO-3 vale para incidente de UMA org: global não vira chamado de uma org só (MO-5).
    shouldOpenTicket: scope === "org" && severity === "critico" && occurrences > AUTO_TICKET_MIN_OCCURRENCES,
  };
}
