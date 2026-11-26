/**
 * Situação do cliente no ERP Toth (`situacaoParceiro`), na língua da tela.
 *
 * Uma legenda só para a ficha do lead ("Situação no ERP") e para a prévia da
 * importação — as duas não podem discordar sobre o mesmo cliente. Autorizada pelo
 * CTO em 10/09/2026. Espelho na edge: `supabase/functions/_shared/erp/toth-situacao.ts`.
 */

export const ERP_SITUACAO_LABEL: Readonly<Record<string, string>> = {
  "0": "Ativo",
  "1": "Inativo",
  "2": "Bloqueado",
  "3": "Inconsistente",
};

/** Plural de cada situação, para o resumo do grupo ("3 inativos"). */
const PLURAL: Readonly<Record<string, string>> = {
  "0": "ativos",
  "1": "inativos",
  "2": "bloqueados",
  "3": "inconsistentes",
};

export type ErpSituacaoTone = "good" | "neutral" | "warn" | "bad";

const TONE: Readonly<Record<string, ErpSituacaoTone>> = {
  "0": "good",
  "1": "neutral",
  "2": "bad",
  "3": "warn",
};

export interface ErpSituacao {
  /** Código cru do Toth; vazio quando o ERP não informou. */
  code: string;
  label: string;
  tone: ErpSituacaoTone;
}

/**
 * Cliente do ERP sem situação em lugar nenhum. Em 26/11/2026 eram 1.415 na Café
 * Jurerê — a carga crua de 20–21/08, sem empresa nem cadastro.
 */
export const ERP_SITUACAO_NAO_INFORMADA: ErpSituacao = { code: "", label: "Situação não informada", tone: "neutral" };

/** Código cru → rótulo e tom. Código sem legenda aparece como veio. */
export function erpSituacao(code: string | null | undefined): ErpSituacao | null {
  const c = code?.trim();
  if (!c) return null;
  return { code: c, label: ERP_SITUACAO_LABEL[c] ?? `Situação ${c}`, tone: TONE[c] ?? "neutral" };
}

function rank(code: string): number {
  if (!code) return Number.MAX_SAFE_INTEGER;
  const i = Object.keys(ERP_SITUACAO_LABEL).indexOf(code);
  return i < 0 ? Object.keys(ERP_SITUACAO_LABEL).length : i;
}

/** "3 ativos · 1 inativo · 2 sem situação", na ordem da legenda. */
export function erpSituacaoResumo(situacoes: (ErpSituacao | null | undefined)[]): string | null {
  const counts = new Map<string, { n: number; s: ErpSituacao }>();
  for (const s of situacoes) {
    if (!s) continue;
    const cur = counts.get(s.code);
    counts.set(s.code, { n: (cur?.n ?? 0) + 1, s });
  }
  if (counts.size === 0) return null;
  return [...counts.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([code, { n, s }]) => {
      if (!code) return `${n} sem situação`;
      return `${n} ${n > 1 && PLURAL[code] ? PLURAL[code] : s.label.toLowerCase()}`;
    })
    .join(" · ");
}
