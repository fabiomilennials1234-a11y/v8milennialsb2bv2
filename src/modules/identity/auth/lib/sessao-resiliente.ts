/**
 * Sessão que não cai à toa (Café Jurerê, 11/11 — a Rafaeli era derrubada a
 * cada ~1 h: 10 sessões em 3 dias, metade sem nenhuma renovação).
 *
 * O supabase-js renova o token de acesso pelo RELÓGIO DO COMPUTADOR. Com o
 * relógio atrasado, ele acha que o token ainda vale quando, para o servidor, já
 * venceu: toda consulta volta 401 ("JWT expired") até a renovação, e a tela
 * dizia "Sua sessão expirou" — mas a sessão estava viva (o refresh token vale).
 *
 * Três defesas, todas aqui, puras e testáveis:
 *   1. `ehTokenVencido`: reconhece o 401 de token de ACESSO vencido (não o de
 *      sessão revogada, que não tem conserto e deve mesmo pedir login).
 *   2. `criarRenovador`: uma renovação por vez (várias consultas falham juntas)
 *      e um intervalo mínimo depois de falhar, para nunca virar laço.
 *   3. `defasagemDoRelogio` + `msAteRenovar`: mede o quanto o relógio local
 *      está errado pelo `iat` do token recém-emitido e agenda a renovação pela
 *      hora do SERVIDOR.
 */

/** Diferença tolerada entre o relógio local e o do servidor. */
export const DEFASAGEM_TOLERADA_MS = 60_000;
/** Renovar este tanto antes do vencimento, na hora do servidor. */
export const MARGEM_DE_RENOVACAO_MS = 60_000;
/** Depois de uma renovação que falhou, não tentar de novo antes disto. */
export const ESPERA_APOS_FALHA_MS = 30_000;

function campo(obj: unknown, nome: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[nome] : undefined;
}

/**
 * O erro é "token de acesso vencido"? PostgREST devolve PGRST301/PGRST303 com
 * "JWT expired"; o gateway das edge functions, 401 com a mesma frase.
 * Sessão revogada, refresh token inválido e afins NÃO entram: renovar não
 * resolve, e a tela de "entre de novo" é a resposta certa.
 */
export function ehTokenVencido(erro: unknown): boolean {
  if (!erro) return false;
  const code = String(campo(erro, "code") ?? "");
  if (code === "PGRST301" || code === "PGRST303") return true;
  const message = String(campo(erro, "message") ?? (typeof erro === "string" ? erro : ""));
  return /jwt expired/i.test(message);
}

/**
 * Renovação única e com freio. `renovar` é quem fala com o Auth
 * (`supabase.auth.refreshSession`) e devolve se deu certo.
 */
export function criarRenovador(renovar: () => Promise<boolean>, agora: () => number = Date.now) {
  let emCurso: Promise<boolean> | null = null;
  let falhouEm = 0;
  return function renovarSessao(): Promise<boolean> {
    if (emCurso) return emCurso;
    if (falhouEm && agora() - falhouEm < ESPERA_APOS_FALHA_MS) return Promise.resolve(false);
    emCurso = renovar()
      .catch(() => false)
      .then((ok) => {
        falhouEm = ok ? 0 : agora();
        return ok;
      })
      .finally(() => {
        emCurso = null;
      });
    return emCurso;
  };
}

/** Lê o payload de um JWT (sem validar — só para ler `iat`/`exp`, que o servidor emitiu). */
export function payloadDoJwt(token: string | null | undefined): { iat?: number; exp?: number } | null {
  const parte = token?.split(".")[1];
  if (!parte) return null;
  try {
    const base64 = parte.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
    return JSON.parse(json) as { iat?: number; exp?: number };
  } catch {
    return null;
  }
}

/**
 * Quanto o relógio local está errado, em ms (positivo = adiantado, negativo =
 * atrasado). Só vale para um token RECÉM-emitido (login ou renovação): o `iat`
 * é a hora do servidor naquele instante.
 */
export function defasagemDoRelogio(accessToken: string | null | undefined, agoraMs: number = Date.now()): number | null {
  const iat = payloadDoJwt(accessToken)?.iat;
  return typeof iat === "number" ? agoraMs - iat * 1000 : null;
}

/** Em quanto tempo (relógio local) renovar para fazê-lo antes do vencimento na hora do servidor. */
export function msAteRenovar(expSegundos: number, defasagemMs: number, agoraMs: number = Date.now()): number {
  const agoraNoServidor = agoraMs - defasagemMs;
  return Math.max(0, expSegundos * 1000 - MARGEM_DE_RENOVACAO_MS - agoraNoServidor);
}

/** "12 min atrasado" / "3 min adiantado". */
export function descreverDefasagem(defasagemMs: number): string {
  const minutos = Math.max(1, Math.round(Math.abs(defasagemMs) / 60_000));
  return `${minutos} min ${defasagemMs < 0 ? "atrasado" : "adiantado"}`;
}
