/**
 * Ordenação dos cards dentro de uma coluna do board.
 *
 * O protótipo (`.specs/mockups/funis-redesign/`) põe "Ordenar por" no menu `…`
 * da coluna: manual, valor, calor, parado e nome.
 *
 * ⚠️ Ordena **o que já está carregado**. O board pagina de 20 em 20 por cursor
 * de `created_at`; trocar o ORDER BY no servidor invalidaria esse cursor e
 * faria a paginação pular ou repetir cards. Por isso a ordenação é client-side,
 * e a coluna avisa na tela quando ainda há página por carregar — em vez de
 * deixar o operador achar que o topo da lista é o maior valor da etapa quando é
 * só o maior dos 20 primeiros.
 *
 * Os campos são lidos por duck-typing porque o board é genérico sobre
 * `DraggableItem` (só garante `id`), enquanto na prática as três páginas de
 * funil passam `LeadCardData`. Campo ausente vai pro fim da lista em vez de
 * quebrar a ordem.
 */

export type ColumnSortKey = "manual" | "value" | "heat" | "stalled" | "name";

export const COLUMN_SORT_OPTIONS: { key: ColumnSortKey; label: string }[] = [
  { key: "manual", label: "Manual" },
  { key: "value", label: "Valor" },
  { key: "heat", label: "Calor" },
  { key: "stalled", label: "Parado há" },
  { key: "name", label: "Nome" },
];

export const DEFAULT_COLUMN_SORT: ColumnSortKey = "manual";

interface SortableCardShape {
  value?: number | null;
  rating?: number | null;
  stageEnteredAt?: string | null;
  createdAt?: string | null;
  name?: string | null;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** `null` sempre depois, independente da direção da ordenação. */
function compareNullableDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

export function sortColumnItems<T>(items: T[], sortKey: ColumnSortKey): T[] {
  if (sortKey === "manual") return items;

  // Cópia: o array vem do cache do React Query e ordenar no lugar mutaria o
  // estado compartilhado entre a coluna, a Lista e a barra de seleção.
  const copy = [...items];
  const get = (item: T) => item as unknown as SortableCardShape;

  switch (sortKey) {
    case "value":
      return copy.sort((a, b) => compareNullableDesc(num(get(a).value), num(get(b).value)));

    case "heat":
      return copy.sort((a, b) => compareNullableDesc(num(get(a).rating), num(get(b).rating)));

    case "stalled": {
      // Mais parado primeiro = data de entrada na etapa mais antiga primeiro.
      const at = (item: T) => {
        const raw = get(item).stageEnteredAt ?? get(item).createdAt;
        if (!raw) return null;
        const t = new Date(raw).getTime();
        return Number.isNaN(t) ? null : t;
      };
      return copy.sort((a, b) => {
        const ta = at(a);
        const tb = at(b);
        if (ta === null && tb === null) return 0;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return ta - tb;
      });
    }

    case "name":
      return copy.sort((a, b) =>
        (get(a).name ?? "").localeCompare(get(b).name ?? "", "pt-BR", {
          sensitivity: "base",
          numeric: true,
        }),
      );
  }
}
