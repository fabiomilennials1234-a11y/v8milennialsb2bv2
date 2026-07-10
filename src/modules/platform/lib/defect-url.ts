/**
 * defect-url — o Defeito vive no GitHub, não neste banco.
 *
 * Cinco Organizações reportam "o kanban trava". São cinco Chamados e **um**
 * defeito. Sem nada que os ligue, a Severidade — que depende de quantas *outras*
 * orgs foram atingidas — é chute. Com o link, é contagem.
 *
 * O rastreador de defeitos é o GitHub Issues: ele já tem dono, label e PR
 * vinculado, e o dev já mora lá. Uma tabela `Defeito` no Postgres seria uma
 * segunda fonte de verdade sobre o mesmo bug, e as duas divergiriam.
 *
 * `defect_url` é uma coluna de texto por escolha. É exatamente onde a foreign
 * key entra se um dia uma entidade `Defeito` fizer sentido — o que só acontece
 * quando o volume justificar fan-out automático (ADR-0018).
 */

const ISSUE_RE = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/(\d+)$/;

export type DefectUrlResult = { ok: true; url: string | null } | { ok: false; reason: string };

/**
 * Normaliza o que o staff colou. Uma âncora de comentário e uma query string são
 * ruído — a mesma issue coladas de dois lugares tem que agrupar junto.
 *
 * Vazio significa **desvincular**, não "URL inválida".
 */
export function normalizeDefectUrl(input: string): DefectUrlResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, url: null };

  const withoutFragment = trimmed.split("#")[0].split("?")[0].replace(/\/+$/, "");

  if (!ISSUE_RE.test(withoutFragment)) {
    return { ok: false, reason: "Cole o link de uma issue do GitHub (…/issues/123)." };
  }

  return { ok: true, url: withoutFragment };
}

/** `#1005` — o que o staff reconhece de relance. */
export function defectLabel(url: string | null): string | null {
  if (!url) return null;
  const match = ISSUE_RE.exec(url);
  return match ? `#${match[1]}` : null;
}

export interface DefectGroupable {
  organization_id: string;
  defect_url: string | null;
}

export interface DefectGroup {
  defectUrl: string;
  tickets: number;
  /** Organizações **distintas** atingidas. É o número que vira Severidade. */
  organizations: number;
}

export function groupByDefect(tickets: DefectGroupable[]): DefectGroup[] {
  const byUrl = new Map<string, { tickets: number; orgs: Set<string> }>();

  for (const ticket of tickets) {
    if (!ticket.defect_url) continue;

    const entry = byUrl.get(ticket.defect_url) ?? { tickets: 0, orgs: new Set<string>() };
    entry.tickets += 1;
    entry.orgs.add(ticket.organization_id);
    byUrl.set(ticket.defect_url, entry);
  }

  return [...byUrl.entries()]
    .map(([defectUrl, { tickets, orgs }]) => ({
      defectUrl,
      tickets,
      organizations: orgs.size,
    }))
    .sort((a, b) => b.organizations - a.organizations || b.tickets - a.tickets);
}
