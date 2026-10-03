/**
 * Agrupamento dos cards ENCERRADOS (ganhos e perdidos) de uma coluna do board.
 *
 * Negócio ganho ou perdido não é trabalho em andamento: misturado aos abertos,
 * ele empurra para baixo o que ainda pede ação. A coluna passa a mostrar os
 * encerrados empilhados — um grupo por desfecho — e, aberto o grupo, um
 * subgrupo por MÊS do desfecho. Hierarquia: grupo › mês › card.
 *
 * O mês é o do instante do desfecho (`deals.outcome_at`, projetado pelo
 * `get_pipeline_page` como `metadata.deal_outcome_at`), no FUSO DO NAVEGADOR:
 * um ganho às 22h de 31/08 em Brasília é agosto para quem o vê, embora seja
 * setembro em UTC. É a mesma fronteira que o operador usa ao fechar o mês.
 *
 * ⚠️ Agrupa o que já está CARREGADO. A coluna pagina de 20 em 20 por
 * `created_at`; o grupo cresce conforme a coluna carrega mais. Quem desenha o
 * grupo sinaliza quando ainda há página por vir.
 *
 * Genérico sobre o item: o board só garante `id`. Os acessores dizem onde
 * estão desfecho, data e valor.
 */

export type ClosedOutcome = "won" | "lost";

export interface ClosedGroupingAccessors<T> {
  /** `null` = negócio aberto: o card fica fora do agrupamento. */
  outcomeOf: (item: T) => ClosedOutcome | null | undefined;
  /** ISO do desfecho. Ausente ou inválido cai no mês "Sem data". */
  closedAtOf: (item: T) => string | null | undefined;
  /** Valor do negócio, para o total do grupo e do mês. */
  amountOf?: (item: T) => number | null | undefined;
}

export interface ClosedMonthGroup<T> {
  /** `YYYY-MM` no fuso local, ou `UNDATED_MONTH_KEY`. */
  key: string;
  /** "Setembro de 2026" / "Sem data". */
  label: string;
  items: T[];
  /** Soma dos valores conhecidos; `null` quando nenhum card do mês tem valor. */
  total: number | null;
}

export interface ClosedOutcomeGroup<T> {
  outcome: ClosedOutcome;
  items: T[];
  /** Mês mais recente primeiro; "Sem data" por último. */
  months: ClosedMonthGroup<T>[];
  total: number | null;
}

export interface PartitionedColumn<T> {
  open: T[];
  /** Ganhos antes de perdidos; grupo vazio não aparece. */
  closed: ClosedOutcomeGroup<T>[];
}

export const UNDATED_MONTH_KEY = "sem-data";

const OUTCOME_ORDER: ClosedOutcome[] = ["won", "lost"];

const MONTH_LABEL = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function monthKeyOf(time: number | null): string {
  if (time === null) return UNDATED_MONTH_KEY;
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabelOf(key: string): string {
  if (key === UNDATED_MONTH_KEY) return "Sem data";
  const [year, month] = key.split("-").map(Number);
  const label = MONTH_LABEL.format(new Date(year, month - 1, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function sumValues<T>(items: T[], amountOf?: (item: T) => number | null | undefined): number | null {
  if (!amountOf) return null;
  let total: number | null = null;
  for (const item of items) {
    const v = amountOf(item);
    if (typeof v === "number" && Number.isFinite(v)) total = (total ?? 0) + v;
  }
  return total;
}

/**
 * Separa abertos de encerrados preservando a ordem dos abertos (a ordenação
 * escolhida na coluna continua valendo para eles). Dentro do mês, o desfecho
 * mais recente vem primeiro.
 */
export function partitionClosedOutcomes<T>(
  items: readonly T[],
  accessors: ClosedGroupingAccessors<T>,
): PartitionedColumn<T> {
  const open: T[] = [];
  const byOutcome = new Map<ClosedOutcome, Array<{ item: T; time: number | null }>>();

  for (const item of items) {
    const outcome = accessors.outcomeOf(item);
    if (outcome !== "won" && outcome !== "lost") {
      open.push(item);
      continue;
    }
    const bucket = byOutcome.get(outcome) ?? [];
    bucket.push({ item, time: parseTime(accessors.closedAtOf(item)) });
    byOutcome.set(outcome, bucket);
  }

  const closed: ClosedOutcomeGroup<T>[] = [];
  for (const outcome of OUTCOME_ORDER) {
    const bucket = byOutcome.get(outcome);
    if (!bucket?.length) continue;

    // Mais recente primeiro; sem data no fim. `sort` é estável: empate mantém
    // a ordem que a coluna já tinha.
    const sorted = [...bucket].sort((a, b) => {
      if (a.time === b.time) return 0;
      if (a.time === null) return 1;
      if (b.time === null) return -1;
      return b.time - a.time;
    });

    const months = new Map<string, T[]>();
    for (const { item, time } of sorted) {
      const key = monthKeyOf(time);
      const list = months.get(key) ?? [];
      list.push(item);
      months.set(key, list);
    }

    // A ordem de inserção já é a decrescente (vem do sort), com "Sem data" por
    // último — porque os sem data foram os últimos a entrar.
    const monthGroups: ClosedMonthGroup<T>[] = [...months].map(([key, monthItems]) => ({
      key,
      label: monthLabelOf(key),
      items: monthItems,
      total: sumValues(monthItems, accessors.amountOf),
    }));

    const groupItems = sorted.map((s) => s.item);
    closed.push({
      outcome,
      items: groupItems,
      months: monthGroups,
      total: sumValues(groupItems, accessors.amountOf),
    });
  }

  return { open, closed };
}
