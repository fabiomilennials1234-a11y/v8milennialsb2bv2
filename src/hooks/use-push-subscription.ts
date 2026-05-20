/**
 * usePushSubscription — gerencia Web Push subscription via Service Worker.
 *
 * Detect support → read permission → request → subscribe → persist no Supabase.
 * NÃO auto-prompta. Expõe requestPermission() pra ação explícita do user.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

type PushPermission = NotificationPermission | 'unsupported';

interface UsePushSubscriptionReturn {
  /** Browser suporta Push API + Service Worker */
  isSupported: boolean;
  /** Subscription ativa no browser */
  isSubscribed: boolean;
  /** Estado da permissão: 'default' | 'granted' | 'denied' | 'unsupported' */
  permission: PushPermission;
  /** Pede permissão + cria subscription + salva no Supabase */
  requestPermission: () => Promise<void>;
  /** Remove subscription do browser + Supabase */
  unsubscribe: () => Promise<void>;
}

/** Converte VAPID base64 string pra Uint8Array (applicationServerKey format) */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** Converte ArrayBuffer pra base64 string pra persistência */
function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function detectSupport(): boolean {
  return (
    typeof globalThis.Notification !== 'undefined' &&
    globalThis.Notification !== null &&
    'serviceWorker' in navigator &&
    navigator.serviceWorker !== undefined
  );
}

export function usePushSubscription(): UsePushSubscriptionReturn {
  const { user, organizationId } = useAuth();
  const isSupported = detectSupport();

  const [permission, setPermission] = useState<PushPermission>(
    isSupported ? Notification.permission : 'unsupported',
  );
  const [isSubscribed, setIsSubscribed] = useState(false);

  // Ref pra subscription ativa (pra unsubscribe sem re-render)
  const subscriptionRef = useRef<PushSubscription | null>(null);

  // Checa subscription existente no mount (se já tem permissão)
  useEffect(() => {
    if (!isSupported || !user || !organizationId) return;
    if (Notification.permission !== 'granted') return;

    let cancelled = false;

    navigator.serviceWorker.ready.then((registration) => {
      registration.pushManager.getSubscription().then((sub) => {
        if (cancelled) return;
        if (sub) {
          subscriptionRef.current = sub;
          setIsSubscribed(true);
        }
      });
    });

    return () => {
      cancelled = true;
    };
  }, [isSupported, user, organizationId]);

  const subscribe = useCallback(async () => {
    if (!user || !organizationId) return;

    const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
    if (!vapidKey) {
      console.error('[push] VITE_VAPID_PUBLIC_KEY não configurada');
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });

    subscriptionRef.current = subscription;
    setIsSubscribed(true);

    // Persiste no Supabase
    const p256dh = arrayBufferToBase64(subscription.getKey('p256dh'));
    const auth = arrayBufferToBase64(subscription.getKey('auth'));

    await supabase.from('push_subscriptions' as any).upsert(
      {
        user_id: user.id,
        organization_id: organizationId,
        endpoint: subscription.endpoint,
        p256dh,
        auth,
      },
      { onConflict: 'endpoint' },
    );
  }, [user, organizationId]);

  const requestPermission = useCallback(async () => {
    if (!isSupported) return;

    const result = await Notification.requestPermission();
    setPermission(result);

    if (result === 'granted') {
      await subscribe();
    }
  }, [isSupported, subscribe]);

  const unsubscribe = useCallback(async () => {
    const sub = subscriptionRef.current;
    if (!sub) return;

    const endpoint = sub.endpoint;

    await sub.unsubscribe();
    subscriptionRef.current = null;
    setIsSubscribed(false);

    // Remove do Supabase
    await (supabase.from('push_subscriptions' as any) as any)
      .delete()
      .eq('endpoint', endpoint);
  }, []);

  return {
    isSupported,
    isSubscribed,
    permission,
    requestPermission,
    unsubscribe,
  };
}
