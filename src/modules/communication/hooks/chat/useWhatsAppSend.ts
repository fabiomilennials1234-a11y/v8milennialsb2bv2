/**
 * useSendWhatsAppMessage + useSendWhatsAppMedia + useFailedMessages + useRetryMessage
 * Extraídos de src/hooks/useWhatsAppChat.ts (C12).
 *
 * Helpers privados co-locados: isSzChatInstance, assertCanReplyOnInstance,
 * sanitizeFileName, normalizeMimeType, getMimeType, uploadMediaToStorage.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import { track } from "@/lib/analytics";
import { formatPhoneForWhatsApp } from "@/modules/communication/lib/whatsapp";
import {
  friendlyWhatsAppSendError,
  whatsAppSendErrorMessage,
} from "@/modules/communication/lib/edgeFunctionError";
import { sendWithBoundedRecovery, MAX_SEND_RETRIES, type SendResponse } from "./shared/send-recovery";
import type { WhatsAppMessage, FailedMessage } from "./types";
import { makeOptimisticId, promoteOptimisticMessage } from "./shared/optimistic-messages";

/**
 * Lê o id do provider carimbado em `_localMessage` pelo mutationFn.
 *
 * Devolve `undefined` também para o fallback `local_…` — esse id é inventado
 * pelo cliente quando a resposta do envio não traz um, e não casa com a linha
 * que o webhook grava. Promover a bolha com ele criaria a duplicata que este
 * caminho existe pra evitar; melhor deixá-la otimista e o casamento por
 * conteúdo resolver.
 */
function readProviderMessageId(data: unknown): string | undefined {
  const local = (data as { _localMessage?: { messageId?: unknown } } | null | undefined)
    ?._localMessage;
  const id = local?.messageId;
  if (typeof id !== "string" || id.startsWith("local_")) return undefined;
  return id;
}

/** Copy única pro telefone que não passa na normalização — aponta pra ação. */
const INVALID_PHONE_MESSAGE =
  "Número de telefone inválido para WhatsApp. Confira o telefone no cadastro do lead (precisa ser um celular brasileiro com DDD).";

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

function recoveryContext(queryClient: QueryClient, org: string, phone: string, instanceId: string | null | undefined, sendId: string | undefined, content: string | null, mediaUrl?: string) {
  const key = ["whatsapp_messages", org, phone, instanceId];
  const original = queryClient.getQueryData<WhatsAppMessage[]>(key)?.find(m => m.id === sendId);
  const since = new Date(new Date(original?.timestamp ?? Date.now()).getTime() - 1000).toISOString();
  return {
    onRetry: (attempt: number) => queryClient.setQueryData<WhatsAppMessage[]>(key, old =>
      (old ?? []).map(m => m.id === sendId ? { ...m, retry_attempt: attempt } : m)),
    confirm: async (): Promise<SendResponse | null> => {
      const normalizedPhone = formatPhoneForWhatsApp(phone);
      if (!instanceId || !normalizedPhone) return null;
      let q = supabase.from("whatsapp_messages").select("message_id")
        .eq("organization_id", org).eq("instance_id", instanceId)
        .eq("phone_number", normalizedPhone).eq("direction", "outgoing")
        .in("status", ["sent", "delivered", "read", "played"])
        .gte("timestamp", since);
      if (mediaUrl) q = q.eq("media_url", mediaUrl);
      else q = q.eq("content", content ?? "");
      const { data, error } = await q.order("timestamp", { ascending: false }).limit(1);
      if (error || !data?.[0]) return null;
      return { data: { _confirmed: true, result: { message_id: data[0].message_id } }, error: null };
    },
  };
}

