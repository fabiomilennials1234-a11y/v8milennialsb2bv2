export type SummarySection = { title: string; lines: string[] };

export const hasValue = (value: unknown): boolean =>
  value !== null && value !== undefined && value !== "";

export function summaryValue(value: unknown): string {
  if (!hasValue(value)) return "";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return String(value);
}

export function summaryField(label: string, value: unknown): string {
  return hasValue(value) ? `${label}: ${summaryValue(value)}` : "";
}

export const summaryMoney = (value: number, currency = "BRL"): string =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);

export function summaryDate(value: string | null): string {
  if (!value) return "";
  // Date-only custom fields must not shift to the previous day in local time.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value))
    return value.split("-").reverse().join("/");
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR");
}

export function formatSummary(sections: SummarySection[]): string {
  return [
    "RESUMO DO NEGÓCIO",
    ...sections.flatMap(({ title, lines }) => {
      const filled = lines.filter((line) => line !== "");
      return filled.length ? [`${title}\n${filled.join("\n")}`] : [];
    }),
  ].join("\n\n");
}

/** Fetch every page; an error must never produce a partial successful export. */
export async function summaryPages<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await fetchPage(from, from + 499);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}
