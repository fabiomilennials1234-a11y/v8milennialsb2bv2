import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { ehFocoDoNegocio, type FocoDoNegocio } from "./foco-no-funil";

/**
 * Optimistic drag-and-drop para os boards paginados — o legado
 * (`usePaginatedPipeline`, chaveado por slug) e a página unificada
 * (`usePaginatedFunil`, chaveada por `pipeline_id`).
 *
 * O board NÃO é uma query só: cada etapa é um `useInfiniteQuery` com chave
 * `["pipeline-page", boardKey, stageKey, orgId, filtersKey]` e data no formato
 * `{ pages: Entry[][], pageParams }`. As contagens das colunas vivem em
 * `["pipeline-stage-counts", boardKey, …]` como `Record<stage,num>`.
 * `boardKey` é o 2º elemento da chave: o slug no legado, o uuid no `/funil`.
 *
 * Antes deste helper o move só refletia na tela quando o eco do Realtime
 * (debounce 2s) invalidava o board — o card "voltava" e congelava ~2-3s. Aqui
 * movemos o card no cache na hora e devolvemos um snapshot para rollback no erro.
 *
 * Casa por prefixo de chave (`["pipeline-page", boardKey]`), então TODAS as
 * variantes de filtro da etapa são ajustadas — a reconciliação no `onSettled`
 * corrige qualquer divergência de filtro que o otimismo tenha deixado passar.
 *
 * ─── Reversão POR ENTRADA (CX ①, volta 2) ───────────────────────────────────
 *
 * Dois moves podem estar abertos ao mesmo tempo (a checagem de tarefa do Funil
 * é uma fila: o 2º arrasto já está no destino enquanto o 1º espera o modal).
 * Restaurar o snapshot INTEIRO das colunas no rollback do 1º apagaria o 2º —
 * o card do 2º voltava em silêncio, e, com os dois cancelados, sobrava um
 * fantasma. Por isso o rollback é a INVERSA do move, só daquela entrada: tira
 * o card de onde estiver no board, devolve à origem na posição em que estava,
 * contagens ±1. O resto do board fica como está.
 *
 * Mesma entrada movida duas vezes (a→p, depois p→n, ambos abertos): cancelar o
 * 1º não mexe na tela (quem manda na posição é o move mais novo), mas o 2º
 * herda a origem do 1º — se o 2º for cancelado depois, o card volta para `a`,
 * onde o banco está. Confirmar um move (`concluirMovePipelineEntry`) o tira da
 * lista sem herança: a origem do seguinte passa a ser a verdade do banco, e os
 * moves anteriores ainda abertos da mesma entrada ficam superados (reverter um
 * superado não mexe em posição nem contagem).
 */

type CacheEntry = [QueryKey, unknown];
type Linha = Record<string, unknown>;

/** De onde o card saiu — o que a inversa precisa para devolvê-lo. */
interface OrigemDoMove {
  /** Etapa de onde o card saiu (`null` quando não estava em cache). */
  fromStage: string | null;
  /** O card como estava na origem (etapa original). `null` = não estava em cache. */
  card: Linha | null;
  /** Posição em cada variante de filtro da origem (ver `Fora`). */
  posicoes: Array<{ key: QueryKey; fora: Fora }>;
  /** Queries de foco DESTA entrada, como estavam (o foco é por entrada). */
  foco: CacheEntry[];
  /** Chaves de contagem em que a origem perdeu 1 (hash da chave). */
  decrementados: string[];
}

export interface OptimisticMoveSnapshot {
  boardKey: string;
  id: string;
  toStage: string;
  /** Etapa de onde o card saiu (`null` quando não estava em cache). */
  fromStage: string | null;
  origem: OrigemDoMove;
  /** O move mexeu nas colunas (o card estava em cache)? */
  moveu: boolean;
  /** Chaves de contagem em que o destino ganhou 1 (hash da chave). */
  incrementados: string[];
}

interface InfiniteData {
  pages: unknown[][];
  pageParams: unknown[];
}

function isInfinite(data: unknown): data is InfiniteData {
  return !!data && Array.isArray((data as InfiniteData).pages);
}

const hashDaChave = (k: QueryKey) => JSON.stringify(k);

