/**
 * useSendWhatsAppMessage + useSendWhatsAppMedia + useFailedMessages + useRetryMessage
 * Extraídos de src/hooks/useWhatsAppChat.ts (C12).
 *
 * Helpers privados co-locados: isSzChatInstance, assertCanReplyOnInstance,
 * sanitizeFileName, normalizeMimeType, getMimeType, uploadMediaToStorage.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import { track } from "@/lib/analytics";
import { formatPhoneForWhatsApp } from "@/modules/communication/lib/whatsapp";
import type { WhatsAppMessage, FailedMessage } from "./types";

// ─── Helpers privados ────────────────────────────────────────────────────────

const SEND_TIMEOUT_MS = 15_000;

// Per-instance cache — instance type never changes during a session
const szChatCache = new Map<string, boolean>();

async function isSzChatInstanceCached(instanceId: string | null | undefined): Promise<boolean> {
  if (!instanceId) return false;
  const cached = szChatCache.get(instanceId);
  if (cached !== undefined) return cached;
  const { data } = await supabase
    .from("whatsapp_instances")
    .select("metadata")
    .eq("id", instanceId)
    .maybeSingle();
  const result = (data?.metadata as Record<string, unknown>)?.channel === "sz_chat";
  szChatCache.set(instanceId, result);
  return result;
}

async function invokeWithTimeout<T>(
  fnName: string,
  body: Record<string, unknown>,
  timeoutMs = SEND_TIMEOUT_MS,
): Promise<{ data: T; error: unknown }> {
  const invoke = supabase.functions.invoke(fnName, { body });
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Envio expirou. Tente novamente.")), timeoutMs),
  );
  return Promise.race([invoke, timeout]) as Promise<{ data: T; error: unknown }>;
}

/** Sanitiza nome de arquivo para ser compatível com Storage */
function sanitizeFileName(fileName: string): string {
  return fileName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase();
}

/** Normaliza o mimetype removendo parâmetros extras (como codecs) */
function normalizeMimeType(mimeType: string): string {
  const baseMime = mimeType.split(";")[0].trim();
  const mimeMap: Record<string, string> = {
    "audio/webm": "audio/webm",
    "audio/ogg": "audio/ogg",
    "audio/wav": "audio/wav",
    "audio/mp4": "audio/mp4",
    "audio/mpeg": "audio/mpeg",
    "audio/mp3": "audio/mpeg",
    "video/webm": "video/webm",
  };
  return mimeMap[baseMime] || baseMime;
}

/** Helper para obter mimetype padrão */
function getMimeType(mediaType: string): string {
  switch (mediaType) {
    case "image":    return "image/png";
    case "video":    return "video/mp4";
    case "audio":    return "audio/ogg";
    case "document": return "application/pdf";
    default:         return "application/octet-stream";
  }
}

/**
 * Faz upload de mídia para Supabase Storage e retorna URL pública
 */
async function uploadMediaToStorage(
  base64Data: string,
  mediaType: string,
  organizationId: string,
  fileName?: string
): Promise<string> {
  const matches = base64Data.match(/^data:([^;,]+)[^,]*;base64,(.+)$/);
  if (!matches) {
    throw new Error("Formato de arquivo inválido");
  }

  const rawMimeType = matches[1];
  const mimeType = normalizeMimeType(rawMimeType);
  const base64 = matches[2];

  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mimeType });

  const extMap: Record<string, string> = { mpeg: "mp3", mp3: "mp3" };
  const rawExt = mimeType.split("/")[1]?.split(";")[0] || "bin";
  const extension = extMap[rawExt] || rawExt;
  const timestamp = Date.now();
  const baseName = fileName ? sanitizeFileName(fileName) : `${mediaType}_${timestamp}`;
  const uniqueFileName = `${baseName}_${timestamp}.${extension}`;
  const filePath = `whatsapp-media/${organizationId}/${uniqueFileName}`;

  const { error } = await supabase.storage
    .from("media")
    .upload(filePath, blob, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) {
    throw new Error(`Erro ao fazer upload: ${error.message}`);
  }

  const { data: urlData } = supabase.storage
    .from("media")
    .getPublicUrl(filePath);

  if (!urlData?.publicUrl) {
    throw new Error("Erro ao obter URL pública do arquivo");
  }

  return urlData.publicUrl;
}

