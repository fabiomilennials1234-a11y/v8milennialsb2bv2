import { useEffect, useRef, useCallback } from 'react';
import { createTypingPresence } from '@/modules/communication/lib/typing-presence';
import { setPresence } from '@/modules/communication/lib/whatsappApi';

export function useTypingPresence(instanceId: string, phoneNumber: string, enabled: boolean) {
  const controller = useRef<ReturnType<typeof createTypingPresence> | null>(null);
  useEffect(() => {
    const next = enabled ? createTypingPresence(state => setPresence(instanceId, phoneNumber, state)) : null;
    controller.current = next;
    return () => { next?.dispose(); controller.current = null; };
  }, [instanceId, phoneNumber, enabled]);
  return {
    typing: useCallback(() => controller.current?.typing(), []),
    stop: useCallback(() => controller.current?.stop(), []),
  };
}