/**
 * Um card fora da coluna de origem por um move ainda aberto. `indice` é a
 * posição dele na coluna ORIGINAL — a de agora + todos os cards ainda fora.
 * Sem isso, dois cards da mesma coluna revertidos em ordem diferente da que
 * saíram voltariam trocados (o 2º saiu no índice 0 porque o 1º já tinha saído).
 */
interface Fora {
  pagina: number;
  indice: number;
}

/** Cards fora, por variante de coluna (hash da chave) — por QueryClient. */
const foraPorCliente = new WeakMap<QueryClient, Map<string, Fora[]>>();

function foraDa(qc: QueryClient, key: QueryKey): Fora[] {
  let m = foraPorCliente.get(qc);
  if (!m) {
    m = new Map();
    foraPorCliente.set(qc, m);
  }
  const h = hashDaChave(key);
  let l = m.get(h);
  if (!l) {
    l = [];
    m.set(h, l);
  }
  return l;
}

/** Card sai da coluna no índice `agora` da página: registra a posição original. */
function sair(qc: QueryClient, key: QueryKey, pagina: number, agora: number): Fora {
  const lista = foraDa(qc, key);
  let indice = agora;
  for (const f of lista.filter((x) => x.pagina === pagina).sort((a, b) => a.indice - b.indice)) {
    if (f.indice <= indice) indice += 1;
  }
  const fora = { pagina, indice };
  lista.push(fora);
  return fora;
}

/** Card volta: índice na coluna de AGORA (descontados os que seguem fora antes dele). */
function voltar(qc: QueryClient, key: QueryKey, fora: Fora): number {
  const lista = foraDa(qc, key);
  const i = lista.indexOf(fora);
  if (i >= 0) lista.splice(i, 1);
  return fora.indice - lista.filter((x) => x.pagina === fora.pagina && x.indice < fora.indice).length;
}

/** Card não volta mais (move gravado): a coluna original encolhe. */
function esquecerFora(qc: QueryClient, key: QueryKey, fora: Fora): void {
  const lista = foraDa(qc, key);
  const i = lista.indexOf(fora);
  if (i < 0) return;
  lista.splice(i, 1);
  for (const x of lista) if (x.pagina === fora.pagina && x.indice > fora.indice) x.indice -= 1;
}

/** Moves abertos por entrada, na ordem em que foram aplicados — por QueryClient. */
const abertosPorCliente = new WeakMap<QueryClient, Map<string, OptimisticMoveSnapshot[]>>();
const chaveDaEntrada = (boardKey: string, id: string) => `${boardKey}\u0000${id}`;

function abertosDe(qc: QueryClient): Map<string, OptimisticMoveSnapshot[]> {
  let m = abertosPorCliente.get(qc);
  if (!m) {
    m = new Map();
    abertosPorCliente.set(qc, m);
  }
  return m;
}

function tirarDosAbertos(qc: QueryClient, snap: OptimisticMoveSnapshot): { posicao: number; lista: OptimisticMoveSnapshot[] } {
  const abertos = abertosDe(qc);
  const k = chaveDaEntrada(snap.boardKey, snap.id);
  const lista = abertos.get(k) ?? [];
  const posicao = lista.indexOf(snap);
  if (posicao >= 0) lista.splice(posicao, 1);
  if (lista.length === 0) abertos.delete(k);
  return { posicao, lista };
}

