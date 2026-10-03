import { useSyncExternalStore } from "react";

/**
 * Efeitos do card do funil: ganho, perda e exclusão.
 *
 * ── Por que um store, e não estado do card ─────────────────────────────────
 * Quem decide o desfecho quase nunca é o card. É o painel do negócio (um
 * `Dialog` por cima do board), o menu `⋯` ou a barra de seleção. E o card que
 * precisa animar pode nem ser o mesmo nó de quando a ação começou: ao ganhar,
 * o banco move a entrada para a etapa de ganho (ADR-0023 Emenda 2), o board
 * refaz a consulta e o card REMONTA em outra coluna. Um store chaveado pelo id
 * da entrada sobrevive ao remonte, e o card anima onde chegou.
 *
 * ── O painel segura o efeito ───────────────────────────────────────────────
 * Ganhar dentro do painel e animar o card atrás do overlay seria animar para
 * ninguém. Enquanto o painel está aberto, o efeito espera; ele toca quando o
 * painel fecha (depois da animação de saída do diálogo). Reabrir o negócio
 * antes de fechar cancela o efeito que esperava.
 *
 * ── Exclusão anima um CLONE ────────────────────────────────────────────────
 * Excluir tira a entrada dos dados, e o refetch desmonta o card no meio da
 * poeira. Segurar a invalidação em cada um dos três caminhos de exclusão
 * espalharia a regra por hooks de dados. Em vez disso, `prepararDissolucao`
 * copia o nó do card e a posição dele ANTES de excluir. O clone é o que se
 * dissolve, num portal (`CardEffectsHost`), e o card real pode sumir quando os
 * dados mandarem.
 *
 * ── Movimento reduzido ─────────────────────────────────────────────────────
 * Com `prefers-reduced-motion`, nada anima: o card ganho já fica verde e o
 * excluído já some. O efeito é celebração, não informação.
 */

export type EfeitoDeDesfecho = "won" | "lost";

export interface EfeitoAtivo {
  readonly id: number;
  readonly efeito: EfeitoDeDesfecho;
  /**
   * Quando o efeito ficou VISÍVEL (`performance.now()`). O card que remonta no
   * meio — ganhou, o refetch o levou para a etapa de ganho — continua a onda
   * de onde ela estava, em vez de recomeçá-la.
   */
  readonly inicio: number;
}

export interface Fantasma {
  readonly id: number;
  readonly no: HTMLElement;
  readonly rect: { top: number; left: number; width: number; height: number };
}

/** Quanto o diálogo leva para sair — só depois disso o card aparece. */
const SAIDA_DO_PAINEL_MS = 220;
/** Efeito liberado que nenhum card consumiu (o board nem está montado). */
const VALIDADE_MS = 4000;
/** Exclusão em lote: acima disto, os cards somem sem poeira. */
const MAX_FANTASMAS = 24;
/** Card escondido que os dados não tiraram da tela: volta a aparecer. */
const DEVOLVER_CARD_MS = 5000;

let seq = 0;
let painelAberto = false;
let liberando: ReturnType<typeof setTimeout> | null = null;
const desfechos = new Map<string, EfeitoAtivo>();
const validade = new Map<string, ReturnType<typeof setTimeout>>();
let fantasmas: readonly Fantasma[] = [];
let fantasmasEsperando: Fantasma[] = [];
const ouvintes = new Set<() => void>();

function avisar() {
  for (const ouvir of ouvintes) ouvir();
}

function segurando(): boolean {
  return painelAberto || liberando !== null;
}

