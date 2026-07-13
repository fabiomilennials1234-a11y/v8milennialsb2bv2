/**
 * Anúncio de lançamento da Central de Suporte — state machine pura + persistência.
 *
 * Regras (ver nota "Anúncio de lançamento" no vault, 06 — Features/Suporte):
 * - Modal aparece no máximo 1×/sessão de browser e no máximo 2 sessões no total.
 * - `engaged` (clicou no CTA ou abriu o suporte por qualquer via) mata o anúncio
 *   pra sempre — quem já conhece o suporte não precisa de anúncio.
 * - Esgotadas as 2 exibições, nada mais aparece, mesmo com `coachDone: false`.
 *   Sem nag infinito.
 *
 * O estado vive no localStorage por usuário (multiusuário no mesmo browser não
 * herda o anúncio do outro). O guard de sessão vive no sessionStorage: refresh na
 * mesma aba não conta segunda exibição. Todo acesso a storage é defensivo —
 * Safari private mode lança em `setItem`, e JSON corrompido não pode explodir o
 * app shell.
 */

export interface SupportAnnouncementState {
  /** Quantas sessões já viram o modal. */
  shownCount: number;
  /** Clicou "Conhecer o Suporte" OU abriu o suporte por qualquer via. */
  engaged: boolean;
  /** Coach-mark dispensado em definitivo ("Entendi" ou engajamento). */
  coachDone: boolean;
}

export const MAX_MODAL_SHOWS = 2;

/** FAB "?" do dock — o anúncio só existe onde ele existe. */
export const SUPPORT_FAB_SELECTOR = "[data-support-fab]";
/** Qualquer TorqueLoader montado (Suspense fallback, gates de auth/assinatura). */
export const TORQUE_LOADER_SELECTOR = "[data-torque-loader]";

/**
 * App "assentado": o FAB do suporte está no DOM E nenhum TorqueLoader está na
 * tela. Enquanto não assentar, o modal do anúncio não pode abrir — abriria por
 * cima da animação de loading (chunk de página, gate de auth/assinatura).
 */
export function isAppSettled(doc: Document): boolean {
  return (
    doc.querySelector(SUPPORT_FAB_SELECTOR) !== null &&
    doc.querySelector(TORQUE_LOADER_SELECTOR) === null
  );
}

const STATE_KEY_PREFIX = "torque:support-announcement:v1:";
const SESSION_KEY = "torque:support-announcement:session-shown";

function stateKey(userId: string): string {
  return `${STATE_KEY_PREFIX}${userId}`;
}

export function emptyState(): SupportAnnouncementState {
  return { shownCount: 0, engaged: false, coachDone: false };
}

/** Lê o estado do usuário. JSON corrompido/ausente ou storage bloqueado → estado zerado. */
export function readState(userId: string): SupportAnnouncementState {
  try {
    const raw = window.localStorage.getItem(stateKey(userId));
    if (!raw) return emptyState();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return emptyState();
    const p = parsed as Record<string, unknown>;
    return {
      shownCount:
        typeof p.shownCount === "number" && Number.isFinite(p.shownCount) && p.shownCount >= 0
          ? p.shownCount
          : 0,
      engaged: p.engaged === true,
      coachDone: p.coachDone === true,
    };
  } catch {
    return emptyState();
  }
}

/** Persiste o estado. Storage bloqueado → no-op silencioso. */
export function writeState(userId: string, state: SupportAnnouncementState): void {
  try {
    window.localStorage.setItem(stateKey(userId), JSON.stringify(state));
  } catch {
    // Safari private mode / quota — o anúncio pode reaparecer, nunca quebrar o app.
  }
}

/** A sessão de browser atual já exibiu o modal? */
export function readSessionShown(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function markSessionShown(): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    // Idem writeState.
  }
}

/**
 * Elegibilidade do modal A. Puro — quem chama garante os pré-requisitos de
 * ambiente (usuário autenticado, `[data-support-fab]` presente no DOM).
 */
export function shouldShowModal(
  state: SupportAnnouncementState,
  sessionShown: boolean,
): boolean {
  return !sessionShown && !state.engaged && state.shownCount < MAX_MODAL_SHOWS;
}

/** Registra uma exibição do modal: incrementa o contador e trava a sessão. */
export function recordModalShown(userId: string): SupportAnnouncementState {
  const current = readState(userId);
  const next = { ...current, shownCount: current.shownCount + 1 };
  writeState(userId, next);
  markSessionShown();
  return next;
}

/**
 * Engajou: CTA "Conhecer o Suporte" ou abriu o suporte por qualquer via.
 * Marca também `coachDone` — quem já está dentro do painel não precisa de
 * coach-mark apontando pra porta.
 */
export function markEngaged(userId: string): SupportAnnouncementState {
  const next = { ...readState(userId), engaged: true, coachDone: true };
  writeState(userId, next);
  return next;
}

/** "Entendi" no coach-mark: nunca mais aparece. */
export function markCoachDone(userId: string): SupportAnnouncementState {
  const next = { ...readState(userId), coachDone: true };
  writeState(userId, next);
  return next;
}