export function optimisticMovePipelineEntry(
  qc: QueryClient,
  opts: { boardKey: string; id: string; toStage: string }
): OptimisticMoveSnapshot {
  const { boardKey, id, toStage } = opts;
  const pageKey: QueryKey = ["pipeline-page", boardKey];
  const countsKey: QueryKey = ["pipeline-stage-counts", boardKey];

  const pageCaches = qc.getQueriesData({ queryKey: pageKey });
  const countCaches = qc.getQueriesData({ queryKey: countsKey });

  const snapshot: OptimisticMoveSnapshot = {
    boardKey,
    id,
    toStage,
    fromStage: null,
    origem: { fromStage: null, card: null, posicoes: [], foco: [], decrementados: [] },
    moveu: false,
    incrementados: [],
  };
  const registrar = () => {
    const abertos = abertosDe(qc);
    const k = chaveDaEntrada(boardKey, id);
    abertos.set(k, [...(abertos.get(k) ?? []), snapshot]);
    return snapshot;
  };

  // 1) Remove o card de todas as páginas onde aparece; captura o card + origem.
  let moved: Linha | null = null;
  let fromStage: string | null = null;

  // A query de foco do "Ir para o negócio" anda junto com o card: ele sai do
  // topo da coluna de origem e chega no topo da de destino (a origem guarda o
  // foco desta entrada; a inversa o devolve). Há uma variante por filtro
  // (vivem 60 s): a FONTE do card é a que o board está mostrando (com
  // observador) e, sem nenhuma, a mais recente — uma variante sem linha nunca
  // apaga uma que tem.
  let fonteDoFoco: { foco: FocoDoNegocio; ativa: boolean; em: number } | null = null;
  for (const query of qc.getQueryCache().findAll({ queryKey: pageKey })) {
    const data = query.state.data;
    if (!ehFocoDoNegocio(data) || data.entryId !== id) continue;
    snapshot.origem.foco.push([query.queryKey, data]);
    if (data.linha) {
      const candidata = { foco: data, ativa: query.getObserversCount() > 0, em: query.state.dataUpdatedAt };
      const melhor =
        !fonteDoFoco ||
        (candidata.ativa !== fonteDoFoco.ativa ? candidata.ativa : candidata.em > fonteDoFoco.em);
      if (melhor) fonteDoFoco = candidata;
    }
    qc.setQueryData(query.queryKey, {
      ...data,
      stageKey: toStage,
      linha: data.linha ? { ...data.linha, stage_key: toStage, status: toStage } : null,
    });
  }

  for (const [key, data] of pageCaches) {
    if (!isInfinite(data)) continue;
    let hit = false;
    const newPages = data.pages.map((page, pagina) => {
      const arr = page as Linha[];
      const idx = arr.findIndex((e) => e?.id === id);
      if (idx >= 0) {
        moved = arr[idx];
        fromStage = (key as unknown[])[2] as string;
        snapshot.origem.posicoes.push({ key, fora: sair(qc, key, pagina, idx) });
        hit = true;
        return arr.filter((e) => e?.id !== id);
      }
      return page;
    });
    if (hit) qc.setQueryData(key, { ...data, pages: newPages });
  }

  // Card que só existe no foco (fundo da coluna, página nunca carregada): é ele
  // que se move, com a etapa que o foco leu do banco como origem.
  if (!moved && fonteDoFoco) {
    moved = fonteDoFoco.foco.linha;
    fromStage = fonteDoFoco.foco.stageKey;
  }

  // Card não estava em cache (coluna nunca carregada): reconciliação resolve.
  if (!moved) return registrar();
  snapshot.fromStage = fromStage;
  snapshot.origem.fromStage = fromStage;
  snapshot.origem.card = moved;
  snapshot.moveu = true;

  const movedNew = { ...(moved as Linha), stage_key: toStage, status: toStage };

  // 2) Insere na(s) cache(s) da etapa de destino (topo da 1ª página).
  for (const [key, data] of qc.getQueriesData({ queryKey: pageKey })) {
    if ((key as unknown[])[2] !== toStage) continue;

    if (!isInfinite(data) || data.pages.length === 0) {
      const pageParams = isInfinite(data) && data.pageParams.length ? data.pageParams : [null];
      qc.setQueryData(key, { pages: [[movedNew]], pageParams });
      continue;
    }
    const already = data.pages.some((p) => (p as Linha[]).some((e) => e?.id === id));
    if (already) continue;
    const [first, ...rest] = data.pages;
    qc.setQueryData(key, { ...data, pages: [[movedNew, ...(first as unknown[])], ...rest] });
  }

  // 3) Ajusta contagens: -1 na origem, +1 no destino.
  for (const [key, data] of countCaches) {
    const map = data as Record<string, number> | undefined;
    if (!map) continue;
    const next = { ...map };
    if (fromStage && typeof next[fromStage] === "number" && next[fromStage] > 0) {
      next[fromStage] -= 1;
      snapshot.origem.decrementados.push(hashDaChave(key));
    }
    next[toStage] = (typeof next[toStage] === "number" ? next[toStage] : 0) + 1;
    snapshot.incrementados.push(hashDaChave(key));
    qc.setQueryData(key, next);
  }

  return registrar();
}

/**
 * Inversa do move, só desta entrada (ver cabeçalho). Devolve `true` quando a
 * entrada ainda tem outro move aberto.
 */
