/**
 * Medição de espera — quanto tempo até a tela ficar ÚTIL, e os Web Vitals.
 *
 * Régua de espera (CX ①). Duas famílias de evento em `usage_events`:
 *   `perf_util` — tela útil (`useMarcarUtil`): {tela, ms, origem, amostra, v}
 *   `web_vital` — LCP/INP/CLS/FCP/TTFB:       {nome, valor, avaliacao, tipo_navegacao, tela?}
 *
 * Privacidade: a metadata é montada AQUI, chave por chave, a partir da lista
 * `CHAVES_PERMITIDAS` — nunca URL, path, id ou conteúdo (o `Metric` do
 * web-vitals carrega `entries`/`attribution` com URL; nada disso sai). Sem
 * `entity_id`. O snapshot em tests/unit/perf/medicao.test.ts trava a lista.
 *
 * Custo: buffer em memória, UMA ida em lote quando a aba esconde
 * (`visibilitychange:hidden`) ou a página sai (`pagehide`). Sessão sorteada
 * uma vez (amostra fixa por sessão); fora da amostra, nenhum ouvinte é ligado.
 *
 * Linha sem organização é descartada: o INSERT exige org e a medição não
 * pode inventar uma. A org entra pelo `definirOrgDaMedicao` (App.tsx).
 */
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals";
import { acompanharSessaoParaLote, trackLote, type EventoDeUso } from "@/lib/analytics";
import { getSessionId } from "@/core/trace/request-trace";

export type Tela = "chat" | "comando" | "funil" | "ficha_lead" | "ficha_negocio";
export type OrigemUtil = "carga" | "navegacao";

/** Fração de sessões medidas. Constante: muda o volume de `usage_events`. */
export const AMOSTRA_PADRAO = 0.5;
/** Versão do formato do `perf_util` — sobe quando a forma de medir muda. */
const VERSAO = 1;
/** Marca de navegação mais velha que isso não é desta tela. */
const VALIDADE_DA_MARCA_MS = 30_000;
/** Tela montada depois disso não conta como "carga" da página. */
const JANELA_DA_CARGA_MS = 15_000;
/** Teto do buffer: descarrega antes de crescer sem limite numa aba eterna. */
const TETO_DO_BUFFER = 50;
/** Valor acima disso é aba dormindo, não espera. */
const TETO_MS = 120_000;

export const CHAVES_PERMITIDAS = {
  perf_util: ["tela", "ms", "origem", "amostra", "v"],
  web_vital: ["nome", "valor", "avaliacao", "tipo_navegacao", "tela"],
} as const;

interface Linha {
  event: "perf_util" | "web_vital";
  org: string | null;
  metadata: Record<string, string | number>;
}

let instalado = false;
let amostrado = false;
let amostra = AMOSTRA_PADRAO;
let org: string | null = null;
let fila: Linha[] = [];
let inicioNav: number | null = null;
let cargaConsumida = false;
let ultimaTela: Tela | null = null;

const agora = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** FNV-1a de 32 bits → [0,1). Mesmo id de sessão, mesmo sorteio. */
export function sorteioDaSessao(sessionId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < sessionId.length; i++) {
    h ^= sessionId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x1_0000_0000;
}

function enfileirar(linha: Omit<Linha, "org">) {
  if (!amostrado) return;
  fila.push({ ...linha, org });
  if (fila.length >= TETO_DO_BUFFER) descarregar();
}

/** `saindo`: aba escondendo/fechando — o lote vai com `keepalive` (ver `trackLote`). */
function descarregar(saindo = false) {
  if (fila.length === 0) return;
  const linhas = fila;
  fila = [];
  const eventos: EventoDeUso[] = [];
  for (const l of linhas) {
    const organizationId = l.org ?? org;
    if (!organizationId) continue;
    eventos.push({ event: l.event, organizationId, metadata: l.metadata });
  }
  if (eventos.length > 0) trackLote(eventos, saindo ? { saindo: true } : undefined);
}

function aoEsconder() {
  if (document.visibilityState === "hidden") descarregar(true);
}

function aoSairDaPagina() {
  descarregar(true);
}

