import { useServiceWorkerUpdate } from '@/modules/platform/hooks/use-sw-update';

/**
 * Registra o service worker e aplica novos builds sozinho, sem nenhum aviso na
 * tela — o update entra no próximo momento seguro (aba escondida ou ociosa),
 * nunca no meio de uma digitação. Render once near the app root.
 */
export function ServiceWorkerUpdater() {
  useServiceWorkerUpdate();
  return null;
}
