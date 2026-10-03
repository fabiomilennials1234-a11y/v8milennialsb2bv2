/**
 * Teto de densidade da parede (spec §6.4).
 *
 * Máx 12 widgets por página. Se houver `hero`, máx 8.
 *
 * O GATILHO DO TETO DE 8 É A TIPOGRAFIA, NÃO O TAMANHO DA CÉLULA. Só conta como
 * hero o widget que usa `--tv-hero` (56–96px). Um bloco grande em células mas com
 * tipo `--tv-value` — caso do `Thermometer` congelado, que ocupa 3×4 — NÃO dispara
 * o teto de 8. Sem essa distinção qualquer widget largo derrubaria o teto pela
 * metade e a regra ficaria intratável.
 *
 * Não é preferência: a 1080p com valores de 36–56px, 12 células é o ponto onde a
 * escala mínima ainda cabe. Passar disso força tipo menor, e tipo menor quebra a
 * leitura a 3m — que é a razão de a tela existir.
 */

export const GRID_COLS = 12;
export const GRID_ROWS = 6;
export const CELLS_PER_PAGE = GRID_COLS * GRID_ROWS; // 72

export const MAX_WIDGETS_PER_PAGE = 12;
export const MAX_WIDGETS_PER_PAGE_WITH_HERO = 8;

export interface DensityItem {
  weight?: string | null;
}

/** Só a tipografia hero conta para o teto reduzido. */
export function hasHeroTypography(items: DensityItem[]): boolean {
  return items.some((i) => i.weight === "hero");
}

/** Teto efetivo da página, dado o conjunto de widgets. */
export function densityCeiling(items: DensityItem[]): number {
  return hasHeroTypography(items) ? MAX_WIDGETS_PER_PAGE_WITH_HERO : MAX_WIDGETS_PER_PAGE;
}

export interface DensityResult<T> {
  /** Widgets que cabem no teto — a parede renderiza só estes. */
  visible: T[];
  /** Widgets acima do teto. O motor os distribui em páginas novas (#1222). */
  overflow: T[];
  ceiling: number;
}

/**
 * Aplica o teto. O excedente NÃO é escondido em silêncio: volta em `overflow`
 * para que o chamador registre/distribua. Encolher tipografia nunca é a saída —
 * a saída correta é uma página nova (§8.4.6).
 */
export function applyDensityCeiling<T extends DensityItem>(items: T[]): DensityResult<T> {
  const ceiling = densityCeiling(items);
  if (items.length <= ceiling) return { visible: items, overflow: [], ceiling };
  return { visible: items.slice(0, ceiling), overflow: items.slice(ceiling), ceiling };
}

export interface CellFootprint {
  grid_w?: number | null;
  grid_h?: number | null;
}

/** Células gastas — os `pinned` custam uma vez POR PÁGINA, não uma vez no painel. */
export function cellsUsed(items: CellFootprint[]): number {
  return items.reduce((sum, i) => sum + Math.max(1, i.grid_w ?? 1) * Math.max(1, i.grid_h ?? 1), 0);
}
