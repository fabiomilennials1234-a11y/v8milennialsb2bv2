import { useCallback, useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

/**
 * Browsers only re-check sw.js on navigation, and a SPA tab can stay open for
 * days — without polling, a deploy never reaches long-lived tabs.
 */
const SW_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Rede de segurança: se `skipWaiting` não resultar em `controllerchange`
 * (sem waiting worker no momento, activation travada), força o reload mesmo
 * assim para o update nunca ficar preso em waiting.
 */
const SW_UPDATE_RELOAD_FALLBACK_MS = 3000;

interface UseServiceWorkerUpdateReturn {
  /** True when a new SW version is available and pending activation. */
  needRefresh: boolean;
  /** Aplica o waiting SW e recarrega imediatamente. */
  updateSW: () => void;
}

/**
 * Registers the PWA service worker. A pending version waits for the user's
 * explicit update action: a hidden or idle tab can still contain unsaved work.
 */
export function useServiceWorkerUpdate(): UseServiceWorkerUpdateReturn {
  const [needRefresh, setNeedRefresh] = useState(false);
  const updateSWRef = useRef<ReturnType<typeof registerSW>>();
  const notifiedRef = useRef(false);
  const updatingRef = useRef(false);

  const updateSW = useCallback(() => {
    if (updatingRef.current) return;
    updatingRef.current = true;
    // O reload do build prompt roda só `if (event.isUpdate)` no evento
    // 'controlling', e workbox-window congela isUpdate no register() — página
    // que começou SEM controller ativaria o SW novo sem recarregar, ficando
    // com bundle velho + precache purgado. Garante o reload aqui; um segundo
    // reload é no-op durante a navegação já pendente.
    let reloaded = false;
    const reload = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', reload, {
        once: true,
      });
    }
    // Sem waiting worker (race) ou activation travada → controllerchange nunca
    // vem; o fallback garante que o build novo entre.
    window.setTimeout(reload, SW_UPDATE_RELOAD_FALLBACK_MS);

    updateSWRef.current?.(true);
  }, []);

  useEffect(() => {
    let intervalId: number | undefined;

    updateSWRef.current = registerSW({
      immediate: true,
      onNeedRefresh() {
        // workbox-window classifica um update achado >60s após o register
        // como "externo" e emite installed + waiting para o MESMO SW — o build
        // prompt então chama onNeedRefresh duas vezes. Sinaliza só uma.
        if (notifiedRef.current) return;
        notifiedRef.current = true;
        setNeedRefresh(true);
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

  return { needRefresh, updateSW };
}
