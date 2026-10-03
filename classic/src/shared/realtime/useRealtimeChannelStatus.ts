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

export function useWhatsAppRealtimeStatus(organizationId: string | null | undefined): ChannelStatus {
  const channelName = organizationId ? `whatsapp-messages-patched-${organizationId}` : null;
  return useRealtimeChannelStatus(channelName);
}