/** Clique simples num link interno: início de navegação. */
function aoClicar(e: MouseEvent) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const alvo = e.target instanceof Element ? e.target.closest("a[href]") : null;
  if (!(alvo instanceof HTMLAnchorElement)) return;
  if (alvo.target && alvo.target !== "_self") return;
  if (alvo.origin !== window.location.origin) return;
  marcarInicioNavegacao();
}

function arredondar(nome: Metric["name"], valor: number): number {
  // CLS é fração (0.1 = limiar bom); o resto é milissegundo.
  return nome === "CLS" ? Math.round(valor * 1000) / 1000 : Math.round(valor);
}

function reportarVital(m: Metric) {
  const metadata: Record<string, string | number> = {
    nome: m.name,
    valor: arredondar(m.name, m.value),
    avaliacao: m.rating,
    tipo_navegacao: m.navigationType,
  };
  if (ultimaTela) metadata.tela = ultimaTela;
  enfileirar({ event: "web_vital", metadata });
}

/** Liga a medição. 1× em main.tsx; chamadas seguintes são ignoradas. */
export function iniciarMedicao(o: { amostra: number }): void {
  if (instalado || typeof window === "undefined") return;
  instalado = true;
  amostra = o.amostra;
  amostrado = sorteioDaSessao(getSessionId()) < amostra;
  if (!amostrado) return;

  acompanharSessaoParaLote();
  document.addEventListener("visibilitychange", aoEsconder);
  window.addEventListener("pagehide", aoSairDaPagina);
  document.addEventListener("click", aoClicar, true);
  window.addEventListener("popstate", marcarInicioNavegacao);

  onLCP(reportarVital);
  onINP(reportarVital);
  onCLS(reportarVital);
  onFCP(reportarVital);
  onTTFB(reportarVital);
}

export function definirOrgDaMedicao(orgId: string | null): void {
  org = orgId;
}

export function marcarInicioNavegacao(): void {
  inicioNav = agora();
}

export function registrarUtil(tela: Tela, ms: number, origem: OrigemUtil): void {
  if (!amostrado || !Number.isFinite(ms) || ms < 0 || ms > TETO_MS) return;
  ultimaTela = tela;
  enfileirar({
    event: "perf_util",
    metadata: { tela, ms: Math.round(ms), origem, amostra, v: VERSAO },
  });
}

/**
 * Quanto a tela montada em `montadoEm` levou até ficar útil em `instante`.
 *   - navegação marcada ANTES da montagem e há ≤30 s → desde o clique;
 *   - nenhuma navegação e a página acabou de abrir → desde a origem (carga);
 *   - qualquer outro caso → null (não sabemos quando a espera começou).
 * A marca é consumida: a próxima tela não herda o clique desta.
 */
export function calcularUtil(montadoEm: number, instante: number): { ms: number; origem: OrigemUtil } | null {
  if (inicioNav !== null && inicioNav <= montadoEm && instante - inicioNav <= VALIDADE_DA_MARCA_MS) {
    const ms = instante - inicioNav;
    inicioNav = null;
    cargaConsumida = true;
    return { ms, origem: "navegacao" };
  }
  if (!cargaConsumida && inicioNav === null && montadoEm <= JANELA_DA_CARGA_MS) {
    cargaConsumida = true;
    return { ms: instante, origem: "carga" };
  }
  return null;
}

/** Só testes: zera o estado do módulo e solta os ouvintes. */
export function __resetarMedicaoParaTestes(): void {
  if (typeof window !== "undefined") {
    document.removeEventListener("visibilitychange", aoEsconder);
    window.removeEventListener("pagehide", aoSairDaPagina);
    document.removeEventListener("click", aoClicar, true);
    window.removeEventListener("popstate", marcarInicioNavegacao);
  }
  instalado = false;
  amostrado = false;
  amostra = AMOSTRA_PADRAO;
  org = null;
  fila = [];
  inicioNav = null;
  cargaConsumida = false;
  ultimaTela = null;
}

/** Medição ativa nesta sessão? (para quem quer evitar trabalho à toa) */
export function medicaoAtiva(): boolean {
  return amostrado;
}

/** Instante atual no relógio da medição. */
export const instanteDaMedicao = agora;