async function invokeWithTimeout(
  fnName: string,
  body: Record<string, unknown>,
  timeoutMs = SEND_TIMEOUT_MS,
  recovery?: ReturnType<typeof recoveryContext>,
): Promise<{ data: Record<string, unknown>; error: unknown }> {
  const result = await sendWithBoundedRecovery({
    send: () => supabase.functions.invoke(fnName, { body }),
    confirm: recovery?.confirm ?? (async () => null),
    onRetry: recovery?.onRetry ?? (() => {}),
    timeoutMs,
  });
  return { data: result.data ?? {}, error: result.error };
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
  // Segmento aleatório no path: o bucket `media` é público (o provider busca a
  // URL pra enviar), então um path não-enumerável impede acesso por adivinhação.
  const filePath = `whatsapp-media/${organizationId}/${crypto.randomUUID()}/${uniqueFileName}`;

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
    retry: false, // one recovery controller owns the ten-attempt budget
    mutationFn: async ({
      phoneNumber,
      message,
      instanceName,
      instanceId,
      leadId,
      _sendId,
    }: {
      phoneNumber: string;
      message: string;
      instanceName: string;
      instanceId?: string | null;
      leadId?: string | null;
      _sendId?: string;
    }) => {
      if (!teamMember?.organization_id || !teamMember?.id) {
        throw new Error("Usuário não vinculado à equipe");
      }

      const formattedNumber = formatPhoneForWhatsApp(phoneNumber);
      if (!formattedNumber) throw new Error(INVALID_PHONE_MESSAGE);

      const isSzChat = await isSzChatInstanceCached(instanceId);

      let data: Record<string, unknown>;
      let error: unknown;

      if (isSzChat) {
        const result = await invokeWithTimeout("sz-chat-send", {
          action: "send_message",
          organization_id: teamMember.organization_id,
          phone_number: formattedNumber,
          message,
        }, SEND_TIMEOUT_MS, recoveryContext(queryClient, teamMember.organization_id, phoneNumber, instanceId, _sendId, message));
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
        }, SEND_TIMEOUT_MS, recoveryContext(queryClient, teamMember.organization_id, phoneNumber, instanceId, _sendId, message));
        data = result.data;
        error = result.error;
      }

      // Nunca relance o erro cru: a FunctionsHttpError do supabase-js carrega
      // sempre a mesma frase genérica e esconde o motivo real no corpo.
      if (error) throw new Error(await whatsAppSendErrorMessage(error));
      if ((data as Record<string, unknown>)?.error) {
        throw new Error(friendlyWhatsAppSendError(String((data as Record<string, string>).error)));
      }

      const d = data as Record<string, any>;
      const messageId = d?.result?.message_id ?? d?.key?.id ?? `local_${Date.now()}`;
      const timestamp = new Date().toISOString();

      // Fire-and-forget — webhook send.message is the authoritative save
      if (!data._confirmed && !messageId.startsWith("local_")) supabase.from("whatsapp_messages").upsert({
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

      const optimisticId = variables._sendId ?? makeOptimisticId();
      variables._sendId = optimisticId;
      const optimisticMsg: WhatsAppMessage = {
        id: optimisticId,
        organization_id: orgId || "",
        instance_id: instId || null,
        message_id: optimisticId,
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
        sent_source: "manual",
      };

      queryClient.setQueryData<WhatsAppMessage[]>(
        ["whatsapp_messages", orgId, phone, instId],
        (old) => [...(old || []), optimisticMsg]
      );

      return { previousMessages, optimisticId, timestamp: optimisticMsg.timestamp };
    },
    onError: (err, variables, context) => {
      if (context?.optimisticId) {
        queryClient.setQueryData(
          ["whatsapp_messages", teamMember?.organization_id, variables.phoneNumber, variables.instanceId],
          (old: WhatsAppMessage[] = []) => old.filter(m => m.id !== context.optimisticId)
        );
      }
      const failedKey = ["whatsapp_failed_messages", teamMember?.organization_id, variables.phoneNumber, variables.instanceId];
      queryClient.setQueryData<FailedMessage[]>(failedKey, (prev = []) => [
        ...prev.filter(m => m.id !== context?.optimisticId),
        {
          id: context?.optimisticId ?? variables._sendId ?? makeOptimisticId(),
          retry_attempt: err instanceof Error && "retryAttempts" in err ? MAX_SEND_RETRIES : 0,
          phoneNumber: variables.phoneNumber,
          instanceId: variables.instanceId ?? null,
          instanceName: variables.instanceName,
          message: variables.message,
          mediaUrl: null,
          mediaType: null,
          error: err instanceof Error ? err.message : "Falha ao enviar",
          timestamp: context?.timestamp ?? new Date().toISOString(),
          direction: "outgoing",
          status: "failed",
          sent_by_ai: false,
        },
      ]);
    },
    onSuccess: (data, variables, context) => {
      // Carimba o id real do provider na bolha otimista assim que ele chega.
      // A partir daí o dedupe por message_id do realtime reconhece a linha do
      // webhook e não anexa uma segunda bolha.
      const realMessageId = readProviderMessageId(data);
      if (context?.optimisticId) {
        queryClient.setQueryData<WhatsAppMessage[]>(
          ["whatsapp_messages", teamMember?.organization_id, variables.phoneNumber, variables.instanceId],
          (old) => realMessageId
            ? promoteOptimisticMessage(old, context.optimisticId, realMessageId)
            : (old ?? []).map(m => m.id === context.optimisticId ? { ...m, status: "sent", retry_attempt: undefined } : m),
        );
      }

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
    retry: false, // one recovery controller owns the ten-attempt budget
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
      _sendId,
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
      _sendId?: string;
    }) => {
      if (!teamMember?.organization_id || !teamMember?.id) {
        throw new Error("Usuário não vinculado à equipe");
      }

      const formattedNumber = formatPhoneForWhatsApp(phoneNumber);
      if (!formattedNumber) throw new Error(INVALID_PHONE_MESSAGE);
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
        }, 60_000, recoveryContext(queryClient, teamMember.organization_id, phoneNumber, instanceId, _sendId, caption ?? null, mediaUrl));
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
          recoveryContext(queryClient, teamMember.organization_id, phoneNumber, instanceId, _sendId, caption ?? null, mediaUrl),
        );
        data = result.data;
        error = result.error;

        if (error) {
          // Mesmo motivo do envio de texto: `.message` aqui é a frase genérica
          // do supabase-js, não o erro que a edge function devolveu.
          throw new Error(await whatsAppSendErrorMessage(error));
        }
        if ((data as Record<string, unknown>)?.error) {
          const details = (data as Record<string, unknown>).details
            ? JSON.stringify((data as Record<string, unknown>).details)
            : "";
          const friendly = friendlyWhatsAppSendError(String((data as Record<string, string>).error));
          // Só anexa o detalhe cru quando a mensagem não foi traduzida — senão
          // o texto acionável volta a ficar poluído de ruído do provider.
          const isTranslated = friendly !== (data as Record<string, string>).error;
          throw new Error(isTranslated || !details ? friendly : `${friendly} - ${details}`);
        }
      }

      const d = data as Record<string, any>;
      const messageId = d?.result?.message_id ?? d?.key?.id ?? `local_${Date.now()}`;

      // Fire-and-forget — webhook send.message is the authoritative save
      if (!data._confirmed && !messageId.startsWith("local_")) supabase.from("whatsapp_messages").upsert({
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

      // `_localMessage` carrega o id real do provider até o onSuccess, que o usa
      // pra promover a bolha otimista. Mesmo contrato do envio de texto.
      return { ...(data as Record<string, unknown>), _localMessage: { messageId } };
    },
    onMutate: async (variables) => {
      const orgId = teamMember?.organization_id;
      const phone = variables.phoneNumber;
      const instId = variables.instanceId;

      await queryClient.cancelQueries({ queryKey: ["whatsapp_messages", orgId, phone, instId] });

      const previousMessages = queryClient.getQueryData<WhatsAppMessage[]>(
        ["whatsapp_messages", orgId, phone, instId]
      );

      const optimisticId = variables._sendId ?? makeOptimisticId();
      variables._sendId = optimisticId;
      const optimisticMsg: WhatsAppMessage = {
        id: optimisticId,
        organization_id: orgId || "",
        instance_id: instId || null,
        message_id: optimisticId,
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
        sent_source: "manual",
      };

      queryClient.setQueryData<WhatsAppMessage[]>(
        ["whatsapp_messages", orgId, phone, instId],
        (old) => [...(old || []), optimisticMsg]
      );

      return { previousMessages, optimisticId, timestamp: optimisticMsg.timestamp };
    },
    onSuccess: (data, variables, context) => {
      // Mesma promoção do envio de texto — ver comentário lá.
      const realMessageId = readProviderMessageId(data);
      if (context?.optimisticId) {
        queryClient.setQueryData<WhatsAppMessage[]>(
          ["whatsapp_messages", teamMember?.organization_id, variables.phoneNumber, variables.instanceId],
          (old) => realMessageId
            ? promoteOptimisticMessage(old, context.optimisticId, realMessageId)
            : (old ?? []).map(m => m.id === context.optimisticId ? { ...m, status: "sent", retry_attempt: undefined } : m),
        );
      }
    },
    onError: (err, variables, context) => {
      if (context?.optimisticId) {
        queryClient.setQueryData(
          ["whatsapp_messages", teamMember?.organization_id, variables.phoneNumber, variables.instanceId],
          (old: WhatsAppMessage[] = []) => old.filter(m => m.id !== context.optimisticId)
        );
      }
      const failedKey = ["whatsapp_failed_messages", teamMember?.organization_id, variables.phoneNumber, variables.instanceId];
      queryClient.setQueryData<FailedMessage[]>(failedKey, (prev = []) => [
        ...prev.filter(m => m.id !== context?.optimisticId),
        {
          id: context?.optimisticId ?? variables._sendId ?? makeOptimisticId(),
          retry_attempt: err instanceof Error && "retryAttempts" in err ? MAX_SEND_RETRIES : 0,
          phoneNumber: variables.phoneNumber,
          instanceId: variables.instanceId ?? null,
          instanceName: variables.instanceName,
          message: variables.caption ?? null,
          mediaUrl: variables.media,
          mediaType: variables.mediaType,
          error: err instanceof Error ? err.message : "Falha ao enviar mídia",
          timestamp: context?.timestamp ?? new Date().toISOString(),
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
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  const key = ["whatsapp_failed_messages", organizationId, phoneNumber, instanceId];
  return useQuery<FailedMessage[]>({ queryKey: key, queryFn: async () => [], enabled: false, initialData: [] }).data;
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
    if ((failed.retry_attempt ?? 0) >= MAX_SEND_RETRIES) return;
    const key = ["whatsapp_failed_messages", organizationId, failed.phoneNumber, failed.instanceId];
    queryClient.setQueryData<FailedMessage[]>(key, (prev = []) => prev.filter((m) => m.id !== failed.id));

    if (failed.mediaType && failed.mediaUrl) {
      await sendMedia.mutateAsync({
        _sendId: failed.id,
        phoneNumber: failed.phoneNumber,
        instanceName: failed.instanceName,
        instanceId: failed.instanceId,
        mediaType: failed.mediaType as "image" | "audio" | "document" | "video",
        media: failed.mediaUrl,
        caption: failed.message ?? undefined,
      });
    } else if (failed.message) {
      await sendMessage.mutateAsync({
        _sendId: failed.id,
        phoneNumber: failed.phoneNumber,
        message: failed.message,
        instanceName: failed.instanceName,
        instanceId: failed.instanceId,
      });
    }
  };
}
