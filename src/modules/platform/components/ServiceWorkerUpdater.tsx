import { useEffect } from 'react';
import { toast } from 'sonner';
import { useServiceWorkerUpdate } from '@/modules/platform/hooks/use-sw-update';

/**
 * Lets the user finish their work before activating a pending app version.
 */
export function ServiceWorkerUpdater() {
  const { needRefresh, isUpdating, updateFailed, updateSW } = useServiceWorkerUpdate();
  useEffect(() => {
    if (!needRefresh) return;
    if (isUpdating) {
      const id = toast.loading('Atualizando o Torque…', {
        description: 'Aguarde a atualização terminar. A página será recarregada em seguida.',
        duration: Infinity,
      });
      return () => { toast.dismiss(id); };
    }
    const id = toast(updateFailed ? 'A atualização ainda não terminou' : 'Nova versão disponível', {
      description: updateFailed
        ? 'A página foi mantida aberta. Tente atualizar novamente em instantes.'
        : 'Salve suas alterações antes de atualizar a página.',
      duration: Infinity,
      action: { label: updateFailed ? 'Tentar novamente' : 'Atualizar página', onClick: updateSW },
      cancel: { label: 'Agora não', onClick: () => undefined },
    });
    return () => { toast.dismiss(id); };
  }, [needRefresh, isUpdating, updateFailed, updateSW]);
  return null;
}
