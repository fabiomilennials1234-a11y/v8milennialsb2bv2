import { useCallback, useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

interface UseServiceWorkerUpdateOptions {
  /** Called when a new SW version is available and waiting to activate. */
  onNeedRefresh?: () => void;
}

/**
 * Browsers only re-check sw.js on navigation, and a SPA tab can stay open for
 * days — without polling, a deploy never reaches long-lived tabs.
 */
const SW_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

interface UseServiceWorkerUpdateReturn {
  /** True when a new SW version is available. */
  needRefresh: boolean;
  /** Call to activate the waiting SW and reload. */
  updateSW: () => void;
}

/**
 * Registers the PWA service worker and exposes update state.
 * Used by the app shell to show "new version available" toasts.
 */
export function useServiceWorkerUpdate(
  options?: UseServiceWorkerUpdateOptions,
): UseServiceWorkerUpdateReturn {
  const [needRefresh, setNeedRefresh] = useState(false);
  const onNeedRefreshRef = useRef(options?.onNeedRefresh);
  onNeedRefreshRef.current = options?.onNeedRefresh;

  const updateSWRef = useRef<ReturnType<typeof registerSW>>();
  const notifiedRef = useRef(false);

  useEffect(() => {
    let intervalId: number | undefined;

    updateSWRef.current = registerSW({
      immediate: true,
      onNeedRefresh() {
        // workbox-window classifica um update achado >60s após o register
        // (caso típico: o poll horário abaixo) como "externo" e emite
        // installed + waiting para o MESMO SW — o build prompt então chama
        // onNeedRefresh duas vezes. Notifica só uma.
        if (notifiedRef.current) return;
        notifiedRef.current = true;
        setNeedRefresh(true);
        onNeedRefreshRef.current?.();
      },
      onRegisteredSW(swUrl: string, registration?: ServiceWorkerRegistration) {
        if (!registration) return;
        intervalId = window.setInterval(async () => {
          if (registration.installing) return;
          try {
            // Probe before update(): a failed fetch (offline, server down)
            // must not surface as an unhandled rejection from update().
            const response = await fetch(swUrl, {
              cache: 'no-store',
              headers: { 'cache-control': 'no-cache' },
            });
            if (response.status === 200) await registration.update();
          } catch {
            // Network hiccup — retry on the next tick.
          }
        }, SW_UPDATE_CHECK_INTERVAL_MS);
      },
    });

    return () => {
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, []);

  const updateSW = useCallback(() => {
    // O reload do build prompt roda só `if (event.isUpdate)` no evento
    // 'controlling', e workbox-window congela isUpdate no register() — página
    // que começou SEM controller (primeira visita, shift-reload) ativaria o
    // SW novo sem recarregar, ficando com bundle velho + precache purgado.
    // Garante o reload aqui; se o register.js também recarregar, o segundo
    // reload é no-op durante a navegação já pendente.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener(
        'controllerchange',
        () => window.location.reload(),
        { once: true },
      );
    }
    updateSWRef.current?.(true);
  }, []);

  return { needRefresh, updateSW };
}