// ─── Hooks públicos ──────────────────────────────────────────────────────────

/**
 * Hook para enviar mensagem de texto via WhatsApp
 */
export function useSendWhatsAppMessage() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async ({
      phoneNumber,
      message,
      instanceName,
      instanceId,
      leadId,
    }: {
      phoneNumber: string;
      message: string;
      instanceName: string;
      instanceId?: string | null;
      leadId?: string | null;
    }) => {
      if (!teamMember?.organization_id || !teamMember?.id) {
        throw new Error("Usuário não vinculado à equipe");
      }

      const formattedNumber = formatPhoneForWhatsApp(phoneNumber);
      if (!formattedNumber) throw new Error("Número de telefone inválido");

      const isSzChat = await isSzChatInstanceCached(instanceId);

      let data: Record<string, unknown>;
      let error: unknown;

      if (isSzChat) {
        const result = await invokeWithTimeout("sz-chat-send", {
          action: "send_message",
          organization_id: teamMember.organization_id,
          phone_number: formattedNumber,
          message,
        });
        data = result.data;
        error = result.error;
      } else {
        if (!instanceId) {
          throw new Error(
            "Instância WhatsApp não identificada. Recarregue a página."
          );
        }
        const result = await invokeWithTimeout("whatsapp-api-proxy", {
          action: "sendText",
          instance_id: instanceId,
          organization_id: teamMember.organization_id,
          payload: {
            number: formattedNumber,
            text: message,
            ...(leadId ? { lead_id: leadId } : {}),
          },
        });
        data = result.data;
        error = result.error;
      }

      if (error) throw error;
      if ((data as Record<string, unknown>)?.error) throw new Error((data as Record<string, string>).error);

      const d = data as Record<string, any>;
      const messageId = d?.result?.message_id ?? d?.key?.id ?? `local_${Date.now()}`;
      const timestamp = new Date().toISOString();

      // Fire-and-forget — webhook send.message is the authoritative save
      supabase.from("whatsapp_messages").upsert({
        organization_id: teamMember.organization_id,
        instance_id: instanceId || null,
        message_id: messageId,
        remote_jid: `${formattedNumber}@s.whatsapp.net`,
        phone_number: phoneNumber,
        direction: "outgoing",
        message_type: "text",
        content: message,
        status: "sent",
        timestamp,
      }, { onConflict: "message_id,instance_id", ignoreDuplicates: true })
        .then(({ error: e }) => { if (e) console.warn("[send] upsert fallback failed:", e.message); });

      return { ...data, _localMessage: { phoneNumber, message, instanceId, messageId, timestamp } };
    },
    onMutate: async (variables) => {
      const orgId = teamMember?.organization_id;
      const phone = variables.phoneNumber;
      const instId = variables.instanceId;

      await queryClient.cancelQueries({ queryKey: ["whatsapp_messages", orgId, phone, instId] });

      const previousMessages = queryClient.getQueryData<WhatsAppMessage[]>(
        ["whatsapp_messages", orgId, phone, instId]
      );

      const optimisticMsg: WhatsAppMessage = {
        id: `optimistic_${Date.now()}`,
        organization_id: orgId || "",
        instance_id: instId || null,
        message_id: `optimistic_${Date.now()}`,
        remote_jid: `${phone}@s.whatsapp.net`,
        phone_number: phone,
        direction: "outgoing",
        message_type: "text",
        content: variables.message,
        media_url: null,
        push_name: null,
        status: "pending",
        lead_id: null,
        timestamp: new Date().toISOString(),
        created_at: new Date().toISOString(),
        sent_by_ai: false,
      };

      queryClient.setQueryData<WhatsAppMessage[]>(
        ["whatsapp_messages", orgId, phone, instId],
        (old) => [...(old || []), optimisticMsg]
      );

      return { previousMessages };
    },
    onError: (err, variables, context) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(
          ["whatsapp_messages", teamMember?.organization_id, variables.phoneNumber, variables.instanceId],
          context.previousMessages
        );
      }
      const failedKey = ["whatsapp_failed_messages", teamMember?.organization_id, variables.phoneNumber, variables.instanceId];
      queryClient.setQueryData<FailedMessage[]>(failedKey, (prev = []) => [
        ...prev,
        {
          id: `failed-${Date.now()}-${Math.random()}`,
          phoneNumber: variables.phoneNumber,
          instanceId: variables.instanceId ?? null,
          instanceName: variables.instanceName,
          message: variables.message,
          mediaUrl: null,
          mediaType: null,
          error: err instanceof Error ? err.message : "Falha ao enviar",
          timestamp: new Date().toISOString(),
          direction: "outgoing",
          status: "failed",
          sent_by_ai: false,
        },
      ]);
    },
    onSuccess: () => {
      if (teamMember?.organization_id) {
        track({ event: "message_sent", organizationId: teamMember.organization_id, entityType: "conversation" });
      }
    },
    onSettled: (_, __, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["whatsapp_messages", teamMember?.organization_id, variables.phoneNumber, variables.instanceId],
      });
      queryClient.invalidateQueries({ queryKey: ["whatsapp_contacts"] });
    },
  });
}

