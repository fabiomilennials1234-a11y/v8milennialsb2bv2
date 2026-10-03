/**
 * A diferença entre o pacote montado e o plano base.
 *
 * Módulo PURO, separado dos componentes, porque aqui mora a regra que erra
 * calado: o que conta como "a mais", o que conta como "a menos", e o que a
 * lista mostra quando o operador filtra. Inspeção visual não pega inversão de
 * comparador — teste pega.
 *
 * O DIFF NÃO É PERSISTIDO, e isso é decisão de desenho (Prisma). Ele é
 * DERIVADO do pacote contra o plano base a cada render. Gravar o diff o
 * congelaria: mudar o plano base depois deixaria a proposta mentindo sobre o
 * que foi concedido. O que se grava é o pacote (`package_features`,
 * `package_limits`), que espelha `org_subscriptions`.
 */

/** -1 é o valor que o catálogo usa para ILIMITADO. */
export const LIMIT_UNLIMITED = -1;

/**
 * `settled` = era diferença quando o filtro foi ligado e voltou ao base desde
 * então. Existe para que nada SAIA da lista debaixo do dedo do operador.
 */
export type Direction = "same" | "up" | "down" | "settled";

/**
 * A direção de uma feature.
 *
 * Ligada e o base não tem  → up   (concessão)
 * Desligada e o base tem   → down (remoção)
 */
export function featureDirection(enabled: boolean, baseEnabled: boolean): Direction {
  if (enabled === baseEnabled) return "same";
  return enabled ? "up" : "down";
}

/**
 * A direção de um limite.
 *
 * ILIMITADO É TETO, não o número -1. Comparar `-1` como número faria
 * "ilimitado" parecer o MENOR limite possível — e a proposta mais generosa
 * apareceria marcada como "a menos". É o mesmo erro que o delta cometeria na
 * exibição, um nível abaixo.
 */
export function limitDirection(value: number, baseValue: number): Direction {
  if (value === baseValue) return "same";
  if (value === LIMIT_UNLIMITED) return "up";
  if (baseValue === LIMIT_UNLIMITED) return "down";
  return value > baseValue ? "up" : "down";
}

export function formatLimit(value: number): string {
  return value === LIMIT_UNLIMITED ? "Ilimitado" : value.toLocaleString("pt-BR");
}

export interface DiffCounts {
  up: number;
  down: number;
  total: number;
}

/**
 * A contagem do topo consome ESTE resultado, e os cards também.
 *
 * Um comparador só para os dois: se a linha usasse `limitDirection` e o
 * contador um `>` cru, o operador veria "a mais" no card e "a menos" na
 * contagem. Achado do Prisma.
 */
export function countDirections(directions: Direction[]): DiffCounts {
  const up = directions.filter((d) => d === "up").length;
  const down = directions.filter((d) => d === "down").length;
  return { up, down, total: up + down };
}

/**
 * Quais chaves a lista mostra, dadas as três regras do filtro (Prisma):
 *
 *   R1. Com o filtro LIGADO, nada SAI. Item que deixa de ser diferença FICA,
 *       remarcado como `settled`. Diferença NOVA entra.
 *   R2. Desligar e religar tira um retrato novo — é o único jeito de um item
 *       sair, e é ato deliberado do operador.
 *   R3. (no componente) o interruptor só some com zero diferenças E filtro
 *       desligado.
 *
 * Sem a R1, mexer em QUALQUER card faria ele sumir — porque com o filtro ligado
 * todo card visível é, por definição, uma diferença. A lista refluiria debaixo
 * do dedo e desfazer ficaria impossível: o card recém-clicado já não estaria na
 * tela.
 */
export function visibleKeys(
  allKeys: string[],
  currentDiffKeys: Set<string>,
  filterOn: boolean,
  snapshotKeys: Set<string> | null,
): string[] {
  if (!filterOn) return allKeys;

  // Guarda para estado que a UI não alcança, mas que pode EXISTIR: filtro
  // ligado vindo de fora (localStorage, deep link) com zero diferenças. Pela
  // R3 o interruptor está oculto nesse caso, e oculto não recebe clique — mas
  // estado impossível de ALCANÇAR não é estado impossível de EXISTIR. Achado do
  // Prisma, que só o encontrou clicando num elemento oculto por script.
  const snapshot = snapshotKeys ?? new Set<string>();
  const uniao = new Set([...snapshot, ...currentDiffKeys]);
  if (uniao.size === 0) return allKeys;

  return allKeys.filter((k) => uniao.has(k));
}

/**
 * A direção EXIBIDA, que não é a mesma coisa que a direção atual: com o filtro
 * ligado, um item que voltou ao base continua visível como `settled` em vez de
 * virar `same` e se confundir com quem nunca foi diferença.
 */
export function displayDirection(
  key: string,
  current: Direction,
  filterOn: boolean,
  snapshotKeys: Set<string> | null,
): Direction {
  if (current !== "same") return current;
  if (filterOn && snapshotKeys?.has(key)) return "settled";
  return "same";
}
