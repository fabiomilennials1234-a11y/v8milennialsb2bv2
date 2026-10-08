/**
 * announcement-state — decide qual aviso do "suporte ao vivo" mostrar na entrada.
 *
 * Regra (definida com o CTO):
 *   - Estreia: o takeover de LANÇAMENTO aparece UMA vez por navegador.
 *   - Depois: o COACH-MARK aparece a cada entrada (uma vez por sessão), para
 *     sempre, até o cliente dispensar no X — que o desliga em definitivo.
 *   - O staff (master) nunca vê: é anúncio de feature para o cliente.
 *
 * Lógica pura sobre localStorage/sessionStorage para ser testável sem React. Se o
 * storage estiver bloqueado, decide "none": um aviso que não sabe se já foi visto
 * é melhor calado do que repetido a cada navegação.
 */

export const LAUNCH_KEY = "torque:announce:support-realtime:launch";
export const NUDGE_SESSION_KEY = "torque:announce:support-realtime:nudge-session";
export const NUDGE_OFF_KEY = "torque:announce:support-realtime:nudge-off";

export type Announcement = "launch" | "nudge" | "none";

/**
 * Lê o estado e decide. Tem efeito colateral deliberado: ao escolher "nudge",
 * marca a sessão, para que um reload no mema sessão não repita o coach-mark.
 */
export function decideAnnouncement(): Announcement {
  try {
    if (localStorage.getItem(LAUNCH_KEY) !== "1") return "launch";
    if (localStorage.getItem(NUDGE_OFF_KEY) === "1") return "none";
    if (sessionStorage.getItem(NUDGE_SESSION_KEY) === "1") return "none";
    sessionStorage.setItem(NUDGE_SESSION_KEY, "1");
    return "nudge";
  } catch {
    return "none";
  }
}

/** O takeover foi visto (fechado ou CTA). Não aparece de novo neste navegador. */
export function markLaunchSeen(): void {
  try {
    localStorage.setItem(LAUNCH_KEY, "1");
  } catch {
    /* storage bloqueado: nada a persistir */
  }
}

/** O cliente dispensou o coach-mark no X. Desliga em definitivo. */
export function dismissNudgeForever(): void {
  try {
    localStorage.setItem(NUDGE_OFF_KEY, "1");
  } catch {
    /* idem */
  }
}