/**
 * Hook para enviar mídia (imagem, áudio) via WhatsApp
 */
export function useSendWhatsAppMedia() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async ({
      phoneNumber,
      instanceName,
      instanceId,
      mediaType,
      media,
      caption,
      fileName,
      mimetype,
      leadId,
    }: {
      phoneNumber: string;
      instanceName: string;
      instanceId?: string | null;
      mediaType: "image" | "audio" | "document" | "video" | "sticker";
      media: string;
      caption?: string;
      fileName?: string;
      mimetype?: string;
      leadId?: string | null;
    }) => {
      if (!teamMember?.organization_id || !teamMember?.id) {
        throw new Error("Usuário não vinculado à equipe");
      }

      const formattedNumber = formatPhoneForWhatsApp(phoneNumber);
      if (!formattedNumber) throw new Error("Número de telefone inválido");
      let mediaUrl = media;

      if (media.startsWith("data:")) {
        mediaUrl = await uploadMediaToStorage(
          media,
          mediaType,
          teamMember.organization_id,
          fileName,
        );
      }

      const isSzChat = await isSzChatInstanceCached(instanceId);

      let data: Record<string, unknown>;
      let error: unknown;

      if (isSzChat) {
        const result = await invokeWithTimeout("sz-chat-send", {
          action: "send_message",
          organization_id: teamMember.organization_id,
          phone_number: formattedNumber,
          message: caption || "",
          message_type: "media",
          media_url: mediaUrl,
        });
        data = result.data;
        error = result.error;

        if (error) throw new Error((error as { message?: string }).message || "Erro ao enviar mídia via SZ.chat");
        if ((data as Record<string, unknown>)?.error) throw new Error((data as Record<string, string>).error);
      } else {
        if (!instanceId) {
          throw new Error(
            "Instância WhatsApp não identificada. Recarregue a página."
          );
        }
        const proxyAction = mediaType === "audio" ? "sendAudio" : "sendMedia";
        const proxyPayload: Record<string, unknown> =
          mediaType === "audio"
            ? { number: formattedNumber, file: mediaUrl }
            : {
                number: formattedNumber,
                type: mediaType,
                file: mediaUrl,
                filename: fileName || `file_${Date.now()}`,
                caption: caption || "",
              };
        if (leadId) proxyPayload.lead_id = leadId;

        const result = await invokeWithTimeout(
          "whatsapp-api-proxy",
          {
            action: proxyAction,
            instance_id: instanceId,
            organization_id: teamMember.organization_id,
            payload: proxyPayload,
          },
          60_000, // media needs more time (upload + Uazapi)
        );
        data = result.data;
        error = result.error;

        if (error) {
          throw new Error((error as { message?: string }).message || "Erro ao enviar mídia");
        }
        if ((data as Record<string, unknown>)?.error) {
          const details = (data as Record<string, unknown>).details
            ? JSON.stringify((data as Record<string, unknown>).details)
            : "";
          throw new Error(`${(data as Record<string, string>).error}${details ? ` - ${details}` : ""}`);
        }
      }

      const d = data as Record<string, any>;
      const messageId = d?.result?.message_id ?? d?.key?.id ?? `local_${Date.now()}`;

      // Fire-and-forget — webhook send.message is the authoritative save
      supabase.from("whatsapp_messages").upsert({
        organization_id: teamMember.organization_id,
        instance_id: instanceId || null,
        message_id: messageId,
        remote_jid: `${formattedNumber}@s.whatsapp.net`,
        phone_number: phoneNumber,
        direction: "outgoing",
        message_type: mediaType,
        content: caption || null,
        media_url: mediaUrl,
        status: "sent",
        timestamp: new Date().toISOString(),
      }, { onConflict: "message_id,instance_id", ignoreDuplicates: false })
        .then(({ error: e }) => { if (e) console.warn("[send] media upsert fallback failed:", e.message); });

      return data;
    },
    onMutate: async (variables) => {
      const orgId = teamMember?.organization_id;
      const phone = variables.phoneNumber;
      const instId = variables.instanceId;

      await queryClient.cancelQueries({ queryKey: ["whatsapp_messages", orgId, phone, instId] });

      const previousMessages = queryClient.getQueryData<WhatsAppMessage[]>(
        ["whatsapp_messages", orgId, phone, instId]
      );

      const optimisticMsg: WhatsAppMessage = {
        id: `optimistic_${Date.now()}`,
        organization_id: orgId || "",
        instance_id: instId || null,
        message_id: `optimistic_${Date.now()}`,
        remote_jid: `${phone}@s.whatsapp.net`,
        phone_number: phone,
        direction: "outgoing",
        message_type: variables.mediaType,
        content: variables.caption || null,
        media_url: null,
        push_name: null,
        status: "pending",
        lead_id: null,
        timestamp: new Date().toISOString(),
        created_at: new Date().toISOString(),
        sent_by_ai: false,
      };

      queryClient.setQueryData<WhatsAppMessage[]>(
        ["whatsapp_messages", orgId, phone, instId],
        (old) => [...(old || []), optimisticMsg]
      );

      return { previousMessages };
    },
    onError: (err, variables, context) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(
          ["whatsapp_messages", teamMember?.organization_id, variables.phoneNumber, variables.instanceId],
          context.previousMessages
        );
      }
      const failedKey = ["whatsapp_failed_messages", teamMember?.organization_id, variables.phoneNumber, variables.instanceId];
      queryClient.setQueryData<FailedMessage[]>(failedKey, (prev = []) => [
        ...prev,
        {
          id: `failed-${Date.now()}-${Math.random()}`,
          phoneNumber: variables.phoneNumber,
          instanceId: variables.instanceId ?? null,
          instanceName: variables.instanceName,
          message: variables.caption ?? null,
          mediaUrl: null,
          mediaType: variables.mediaType,
          error: err instanceof Error ? err.message : "Falha ao enviar mídia",
          timestamp: new Date().toISOString(),
          direction: "outgoing",
          status: "failed",
          sent_by_ai: false,
        },
      ]);
    },
    onSettled: (_, __, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["whatsapp_messages", teamMember?.organization_id, variables.phoneNumber, variables.instanceId],
      });
      queryClient.invalidateQueries({ queryKey: ["whatsapp_contacts"] });
    },
  });
}

