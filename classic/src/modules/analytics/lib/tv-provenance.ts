/**
 * Faixa de proveniência (spec §4) — obrigatória em 100% dos widgets.
 *
 * Até 4 fragmentos separados por `·`:
 *   1. Âncora    — obrigatório, NUNCA some        `base: fechamentos`
 *   2. Período   — só em âncora de FLUXO           `ago/2027`
 *   3. Recorte   — condicional                     `por closer` · `carteira`
 *   4. Ressalva  — condicional                     `sem registros`
 *
 * REGRA DE OURO (§4.2): a âncora vem do PAYLOAD, derivada da medida dentro do motor.
 * O front NÃO mantém mapa de medida→âncora — se mantivesse, medida nova no catálogo
 * apareceria com âncora faltando, em silêncio. Aqui só se prefixa `base: `, que é
 * apresentação, não semântica.
 *
 * `hoje` é retrato de estado e NÃO leva período (§4.1): o "quando" já está na âncora.
 */

export const ANCHOR_GLYPH = "⌖";

export interface ProvenanceInput {
  /** Vem do payload do motor: 'entradas' | 'fechamentos' | 'hoje'. */
  anchor?: string | null;
  /** `provenance.period_label` do motor (ex.: '08/2027'). */
  periodLabel?: string | null;
  /** id do recorte do widget. */
  recorte?: string | null;
  /** Rótulo humano do recorte, resolvido pelo catálogo (evita mapa estático no front). */
  recorteLabel?: string | null;
  /** filtro de stream aplicado, se houver. */
  stream?: string | null;
  /** `empty_reason` do motor. */
  emptyReason?: string | null;
}

/** Âncoras de fluxo levam período; a de retrato (`hoje`) não. */
export function anchorCarriesPeriod(anchor?: string | null): boolean {
  return anchor === "entradas" || anchor === "fechamentos";
}

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/**
 * O motor devolve `MM/YYYY`. A parede lê `ago/2027` melhor que `08/2027`.
 * Formato desconhecido passa direto — nunca inventa.
 */
export function formatPeriodLabel(raw?: string | null, abbreviateYear = false): string | null {
  if (!raw) return null;
  const m = /^(\d{2})\/(\d{4})$/.exec(raw);
  if (!m) return raw;
  const monthIdx = Number(m[1]) - 1;
  if (monthIdx < 0 || monthIdx > 11) return raw;
  const year = abbreviateYear ? m[2].slice(2) : m[2];
  return `${MONTHS_PT[monthIdx]}/${year}`;
}

/** Fragmento 3: stream ganha do recorte quando os dois existem (é mais específico). */
function recorteFragment(input: ProvenanceInput): string | null {
  if (input.stream) return input.stream === "novo_negocio" ? "novo negócio" : input.stream;
  const id = input.recorte;
  if (!id || id === "total") return null;
  return `por ${(input.recorteLabel ?? id).toLowerCase()}`;
}

/**
 * Constrói as variantes da linha, da mais completa à mais degradada (§4.4).
 * Ordem de sacrifício: fragmento 4 → 3 → abrevia o 2 → colapsa o 1 (perde `base:`).
 * O TIPO DE ÂNCORA NUNCA SOME.
 *
 * O componente mede e escolhe a primeira que couber em UMA linha — a regra é
 * ajuste medido, não limiar de layout (correção da #1223).
 */
export function buildProvenanceVariants(input: ProvenanceInput): string[] {
  const anchor = input.anchor?.trim();
  // Medida sem âncora é erro do motor (§4.2), não string vazia na tela. Aqui só
  // se degrada com honestidade: sem âncora, a faixa some de vez em vez de mentir.
  if (!anchor) return [];

  const carriesPeriod = anchorCarriesPeriod(anchor);
  const period = carriesPeriod ? formatPeriodLabel(input.periodLabel) : null;
  const periodShort = carriesPeriod ? formatPeriodLabel(input.periodLabel, true) : null;
  const recorte = recorteFragment(input);
  const caveat = input.emptyReason ? "sem registros" : null;

  const join = (parts: (string | null)[]) =>
    `${ANCHOR_GLYPH} ${parts.filter(Boolean).join(" · ")}`;

  const full = `base: ${anchor}`;
  const collapsed = anchor; // colapso do fragmento 1: perde `base:`, mantém a âncora

  const variants = [
    join([full, period, recorte, caveat]),      // completa
    join([full, period, recorte]),              // -4
    join([full, period]),                       // -3
    join([full, periodShort]),                  // 2 abreviado
    join([collapsed, periodShort]),             // 1 colapsado
    join([collapsed]),                          // só a âncora — piso, nunca some
  ];

  // Remove variantes repetidas (ex.: sem período, várias colapsam na mesma string)
  return variants.filter((v, i) => variants.indexOf(v) === i);
}

/** Texto completo, para `aria-label` quando a linha tiver sido degradada (§4.4). */
export function fullProvenanceText(input: ProvenanceInput): string {
  const variants = buildProvenanceVariants(input);
  return variants[0] ?? "";
}

/** Linha de erro — substitui a proveniência quando o widget falha (§5.3). */
export const PROVENANCE_ERROR_TEXT = "⚠ indisponível · tentando de novo";
