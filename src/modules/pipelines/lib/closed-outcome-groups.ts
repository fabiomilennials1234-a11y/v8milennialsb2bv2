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
 * Os CARDS são os que a coluna já carregou — ela pagina de 20 em 20 por
 * `created_at`. Os NÚMEROS (quantos e quanto, no grupo e no mês) vêm do resumo
 * do servidor (`get_funil_desfecho_por_mes`) quando ele existe: a etapa
 * inteira, não a página (Chamado 172ef046 — "setembro: 8" quando eram 69).
 * Sem resumo (RPC ausente, erro, filtro ativo no board), os números são do
 * carregado e o grupo diz que não é exato (`exact: false`); quem desenha marca
 * a parcialidade quando ainda há página por vir.
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
  /** Os cards CARREGADOS do mês — pode ser menos que `count`, ou nenhum. */
  items: T[];
  /** Quantos negócios o mês tem: da etapa com resumo; senão, os carregados. */
  count: number;
  /** Soma dos valores conhecidos; `null` quando nenhum negócio do mês tem valor. */
  total: number | null;
}

export interface ClosedOutcomeGroup<T> {
  outcome: ClosedOutcome;
  /** Os cards CARREGADOS do grupo, mais recente primeiro. */
  items: T[];
  /** Mês mais recente primeiro; "Sem data" por último. */
  months: ClosedMonthGroup<T>[];
  /** Soma das contagens dos meses. */
  count: number;
  total: number | null;
  /**
   * `true` = contagem e valores vêm do resumo do servidor e valem para a etapa
   * inteira. `false` = são do que a coluna carregou.
   */
  exact: boolean;
}

/**
 * Uma linha do resumo do servidor para UMA coluna: quantos negócios a etapa
 * tem com aquele desfecho naquele mês, e quanto somam. O mês é calculado no
 * banco no fuso do navegador (`p_tz`), então casa com `monthKeyOf`.
 */
export interface ClosedMonthSummary {
  outcome: ClosedOutcome;
  /** `YYYY-MM`, ou `UNDATED_MONTH_KEY`. */
  monthKey: string;
  count: number;
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

function addTotals(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

/** Ordem dos meses: mais recente primeiro, "Sem data" por último. */
function compareMonthKeys(a: string, b: string): number {
  if (a === b) return 0;
  if (a === UNDATED_MONTH_KEY) return 1;
  if (b === UNDATED_MONTH_KEY) return -1;
  return a < b ? 1 : -1;
}

/**
 * Separa abertos de encerrados preservando a ordem dos abertos (a ordenação
 * escolhida na coluna continua valendo para eles). Dentro do mês, o desfecho
 * mais recente vem primeiro.
 *
 * `summary` (opcional) é o resumo do servidor para ESTA coluna. Com ele, a
 * contagem e o valor de cada mês são os da etapa inteira; meses e grupos que
 * só o servidor conhece aparecem com a contagem e sem card. Se o carregado
 * passa o resumo num mês (resumo velho entre um move e o refetch), vale o
 * carregado naquele mês — card na tela é prova de que o mês tem pelo menos
 * aquilo.
 */
export function partitionClosedOutcomes<T>(
  items: readonly T[],
  accessors: ClosedGroupingAccessors<T>,
  summary?: readonly ClosedMonthSummary[] | null,
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

  const exact = summary != null;
  const serverMonths = new Map<ClosedOutcome, Map<string, { count: number; total: number | null }>>();
  for (const row of summary ?? []) {
    const months = serverMonths.get(row.outcome) ?? new Map<string, { count: number; total: number | null }>();
    const prev = months.get(row.monthKey);
    months.set(row.monthKey, {
      count: (prev?.count ?? 0) + row.count,
      total: addTotals(prev?.total ?? null, row.total),
    });
    serverMonths.set(row.outcome, months);
  }

  const closed: ClosedOutcomeGroup<T>[] = [];
  for (const outcome of OUTCOME_ORDER) {
    const bucket = byOutcome.get(outcome) ?? [];
    const fromServer = serverMonths.get(outcome);
    if (!bucket.length && !fromServer?.size) continue;

    // Mais recente primeiro; sem data no fim. `sort` é estável: empate mantém
    // a ordem que a coluna já tinha.
    const sorted = [...bucket].sort((a, b) => {
      if (a.time === b.time) return 0;
      if (a.time === null) return 1;
      if (b.time === null) return -1;
      return b.time - a.time;
    });

    const loadedByMonth = new Map<string, T[]>();
    for (const { item, time } of sorted) {
      const key = monthKeyOf(time);
      const list = loadedByMonth.get(key) ?? [];
      list.push(item);
      loadedByMonth.set(key, list);
    }

    const monthKeys = [...new Set([...loadedByMonth.keys(), ...(fromServer?.keys() ?? [])])].sort(
      compareMonthKeys,
    );

    const monthGroups: ClosedMonthGroup<T>[] = monthKeys.map((key) => {
      const monthItems = loadedByMonth.get(key) ?? [];
      const loadedTotal = sumValues(monthItems, accessors.amountOf);
      const server = fromServer?.get(key);
      const useServer = server !== undefined && server.count >= monthItems.length;
      return {
        key,
        label: monthLabelOf(key),
        items: monthItems,
        count: useServer ? server.count : monthItems.length,
        total: useServer ? server.total : loadedTotal,
      };
    });

    closed.push({
      outcome,
      items: sorted.map((s) => s.item),
      months: monthGroups,
      count: monthGroups.reduce((n, m) => n + m.count, 0),
      total: monthGroups.reduce<number | null>((acc, m) => addTotals(acc, m.total), null),
      exact,
    });
  }

  return { open, closed };
}
