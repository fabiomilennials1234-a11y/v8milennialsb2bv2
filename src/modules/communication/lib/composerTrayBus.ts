import { useSyncExternalStore } from "react";

/**
 * Canal mínimo entre o composer e a bandeja de agendadas da MESMA conversa.
 *
 * Por que não estado no `ChatView`: o composer re-renderiza a cada tecla, e
 * subir "tem texto?" para o pai re-renderizaria cabeçalho, thread e painel
 * junto. Aqui cada lado só publica quando o VALOR muda (boolean / contador), e
 * só quem lê aquela chave re-renderiza — a bandeja quando o campo esvazia ou
 * enche, o botão Enviar quando o contador muda. Nada por tecla.
 *
 * Chave = `conversationKey` do ChatView (`${instanceId}:${phoneNumber}`), a
 * mesma que composer e bandeja já recebem.
 */

type Listener = () => void;

const composerHasText = new Map<string, boolean>();
const pendingBadge = new Map<string, number>();
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Composer → bandeja. Chamado em efeito, só quando o boolean muda. */
export function publishComposerHasText(key: string, hasText: boolean) {
  if ((composerHasText.get(key) ?? false) === hasText) return;
  if (hasText) composerHasText.set(key, true);
  else composerHasText.delete(key);
  emit();
}

/** Bandeja → botão Enviar. 0 apaga o selo. */
export function publishPendingBadge(key: string, count: number) {
  if ((pendingBadge.get(key) ?? 0) === count) return;
  if (count > 0) pendingBadge.set(key, count);
  else pendingBadge.delete(key);
  emit();
}

export function useComposerHasText(key: string | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (key ? composerHasText.get(key) ?? false : false),
    () => false,
  );
}

export function usePendingBadge(key: string | undefined): number {
  return useSyncExternalStore(
    subscribe,
    () => (key ? pendingBadge.get(key) ?? 0 : 0),
    () => 0,
  );
}

/**
 * Esc no campo do composer → a bandeja aberta fecha. É EVENTO, não estado:
 * ninguém re-renderiza; só o handler da bandeja daquela chave roda.
 */
const escapeHandlers = new Map<string, Set<() => void>>();

export function publishComposerEscape(key: string) {
  escapeHandlers.get(key)?.forEach((h) => h());
}

export function onComposerEscape(key: string, handler: () => void): () => void {
  let set = escapeHandlers.get(key);
  if (!set) {
    set = new Set();
    escapeHandlers.set(key, set);
  }
  set.add(handler);
  return () => {
    set!.delete(handler);
    if (set!.size === 0) escapeHandlers.delete(key);
  };
}

/** Só para testes. */
export function __resetComposerTrayBus() {
  composerHasText.clear();
  pendingBadge.clear();
  escapeHandlers.clear();
  emit();
}
