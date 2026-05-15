/**
 * useWhatsAppMessagesRealtime — subscrição realtime em whatsapp_messages.
 *
 * Architecture (3 layers):
 *   Transport: Supabase channel subscription + reconnect with exponential backoff
 *   Circuit breaker: after N consecutive failures → stop reconnecting, set "polling"
 *   Diagnostics: every state transition logged with reason to realtimeStatusStore
 *
 * Reconnect cycle:
 *   CHANNEL_ERROR → incrementFailures → backoff delay → epoch++ → useEffect re-run
 *   If failures >= threshold → circuit open → polling state → cooldown → probe
 *   On SUBSCRIBED → resetFailures → circuit close → "joined"
 */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import type { WhatsAppMessage, ChatContact } from "./types";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { normalizePhone as canonicalNormalizePhone } from "@/lib/normalizePhone";
import { chatQueryKeys } from "./shared/queryKeys";
import {
  setChannelState,
  recordChannelEvent,
  getChannelStatus,
  incrementFailures,
  resetFailures,
  openCircuitBreaker,
} from "@/lib/realtimeStatusStore";

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 120_000;

const normalizePhone = (p: string): string => canonicalNormalizePhone(p) ?? "";

export function useWhatsAppMessagesRealtime(
  phoneNumber: string | null,
  instanceId: string | null,
) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;
  const queryClient = useQueryClient();

  const phoneNumberRef = useRef(phoneNumber);
  phoneNumberRef.current = phoneNumber;
  const instanceIdRef = useRef(instanceId);
  instanceIdRef.current = instanceId;

  // Incrementing forces useEffect re-run → cleanup dead channel + create fresh one
  const [reconnectEpoch, setReconnectEpoch] = useState(0);

  useEffect(() => {
    if (!organizationId) return;

    const channelName = `whatsapp-messages-patched-${organizationId}`;
    setChannelState(channelName, "joining", "subscribe");

    let tornDown = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReconnect = (reason: string) => {
      if (tornDown) return;
      tornDown = true;

      const failures = incrementFailures(channelName, reason);

      if (failures >= CIRCUIT_BREAKER_THRESHOLD) {
        openCircuitBreaker(
          channelName,
          `${failures} consecutive failures, last: ${reason}`,
        );
        setChannelState(
          channelName,
          "polling",
          `circuit open after ${failures} failures`,
        );
        // Probe after cooldown — single attempt to re-establish
        reconnectTimer = setTimeout(
          () => setReconnectEpoch((e) => e + 1),
          CIRCUIT_COOLDOWN_MS,
        );
        return;
      }

      setChannelState(channelName, "reconnecting", reason);
      const backoffMs = Math.min(1000 * Math.pow(2, failures - 1), 30_000);
      reconnectTimer = setTimeout(
        () => setReconnectEpoch((e) => e + 1),
        backoffMs,
      );
    };

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "whatsapp_messages",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload: RealtimePostgresChangesPayload<WhatsAppMessage>) => {
          recordChannelEvent(channelName);
          const { eventType } = payload;
          const message = (payload.new || payload.old) as
            | WhatsAppMessage
            | undefined;
          if (!message) return;

          const messagePhone = message.phone_number ?? "";
          const currentPhone = phoneNumberRef.current;
          const currentInstanceId = instanceIdRef.current;

          // ── Patch messages do chat ativo ───────────────────────────────────
          if (
            currentPhone &&
            normalizePhone(messagePhone) === normalizePhone(currentPhone)
          ) {
            const msgQueryKey = chatQueryKeys.messages(
              organizationId,
              currentPhone,
              currentInstanceId,
            );

            if (eventType === "INSERT") {
              queryClient.setQueryData<WhatsAppMessage[]>(
                msgQueryKey,
                (prev) => {
                  const existing = prev ?? [];
                  if (
                    existing.some(
                      (m) => m.message_id === message.message_id,
                    )
                  )
                    return existing;
                  return [...existing, message];
                },
              );
            } else if (eventType === "UPDATE") {
              queryClient.setQueryData<WhatsAppMessage[]>(
                msgQueryKey,
                (prev) => {
                  if (!prev) return prev;
                  return prev.map((m) =>
                    m.id === message.id ? message : m,
                  );
                },
              );
            } else if (eventType === "DELETE") {
              queryClient.setQueryData<WhatsAppMessage[]>(
                msgQueryKey,
                (prev) => {
                  if (!prev) return prev;
                  return prev.filter((m) => m.id !== message.id);
                },
              );
            }
          }

          // ── Patch lista de contatos (sidebar) ─────────────────────────────
          if (currentInstanceId) {
            const contactsQueryKey = chatQueryKeys.contacts(
              organizationId,
              currentInstanceId,
            );

            if (eventType === "INSERT" || eventType === "UPDATE") {
              queryClient.setQueryData<ChatContact[]>(
                contactsQueryKey,
                (prev) => {
                  if (!prev) return prev;

                  const normPhone = normalizePhone(messagePhone);
                  const existingIdx = prev.findIndex(
                    (c) => normalizePhone(c.phone_number) === normPhone,
                  );

                  if (existingIdx === -1) {
                    queryClient.invalidateQueries({
                      queryKey: contactsQueryKey,
                    });
                    return prev;
                  }

                  return prev.map((contact, idx) => {
                    if (idx !== existingIdx) return contact;

                    const msgTime = new Date(message.timestamp).getTime();
                    const existingTime = new Date(
                      contact.last_message_time,
                    ).getTime();

                    if (msgTime <= existingTime) return contact;

                    const isIncoming = message.direction === "incoming";
                    const isCurrentConversation =
                      currentPhone &&
                      normalizePhone(messagePhone) ===
                        normalizePhone(currentPhone);

                    return {
                      ...contact,
                      last_message:
                        message.content ?? contact.last_message,
                      last_message_time: message.timestamp,
                      last_message_direction: message.direction as
                        | "incoming"
                        | "outgoing",
                      unread_count:
                        isIncoming && !isCurrentConversation
                          ? contact.unread_count + 1
                          : contact.unread_count,
                    };
                  });
                },
              );
            }
          }
        },
      )
      .subscribe((status) => {
        switch (status) {
          case "SUBSCRIBED":
            resetFailures(channelName);
            setChannelState(channelName, "joined", "subscribed");
            recordChannelEvent(channelName);
            break;
          case "CHANNEL_ERROR":
            setChannelState(channelName, "offline", "channel_error");
            scheduleReconnect("channel_error");
            break;
          case "TIMED_OUT":
            setChannelState(channelName, "offline", "timed_out");
            scheduleReconnect("timed_out");
            break;
          case "CLOSED":
            if (!tornDown) {
              setChannelState(channelName, "offline", "closed");
            }
            break;
        }
      });

    // Reconnect on visibility/online change when channel is unhealthy
    const onVisibilityOrOnline = () => {
      if (tornDown) return;
      const { state } = getChannelStatus(channelName);
      if (state !== "joined" && state !== "joining") {
        scheduleReconnect("visibility_change");
      }
    };
    window.addEventListener("visibilitychange", onVisibilityOrOnline);
    window.addEventListener("online", onVisibilityOrOnline);

    return () => {
      tornDown = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      window.removeEventListener("visibilitychange", onVisibilityOrOnline);
      window.removeEventListener("online", onVisibilityOrOnline);
      setChannelState(channelName, "offline", "cleanup");
      supabase.removeChannel(channel);
    };
  }, [organizationId, queryClient, reconnectEpoch]);
}