/**
 * Hook para ler mensagens com falha de envio (cache paralelo, não persiste no banco).
 */
export function useFailedMessages(phoneNumber: string, instanceId: string | null) {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  const key = ["whatsapp_failed_messages", organizationId, phoneNumber, instanceId];
  return queryClient.getQueryData<FailedMessage[]>(key) ?? [];
}

/**
 * Hook para reenviar uma mensagem que falhou.
 * Remove do cache paralelo e chama o mutation original.
 */
export function useRetryMessage() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;
  const sendMessage = useSendWhatsAppMessage();
  const sendMedia = useSendWhatsAppMedia();

  return async (failed: FailedMessage) => {
    const key = ["whatsapp_failed_messages", organizationId, failed.phoneNumber, failed.instanceId];
    queryClient.setQueryData<FailedMessage[]>(key, (prev = []) => prev.filter((m) => m.id !== failed.id));

    if (failed.mediaType && failed.mediaUrl) {
      await sendMedia.mutateAsync({
        phoneNumber: failed.phoneNumber,
        instanceName: failed.instanceName,
        instanceId: failed.instanceId,
        mediaType: failed.mediaType as "image" | "audio" | "document" | "video",
        media: failed.mediaUrl,
        caption: failed.message ?? undefined,
      });
    } else if (failed.message) {
      await sendMessage.mutateAsync({
        phoneNumber: failed.phoneNumber,
        message: failed.message,
        instanceName: failed.instanceName,
        instanceId: failed.instanceId,
      });
    }
  };
}
