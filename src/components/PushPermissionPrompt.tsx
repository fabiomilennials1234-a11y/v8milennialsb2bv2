/**
 * PushPermissionPrompt — prompt sutil pra ativar notificações push.
 *
 * Renderiza null. Dispara Sonner toast após user interagir com chat
 * (presença em rota /chat*). Só aparece 1x por sessão, se permissão = 'default'.
 */

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { usePushSubscription } from '@/hooks/use-push-subscription';

export function PushPermissionPrompt() {
  const { isSupported, permission, requestPermission } = usePushSubscription();
  const location = useLocation();
  const prompted = useRef(false);

  useEffect(() => {
    if (prompted.current) return;
    if (!isSupported) return;
    if (permission !== 'default') return;

    // Só prompta quando user navega pra chat (interação real)
    const isChatRoute = /^\/chat(\/|$)|^\/chat-whatsapp/.test(location.pathname);
    if (!isChatRoute) return;

    prompted.current = true;

    toast('Ativar notificacoes?', {
      description: 'Receba alertas de novas mensagens mesmo com o app fechado.',
      duration: 15_000,
      action: {
        label: 'Ativar',
        onClick: () => {
          requestPermission();
        },
      },
    });
  }, [isSupported, permission, requestPermission, location.pathname]);

  return null;
}
