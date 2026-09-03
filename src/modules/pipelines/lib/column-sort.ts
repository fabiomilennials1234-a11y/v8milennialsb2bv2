/**
 * Ordenação dos cards dentro de uma coluna do board.
 *
 * O protótipo (`.specs/mockups/funis-redesign/`) punha "Ordenar por" no menu `…`
 * da coluna com cinco opções: manual, valor, **calor**, parado e **nome**. As
 * duas em negrito saíram a pedido do produto em 2026-08-31: "Nome" deu lugar a
 * "Última movimentação" (ordenar uma etapa em A–Z não responde pergunta que o
 * operador faça diante do board) e "Calor" foi embora sem substituta.
 *
 * Em 2026-09-03 o calor saiu da interface inteira — o `rating` do lead (que era
 * o que aquela opção realmente lia, sob rótulo errado) e o `calor` da entrada de
 * funil. Não há o que reintroduzir aqui.
 *
 * ## "Parado há" e "Última movimentação" são a MESMA leitura, invertida
 *
 * As duas lêem `COALESCE(stage_changed_at, entered_at, created_at)` — no card,
 * `stageEnteredAt ?? createdAt`. "Parado há" põe o mais antigo no topo (quem
 * está encalhado); "Última movimentação" põe o mais recente (quem acabou de se
 * mexer, incluindo quem acabou de entrar no funil e ainda não trocou de etapa).
 * **Se um dia mudar a âncora de uma, mude a da outra** — senão a mesma coluna
 * passa a dar duas respostas incompatíveis sobre o mesmo card.
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

export type ColumnSortKey = "manual" | "value" | "stalled" | "moved";

export const COLUMN_SORT_OPTIONS: { key: ColumnSortKey; label: string }[] = [
  { key: "manual", label: "Manual" },
  { key: "value", label: "Valor" },
  { key: "stalled", label: "Parado há" },
  // Vizinha da anterior de propósito: é o mesmo dado lido ao contrário.
  { key: "moved", label: "Última movimentação" },
];

export const DEFAULT_COLUMN_SORT: ColumnSortKey = "manual";

/**
 * `rating` saiu junto com a opção "Calor" — era seu único leitor aqui. Desde
 * 2026-09-03 ele também não existe mais no card nem em filtro nenhum.
 */
interface SortableCardShape {
  value?: number | null;
  stageEnteredAt?: string | null;
  createdAt?: string | null;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * `null` sempre depois, **independente da direção**.
 *
 * Ausência não é zero nem "época 0": card sem data ou sem valor não pode
 * encabeçar a lista só porque a direção inverteu. É o que faz "Parado há" e
 * "Última movimentação" concordarem sobre quem é desconhecido em vez de trocá-lo
 * de ponta.
 */
function compareNullLast(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * dir;
}

export function sortColumnItems<T>(items: T[], sortKey: ColumnSortKey): T[] {
  if (sortKey === "manual") return items;

  // Cópia: o array vem do cache do React Query e ordenar no lugar mutaria o
  // estado compartilhado entre a coluna, a Lista e a barra de seleção.
  const copy = [...items];
  const get = (item: T) => item as unknown as SortableCardShape;

  /**
   * A âncora que "Parado há" e "Última movimentação" compartilham —
   * `COALESCE(stage_changed_at, entered_at, created_at)` no SQL, que o card
   * entrega já resolvido em `stageEnteredAt` (as três páginas de funil mapeiam
   * `item.stage_entered_at || item.updated_at`; o custom, `stage_changed_at ??
   * entered_at ?? created_at`).
   *
   * Uma função só, deliberadamente: as duas opções são a mesma leitura em
   * direções opostas, e duplicar isto era o caminho curto pra elas divergirem.
   * `createdAt` no fim é o que cobre a entry antiga, anterior ao trigger, cujo
   * `stage_changed_at` é nulo — sem ele o card mais velho da etapa iria pro fim
   * da lista em vez do topo.
   */
  const movedAt = (item: T) => {
    const raw = get(item).stageEnteredAt ?? get(item).createdAt;
    if (!raw) return null;
    const t = new Date(raw).getTime();
    return Number.isNaN(t) ? null : t;
  };

  switch (sortKey) {
    case "value":
      return copy.sort((a, b) => compareNullLast(num(get(a).value), num(get(b).value), -1));

    // Mais parado primeiro = movimentação mais antiga primeiro.
    case "stalled":
      return copy.sort((a, b) => compareNullLast(movedAt(a), movedAt(b), 1));

    // Recém-mexido primeiro. Conta tanto a troca de etapa quanto a entrada no
    // funil de quem nunca trocou — é o que o operador chama de "movimentação".
    case "moved":
      return copy.sort((a, b) => compareNullLast(movedAt(a), movedAt(b), -1));
  }
}
