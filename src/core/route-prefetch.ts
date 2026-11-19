/**
 * Pré-carregamento de rota e "rota pendente" — sem nenhum import de módulo.
 *
 * O mapa caminho → `import()` mora no App.tsx (que já faz os imports
 * dinâmicos) e entra aqui por `registrarRotas`. Se este arquivo importasse as
 * páginas, o Sidebar (que chama `preCarregarRota`) fecharia o ciclo
 * Sidebar → Configuracoes → layout → Sidebar (`no-circular-dynamic`).
 *
 * Duas peças:
 *   `preCarregarRota(path)` — baixa o chunk na intenção (hover/foco no trilho),
 *       uma vez por rota; respeita economia de dados e 2g.
 *   `rastrearCarga(p)` + `useRotaPendente()` — o BrowserRouter do RR 7 navega
 *       em transição: a tela antiga fica congelada, sem fallback, enquanto o
 *       chunk da nova desce. Quem embrulha o `lazy` com `rastrearCarga` faz o
 *       `IndicadorDePendencia` aparecer quando isso passa de 100 ms.
 */
import { useSyncExternalStore } from "react";

type Importador = () => Promise<unknown>;

/** Chunk em voo por menos que isso não merece indicador (régua: invisível < 100 ms). */
const LIMIAR_PENDENTE_MS = 100;

let rotas = new Map<string, Importador>();
const iniciadas = new Set<string>();

let emVoo = 0;
let pendente = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const ouvintes = new Set<() => void>();

function avisar() {
  for (const o of ouvintes) o();
}

function definirPendente(v: boolean) {
  if (pendente === v) return;
  pendente = v;
  avisar();
}

export function registrarRotas(m: Record<string, () => Promise<unknown>>): void {
  for (const [caminho, imp] of Object.entries(m)) rotas.set(caminho, imp);
}

function limpar(path: string): string {
  const semResto = path.split(/[?#]/, 1)[0] || "/";
  return semResto.length > 1 ? semResto.replace(/\/+$/, "") : semResto;
}

function casa(padrao: string, caminho: string): boolean {
  const a = padrao.split("/");
  const b = caminho.split("/");
  if (a.length !== b.length) return false;
  return a.every((seg, i) => seg.startsWith(":") ? b[i].length > 0 : seg === b[i]);
}

function resolver(path: string): [string, Importador] | null {
  const caminho = limpar(path);
  const exato = rotas.get(caminho);
  if (exato) return [caminho, exato];
  for (const [padrao, imp] of rotas) {
    if (padrao.includes(":") && casa(padrao, caminho)) return [padrao, imp];
  }
  return null;
}

interface InformacaoDeRede {
  saveData?: boolean;
  effectiveType?: string;
}

function conexaoPoupa(): boolean {
  if (typeof navigator === "undefined") return false;
  const c = (navigator as Navigator & { connection?: InformacaoDeRede }).connection;
  if (!c) return false;
  return c.saveData === true || (c.effectiveType ?? "").includes("2g");
}

/** Baixa o chunk da rota. Idempotente; falha libera nova tentativa. */
export function preCarregarRota(path: string): void {
  if (conexaoPoupa()) return;
  const achada = resolver(path);
  if (!achada) return;
  const [chave, imp] = achada;
  if (iniciadas.has(chave)) return;
  iniciadas.add(chave);
  imp().catch(() => iniciadas.delete(chave));
}

/** Embrulha a carga de um chunk de rota: `lazy(() => rastrearCarga(lazyRetry(...)))`. */
export function rastrearCarga<T>(p: Promise<T>): Promise<T> {
  emVoo += 1;
  if (timer === null) {
    timer = setTimeout(() => {
      timer = null;
      if (emVoo > 0) definirPendente(true);
    }, LIMIAR_PENDENTE_MS);
  }
  const terminar = () => {
    emVoo = Math.max(0, emVoo - 1);
    if (emVoo === 0) {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      definirPendente(false);
    }
  };
  return p.then(
    (v) => {
      terminar();
      return v;
    },
    (e) => {
      terminar();
      throw e;
    },
  );
}

function assinar(o: () => void) {
  ouvintes.add(o);
  return () => ouvintes.delete(o);
}

/** Verdadeiro enquanto um chunk de rota está em voo há mais de 100 ms. */
export function useRotaPendente(): boolean {
  return useSyncExternalStore(assinar, () => pendente, () => false);
}

/** Só testes. */
export function __resetarRotasParaTestes(): void {
  rotas = new Map();
  iniciadas.clear();
  emVoo = 0;
  pendente = false;
  if (timer !== null) clearTimeout(timer);
  timer = null;
}