function movimentoReduzido(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function armarValidade(entryId: string, id: number) {
  const anterior = validade.get(entryId);
  if (anterior) clearTimeout(anterior);
  validade.set(
    entryId,
    setTimeout(() => concluirEfeito(entryId, id), VALIDADE_MS),
  );
}

function agora(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function liberar() {
  liberando = null;
  const t = agora();
  for (const [entryId, efeito] of desfechos) {
    desfechos.set(entryId, { ...efeito, inicio: t });
    armarValidade(entryId, efeito.id);
  }
  if (fantasmasEsperando.length) {
    fantasmas = [...fantasmas, ...fantasmasEsperando];
    fantasmasEsperando = [];
  }
  avisar();
}

// ── Painel do negócio ────────────────────────────────────────────────────

export function definirPainelAberto(aberto: boolean) {
  if (aberto === painelAberto) return;
  painelAberto = aberto;
  if (aberto) {
    if (liberando) clearTimeout(liberando);
    liberando = null;
    avisar();
    return;
  }
  liberando = setTimeout(liberar, SAIDA_DO_PAINEL_MS);
}

// ── Ganho e perda ────────────────────────────────────────────────────────

export function dispararEfeitoDeDesfecho(entryId: string, efeito: EfeitoDeDesfecho) {
  if (movimentoReduzido()) return;
  const ativo: EfeitoAtivo = { id: ++seq, efeito, inicio: agora() };
  desfechos.set(entryId, ativo);
  if (!segurando()) armarValidade(entryId, ativo.id);
  avisar();
}

/** Reabrir o negócio: o efeito que esperava o painel fechar não toca mais. */
export function cancelarEfeitoDeDesfecho(entryId: string) {
  if (!desfechos.delete(entryId)) return;
  const timer = validade.get(entryId);
  if (timer) clearTimeout(timer);
  validade.delete(entryId);
  avisar();
}

/** `id` evita que o fim de um efeito antigo apague um mais novo do mesmo card. */
export function concluirEfeito(entryId: string, id: number) {
  if (desfechos.get(entryId)?.id !== id) return;
  cancelarEfeitoDeDesfecho(entryId);
}

function assinar(ouvir: () => void) {
  ouvintes.add(ouvir);
  return () => ouvintes.delete(ouvir);
}

/** O efeito que ESTE card deve tocar agora — `null` enquanto o painel segura. */
export function useEfeitoDeDesfecho(entryId: string): EfeitoAtivo | null {
  return useSyncExternalStore(
    assinar,
    () => (segurando() ? null : desfechos.get(entryId) ?? null),
    () => null,
  );
}

const NENHUMA_ENTRADA: ReadonlySet<string> = new Set();
let emDesfecho: ReadonlySet<string> = NENHUMA_ENTRADA;

/** Snapshot estável: mesmo objeto enquanto o conjunto de ids não muda. */
function entradasEmDesfecho(): ReadonlySet<string> {
  if (desfechos.size === emDesfecho.size && [...desfechos.keys()].every((id) => emDesfecho.has(id))) {
    return emDesfecho;
  }
  emDesfecho = desfechos.size ? new Set(desfechos.keys()) : NENHUMA_ENTRADA;
  return emDesfecho;
}

/**
 * Entradas com efeito de ganho/perda pendente ou tocando — inclusive o que o
 * painel ainda segura. O board as mantém SOLTAS na coluna até a onda acabar:
 * sem isso o card ganho cairia direto na pilha de encerrados e a celebração
 * tocaria num card que ninguém vê. Com movimento reduzido não há efeito, e o
 * card vai direto para a pilha.
 */
export function useEntradasEmDesfecho(): ReadonlySet<string> {
  return useSyncExternalStore(assinar, entradasEmDesfecho, () => NENHUMA_ENTRADA);
}

/** Opacidade da onda: entra rápido, segura, sai devagar. `p` é o progresso 0–1. */
export function opacidadeDaOnda(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  if (p < 0.12) return p / 0.12;
  if (p < 0.62) return 1;
  return 1 - (p - 0.62) / 0.38;
}

// ── Exclusão ─────────────────────────────────────────────────────────────

export interface Dissolucao {
  /** A exclusão deu certo: o clone vira poeira. */
  dissolver(): void;
}

const NADA: Dissolucao = { dissolver() {} };

/**
 * Copia os cards visíveis destas entradas. Chame ANTES de excluir: depois, o
 * refetch pode já ter tirado o card do DOM. Se a exclusão falhar, basta não
 * chamar `dissolver` — o clone nunca foi montado.
 */
export function prepararDissolucao(entryIds: readonly string[]): Dissolucao {
  if (typeof document === "undefined" || movimentoReduzido() || entryIds.length === 0) return NADA;

  const capturados: Fantasma[] = [];
  const originais: HTMLElement[] = [];
  const altura = window.innerHeight;
  const largura = window.innerWidth;
  for (const entryId of entryIds) {
    if (capturados.length >= MAX_FANTASMAS) break;
    const el = document.querySelector<HTMLElement>(`[data-lead-id="${CSS.escape(entryId)}"]`);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    // Fora da tela ou colapsado: ninguém veria a poeira.
    if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > altura || r.right < 0 || r.left > largura) continue;

    const no = el.cloneNode(true) as HTMLElement;
    // O clone é imagem, não interface: sem ids duplicados, sem foco, sem leitor.
    no.removeAttribute("data-lead-id");
    no.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
    no.setAttribute("inert", "");
    no.setAttribute("aria-hidden", "true");
    no.style.margin = "0";
    originais.push(el);
    capturados.push({
      id: ++seq,
      no,
      rect: { top: r.top, left: r.left, width: r.width, height: r.height },
    });
  }

  if (capturados.length === 0) return NADA;
  return {
    dissolver() {
      // O card real some já: senão a poeira sairia de cima de um card inteiro
      // até o refetch chegar. Se os dados não o tirarem (exclusão que não se
      // refletiu), ele volta — card invisível ocupando lugar seria pior.
      for (const el of originais) {
        el.style.visibility = "hidden";
        setTimeout(() => {
          if (el.isConnected) el.style.visibility = "";
        }, DEVOLVER_CARD_MS);
      }
      if (segurando()) {
        fantasmasEsperando.push(...capturados);
        return;
      }
      fantasmas = [...fantasmas, ...capturados];
      avisar();
    },
  };
}

export function removerFantasma(id: number) {
  const restantes = fantasmas.filter((f) => f.id !== id);
  if (restantes.length === fantasmas.length) return;
  fantasmas = restantes;
  avisar();
}

export function useFantasmas(): readonly Fantasma[] {
  return useSyncExternalStore(assinar, () => fantasmas, () => fantasmas);
}

/** Só para testes: volta o módulo ao estado inicial. */
export function __reiniciarEfeitosDoCard() {
  if (liberando) clearTimeout(liberando);
  for (const t of validade.values()) clearTimeout(t);
  liberando = null;
  painelAberto = false;
  desfechos.clear();
  validade.clear();
  fantasmas = [];
  fantasmasEsperando = [];
  avisar();
}
