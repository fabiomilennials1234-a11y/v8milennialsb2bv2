import { useEffect } from 'react';
import { toast } from 'sonner';
import { useServiceWorkerUpdate } from '@/modules/platform/hooks/use-sw-update';

/**
 * Lets the user finish their work before activating a pending app version.
 */
export function ServiceWorkerUpdater() {
  const { needRefresh, updateSW } = useServiceWorkerUpdate();
  useEffect(() => {
    if (!needRefresh) return;
    const id = toast('Nova versão disponível', {
      description: 'Salve suas alterações antes de atualizar a página.',
      duration: Infinity,
      action: { label: 'Atualizar página', onClick: updateSW },
      cancel: { label: 'Agora não', onClick: () => undefined },
    });
    return () => { toast.dismiss(id); };
  }, [needRefresh, updateSW]);
  return null;
}
