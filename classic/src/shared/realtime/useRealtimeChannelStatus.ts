/**
 * useRealtimeChannelStatus — subscribe a component to a Supabase Realtime
 * channel's health, as published by the realtime hooks into
 * `realtimeStatusStore`.
 */
import { useSyncExternalStore } from "react";
import {
  type ChannelStatus,
  getChannelStatus,
  subscribeChannelStatus,
} from "@/lib/realtimeStatusStore";

export function useRealtimeChannelStatus(channelName: string | null): ChannelStatus {
  return useSyncExternalStore(
    (cb) => (channelName ? subscribeChannelStatus(channelName, cb) : () => {}),
    () => (channelName ? getChannelStatus(channelName) : getChannelStatus("__none__")),
    () => (channelName ? getChannelStatus(channelName) : getChannelStatus("__none__")),
  );
}

/**
 * Chave do status do canal de `whatsapp_messages` da org. Compartilhada pelos
 * dois montadores (bolha e /chat) — `useWhatsAppMessagesRealtime`.
 */
export function whatsAppRealtimeStatusKey(organizationId: string): string {
  return `whatsapp-messages-patched-${organizationId}`;
}

export function useWhatsAppRealtimeStatus(organizationId: string | null | undefined): ChannelStatus {
  const channelName = organizationId ? whatsAppRealtimeStatusKey(organizationId) : null;
  return useRealtimeChannelStatus(channelName);
}
