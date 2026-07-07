import { useServiceWorkerUpdate } from '@/modules/platform/hooks/use-sw-update';
import { toast } from 'sonner';
import { useRef, useCallback } from 'react';

/**
 * Mounts the SW registration hook and shows a Sonner toast
 * when a new version is waiting to activate.
 * Render once near the app root (after Sonner provider).
 */
export function ServiceWorkerUpdater() {
  const updateRef = useRef<() => void>(() => {});

  const onNeedRefresh = useCallback(() => {
    // id fixo: sonner atualiza o toast existente em vez de empilhar caso o
    // sinal de update chegue mais de uma vez (belt-and-suspenders do guard
    // notifiedRef em use-sw-update).
    toast('Nova versao disponivel', {
      id: 'sw-update',
      description: 'Clique para atualizar o Torque CRM.',
      duration: Infinity,
      action: {
        label: 'Atualizar',
        onClick: () => updateRef.current(),
      },
    });
  }, []);

  const { updateSW } = useServiceWorkerUpdate({ onNeedRefresh });
  updateRef.current = updateSW;

  return null;
}