export function rollbackPipelineEntryMove(
  qc: QueryClient,
  snapshot: OptimisticMoveSnapshot
): boolean {
  const { posicao, lista } = tirarDosAbertos(qc, snapshot);
  // Já revertido ou concluído: nada a desfazer (rollback duplo não dobra contagem).
  if (posicao < 0) return lista.length > 0;
  // Um move mais novo da MESMA entrada continua aberto: ele manda na tela e
  // herda a origem deste (o card, se ele também for cancelado, volta para
  // onde o banco está).
  const seguinte = lista[posicao];
  if (seguinte) {
    // A posição do seguinte na coluna intermediária deixa de existir: o card
    // nunca volta para lá.
    for (const { key, fora } of seguinte.origem.posicoes) esquecerFora(qc, key, fora);
    seguinte.origem = snapshot.origem;
    seguinte.fromStage = snapshot.origem.fromStage;
    return true;
  }

  const { boardKey, id, toStage, origem } = snapshot;
  const pageKey: QueryKey = ["pipeline-page", boardKey];

  // Foco: é por entrada — devolve como estava.
  for (const [key, data] of origem.foco) qc.setQueryData(key, data);

  if (snapshot.moveu) {
    // 1) Tira o card de onde estiver (destino, ou qualquer coluna para onde um
    //    refetch o tenha levado) — nunca dois do mesmo card.
    for (const [key, data] of qc.getQueriesData({ queryKey: pageKey })) {
      if (!isInfinite(data)) continue;
      if (!data.pages.some((p) => (p as Linha[]).some((e) => e?.id === id))) continue;
      qc.setQueryData(key, { ...data, pages: data.pages.map((p) => (p as Linha[]).filter((e) => e?.id !== id)) });
    }
    // 2) Devolve à origem, na posição em que estava (limitada ao que existe).
    for (const { key, fora } of origem.posicoes) {
      const indice = voltar(qc, key, fora);
      const data = qc.getQueryData(key);
      if (!origem.card || !isInfinite(data) || data.pages.length === 0) continue;
      const p = Math.min(fora.pagina, data.pages.length - 1);
      const pages = data.pages.map((page, i) => {
        if (i !== p) return page;
        const arr = [...(page as Linha[])];
        arr.splice(Math.min(Math.max(0, indice), arr.length), 0, origem.card as Linha);
        return arr;
      });
      qc.setQueryData(key, { ...data, pages });
    }
    // 3) Contagens: -1 no destino, +1 na origem (só onde o move tirou).
    const dec = new Set(origem.decrementados);
    const inc = new Set(snapshot.incrementados);
    for (const [key, data] of qc.getQueriesData({ queryKey: ["pipeline-stage-counts", boardKey] })) {
      const map = data as Record<string, number> | undefined;
      if (!map) continue;
      const h = hashDaChave(key);
      if (!dec.has(h) && !inc.has(h)) continue;
      const next = { ...map };
      if (inc.has(h) && typeof next[toStage] === "number") next[toStage] = Math.max(0, next[toStage] - 1);
      if (dec.has(h) && origem.fromStage) next[origem.fromStage] = (next[origem.fromStage] ?? 0) + 1;
      qc.setQueryData(key, next);
    }
  }
  return lista.length > 0;
}

/**
 * O move foi gravado: sai dos abertos sem herança (a origem dele virou passado).
 *
 * Os moves MAIS ANTIGOS da mesma entrada ainda abertos ficam SUPERADOS: a
 * gravação deles pode falhar depois (resposta fora de ordem — o 1º lento, o 2º
 * gravou antes), mas o banco já está no destino deste. Saem dos abertos sem
 * inversa, e a reversão deles vira no-op em posição e contagem (`posicao < 0`
 * em `rollbackPipelineEntryMove`). A coluna de onde o card saiu encolhe.
 */
export function concluirMovePipelineEntry(qc: QueryClient, snapshot: OptimisticMoveSnapshot): void {
  const { posicao, lista } = tirarDosAbertos(qc, snapshot);
  if (posicao < 0) return;
  const superados = lista.splice(0, posicao);
  if (lista.length === 0) abertosDe(qc).delete(chaveDaEntrada(snapshot.boardKey, snapshot.id));
  for (const s of [...superados, snapshot]) {
    for (const { key, fora } of s.origem.posicoes) esquecerFora(qc, key, fora);
  }
}
