/**
 * Interface nova (V5) ou clássica, por organização — a parte que as DUAS builds
 * compartilham. A clássica (`classic/`) importa este arquivo pelo alias
 * `@torque/ui-version`; por isso ele não importa nada do projeto.
 *
 * Quem escolhe a build é o nginx, pelo cookie `torque_ui` (ver
 * docs/ui-v5/interface-por-organizacao.md). Quem escreve o cookie é a guarda de
 * cada build, a partir de `organizations.ui_v5_enabled`.
 */

export type UiVersion = "v5" | "classic";

export const UI_COOKIE = "torque_ui";

/** Uma troca por destino a cada 30 s por aba — mais que isso é laço. */
export const JANELA_DE_TROCA_MS = 30_000;
const CHAVE_TENTATIVA = "torque_ui_tentativa";

export interface Tentativa {
  destino: UiVersion;
  em: number;
}

/** Sem resposta clara da org (erro, coluna ausente, `null`), fica a clássica. */
export function uiPedidaPelaOrg(uiV5Enabled: boolean | null | undefined): UiVersion {
  return uiV5Enabled === true ? "v5" : "classic";
}

export function lerCookieUi(cookie: string): UiVersion | null {
  const valor = cookie
    .split(";")
    .map((par) => par.trim())
    .find((par) => par.startsWith(`${UI_COOKIE}=`))
    ?.slice(UI_COOKIE.length + 1);
  return valor === "v5" || valor === "classic" ? valor : null;
}

export type DecisaoDeUi = "ficar" | "sincronizar-cookie" | "trocar" | "desistir";

/**
 * O que a guarda faz — puro, para ser testado sem navegador.
 *
 * - Build certa e cookie certo: nada.
 * - Build certa, cookie diferente (ou ausente): grava o cookie, sem recarregar,
 *   para a próxima visita já chegar na build certa.
 * - Build errada: troca. Se já tentou trocar para o MESMO destino há menos de
 *   30 s e continua na build errada, o servidor não está servindo as duas
 *   (dev, preview, nginx sem o mapa) — desiste em vez de recarregar para sempre.
 */
export function decidirUi(entrada: {
  rodando: UiVersion;
  pedida: UiVersion;
  cookie: UiVersion | null;
  ultimaTentativa: Tentativa | null;
  agora: number;
}): DecisaoDeUi {
  const { rodando, pedida, cookie, ultimaTentativa, agora } = entrada;
  if (pedida === rodando) return cookie === rodando ? "ficar" : "sincronizar-cookie";
  if (
    ultimaTentativa &&
    ultimaTentativa.destino === pedida &&
    agora - ultimaTentativa.em < JANELA_DE_TROCA_MS
  ) {
    return "desistir";
  }
  return "trocar";
}

export function gravarCookieUi(destino: UiVersion): void {
  const seguro = window.location.protocol === "https:" ? "; Secure" : "";
  // Um ano: a escolha é da org e muda raramente; a guarda corrige se mudar.
  document.cookie = `${UI_COOKIE}=${destino}; Path=/; Max-Age=31536000; SameSite=Lax${seguro}`;
}

export function lerTentativa(): Tentativa | null {
  try {
    const bruto = window.sessionStorage.getItem(CHAVE_TENTATIVA);
    if (!bruto) return null;
    const t = JSON.parse(bruto) as Partial<Tentativa>;
    return (t.destino === "v5" || t.destino === "classic") && typeof t.em === "number"
      ? { destino: t.destino, em: t.em }
      : null;
  } catch {
    return null;
  }
}

/**
 * Leva a aba para a outra build: grava o cookie, tira o service worker e os
 * caches da build atual (o SW serve o `index.html` dela do precache — sem isso
 * a navegação nem chega no nginx) e recarrega.
 */
export async function trocarUi(destino: UiVersion): Promise<void> {
  try {
    window.sessionStorage.setItem(CHAVE_TENTATIVA, JSON.stringify({ destino, em: Date.now() }));
  } catch {
    // sessionStorage bloqueado: segue sem a proteção de laço desta aba.
  }
  gravarCookieUi(destino);
  try {
    const registros = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(registros.map((r) => r.unregister()));
    if ("caches" in window) {
      const chaves = await caches.keys();
      await Promise.all(chaves.map((k) => caches.delete(k)));
    }
  } catch {
    // Sem SW/caches (navegador restrito): o reload ainda vai ao nginx.
  }
  window.location.reload();
}
