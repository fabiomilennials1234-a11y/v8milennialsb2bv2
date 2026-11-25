import { providerSendStatus } from "@/modules/communication/lib/providerSendStatus";
import { resolveAttachmentMimeType } from "@/modules/communication/lib/attachment-media-type";
import { useCallback, useRef, useState } from "react";
import { useChatReply } from "./useChatReply";
/**
 * useSendWhatsAppMessage + useSendWhatsAppMedia + useFailedMessages + useRetryMessage
 * Extraídos de src/hooks/useWhatsAppChat.ts (C12).
 *
 * Helpers privados co-locados: isSzChatInstance, assertCanReplyOnInstance,
 * sanitizeFileName, normalizeMimeType, getMimeType, uploadMediaToStorage.
 */
import { useQuery, useQueryClient, type MutationObserverOptions, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useCurrentTeamMember } from "@/modules/identity";
import { track } from "@/lib/analytics";
import { resolveWhatsAppDestination, type WhatsAppDestination } from "@/modules/communication/lib/whatsapp";
import {
  friendlyWhatsAppSendError,
  whatsAppSendErrorMessage,
} from "@/modules/communication/lib/edgeFunctionError";
import { sendWithBoundedRecovery, SendRetriesExhausted, MAX_SEND_RETRIES, type SendResponse } from "./shared/send-recovery";
import type { WhatsAppMessage, FailedMessage, ReplyContext, MidiaAPreparar } from "./types";
import { makeOptimisticId, promoteOptimisticMessage } from "./shared/optimistic-messages";
import { userMessageOf } from "@/shared/errors";
import { MEDIA_UPLOAD_TIMEOUT_MS, MediaOperationError, withMediaDeadline } from "@/modules/communication/lib/media-operation";
import { deriveMentions } from "@/modules/communication/lib/groupMentionComposer";
import { readCachedMentionablePhones } from "./useGroupParticipants";
import {
  assinaturaDoEnvio,
  encerrarItem,
  enfileirarEnvio,
  filaInterrompida,
  FilaInterrompidaError,
  inicioDaJanelaDeConfirmacao,
  interromperFila,
  provaDeConfirmacao,
  registrarConfirmado,
  registrarTentativa,
  type ConversaDaFila,
} from "./shared/filaDeEnvio";
import { registrarEnvioNaLista } from "./shared/cacheDeContatos";

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
  "Número de telefone inválido para WhatsApp. Confira o telefone no cadastro do lead (precisa ser um número brasileiro com DDD).";

/** Grupo sem id utilizável — não é problema de cadastro de lead, então copy própria. */
const INVALID_GROUP_MESSAGE = "Não foi possível identificar este grupo do WhatsApp. Recarregue a conversa.";

/** SZ Chat só fala com números; não há rota para JID de grupo. */
const SZ_CHAT_GROUP_MESSAGE = "Envio para grupo não está disponível nesta conexão";

/**
 * `mentions` do envio ao grupo, tirados do TEXTO FINAL contra os participantes
 * já carregados pelo seletor. Fora de grupo, ou sem menção, nada — o payload
 * fica idêntico ao de sempre.
 */
function groupMentionsField(
  queryClient: QueryClient,
  isGroup: boolean | undefined,
  instanceId: string | null | undefined,
  groupJid: string,
  text: string | null | undefined,
): { mentions?: string[] } {
  if (!isGroup) return {};
  const mentions = deriveMentions(text, readCachedMentionablePhones(queryClient, instanceId, groupJid));
  return mentions.length > 0 ? { mentions } : {};
}

function resolveDestinationOrThrow(phoneNumber: string, isGroup: boolean | undefined): WhatsAppDestination {
  const destination = resolveWhatsAppDestination(phoneNumber, isGroup);
  if (!destination) throw new Error(isGroup ? INVALID_GROUP_MESSAGE : INVALID_PHONE_MESSAGE);
  return destination;
}

// ─── Helpers privados ────────────────────────────────────────────────────────

const SEND_TIMEOUT_MS = 15_000;

// Per-instance cache — instance type never changes during a session
const szChatCache = new Map<string, boolean>();

async function isSzChatInstanceCached(instanceId: string | null | undefined): Promise<boolean> {
  if (!instanceId) return false;
  const cached = szChatCache.get(instanceId);
  if (cached !== undefined) return cached;
  const { data, error } = await withMediaDeadline("connection", signal => supabase
    .from("whatsapp_instances")
    .select("metadata")
    .eq("id", instanceId)
    .abortSignal(signal)
    .maybeSingle());
  if (error) throw new MediaOperationError("connection", "failed");
  const result = (data?.metadata as Record<string, unknown>)?.channel === "sz_chat";
  szChatCache.set(instanceId, result);
  return result;
}

/**
 * Confirmação de envio ambíguo, com a idempotência da fila (CP-v2 item 3).
 *
 * Criada DENTRO do `mutationFn`, imediatamente antes do POST — e é aí que o
 * item passa a constar como "chamou o provider" (`registrarTentativa`).
 *
 * REGRA: o confirm nunca dá falso positivo. Ele conta as linhas da janela
 * (`ts - 1 s`) com a assinatura do item, fora as já atribuídas a itens desta
 * fila, e só confirma quando há MAIS linhas do que itens anteriores desta fila
 * com a mesma assinatura que chamaram o provider sem ficar com linha
 * (`provaDeConfirmacao`). Na dúvida, não confirma: bolha de falha e reenvio
 * manual. A linha reivindicada vira do item (`registrarConfirmado` no
 * onSuccess) e sai da busca dos seguintes.
 */
function recoveryContext(queryClient: QueryClient, org: string, phone: string, destination: WhatsAppDestination, instanceId: string | null | undefined, sendId: string | undefined, content: string | null, fila: ConversaDaFila, mediaUrl?: string) {
  const key = ["whatsapp_messages", org, phone, instanceId];
  const original = queryClient.getQueryData<WhatsAppMessage[]>(key)?.find(m => m.id === sendId);
  const since = inicioDaJanelaDeConfirmacao(original?.timestamp);
  const citacao = original?.reply_context?.messageId ?? null;
  const assinatura = assinaturaDoEnvio({ conteudo: content, mediaUrl, citacao });
  registrarTentativa(queryClient, fila, assinatura, sendId);
  return {
    onRetry: (attempt: number) => queryClient.setQueryData<WhatsAppMessage[]>(key, old =>
      (old ?? []).map(m => m.id === sendId ? { ...m, retry_attempt: attempt } : m)),
    confirm: async (): Promise<SendResponse | null> => {
      if (!instanceId) return null;
      // Lida a cada tentativa: o histórico da fila é o de agora.
      const prova = provaDeConfirmacao(queryClient, fila, assinatura, sendId);
      if (!prova) return null;
      let q = supabase.from("whatsapp_messages").select("message_id")
        .eq("organization_id", org).eq("instance_id", instanceId)
        .eq("phone_number", destination.phoneNumber).eq("direction", "outgoing")
        .in("status", ["sent", "delivered", "read", "played"])
        .gte("timestamp", since);
      q = citacao ? q.eq("reply_context->>messageId", citacao) : q.is("reply_context", null);
      // Texto só se prova com linha de TEXTO: o webhook grava a legenda da mídia
      // em `content`, então sem o filtro uma imagem "ok" confirmaria o texto "ok".
      if (mediaUrl) q = q.eq("media_url", mediaUrl);
      else q = q.eq("content", content ?? "").is("media_url", null);
      if (prova.excluir.length > 0) q = q.not("message_id", "in", listaPostgrest(prova.excluir));
      const { data, error } = await q.order("timestamp", { ascending: false }).limit(prova.minimoDeLinhas);
      if (error || !data || data.length < prova.minimoDeLinhas) return null;
      return { data: { _confirmed: true, result: { message_id: data[0].message_id } }, error: null };
    },
  };
}

/** `("a","b")` — lista do operador `in` do PostgREST, com aspas para ids opacos. */
function listaPostgrest(ids: readonly string[]): string {
  return `(${ids.map(id => `"${id.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")})`;
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
  const matches = base64Data.match(/^data:([^;,]*)[^,]*;base64,(.+)$/);
  if (!matches) {
    throw new Error("Formato de arquivo inválido");
  }

  const rawMimeType = matches[1];
  const attachmentMime = mediaType === "document"
    ? resolveAttachmentMimeType(rawMimeType, fileName)
    : rawMimeType;
  if (!attachmentMime) {
    throw new Error("Formato de arquivo inválido");
  }
  const mimeType = normalizeMimeType(attachmentMime);
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

  // storage-js upload() has no AbortSignal. Sign with the current user's RLS,
  // then PUT with a cancellable transport. A late signing response cannot send.
  await withMediaDeadline("upload", async signal => {
    const { data, error } = await supabase.storage.from("media").createSignedUploadUrl(filePath);
    signal.throwIfAborted();
    if (error || !data?.signedUrl) {
      const status = Number((error as { statusCode?: string } | null)?.statusCode);
      throw new MediaOperationError("upload", status === 401 ? "unauthorized" : status === 403 ? "forbidden" : "failed");
    }
    const response = await fetch(data.signedUrl, {
      method: "PUT", body: blob, signal,
      headers: { "Content-Type": mimeType, "cache-control": "max-age=3600", "x-upsert": "false" },
    });
    if (!response.ok) throw new MediaOperationError("upload", response.status === 401 ? "unauthorized" : response.status === 403 ? "forbidden" : "failed");
  }, MEDIA_UPLOAD_TIMEOUT_MS);

  const { data: urlData } = supabase.storage
    .from("media")
    .getPublicUrl(filePath);

  if (!urlData?.publicUrl) {
    throw new Error("Erro ao obter URL pública do arquivo");
  }

  return urlData.publicUrl;
}

// ─── Fila (CP-v2, régua de espera) ───────────────────────────────────────────

export type { MidiaAPreparar };

/**
 * O 1º `preparar()` de cada mídia é o único: resultado OU erro ficam guardados
 * por objeto. Ler um PDF de 16 MB / converter um áudio para MP3 de novo só
 * porque alguém perguntou duas vezes atrasaria a fila inteira — e um erro de
 * conversão não melhora na segunda leitura dentro do mesmo envio.
 */
const preparos = new WeakMap<MidiaAPreparar, Promise<string>>();

function prepararUmaVez(m: MidiaAPreparar): Promise<string> {
  let p = preparos.get(m);
  if (!p) {
    p = m.preparar();
    preparos.set(m, p);
  }
  return p;
}

/** O que os composers usam de um envio. `isPending` = há item desta tela na fila. */
export interface EnvioEmFila<V, D> {
  mutateAsync: (variaveis: V) => Promise<D>;
  mutate: (variaveis: V) => void;
  isPending: boolean;
}

interface VariaveisDaConversa {
  phoneNumber: string;
  isGroup?: boolean;
  instanceId?: string | null;
}

interface ContextoDoEnvio {
  previousMessages: WhatsAppMessage[] | undefined;
  optimisticId: string;
  timestamp: string;
}

function conversaDoEnvio(organizationId: string | null | undefined, v: VariaveisDaConversa): ConversaDaFila {
  return { organizationId, instanceId: v.instanceId, phoneNumber: v.phoneNumber, isGroup: v.isGroup };
}

/**
 * Cada chamada vira um item na fila da SUA conversa (ver `shared/filaDeEnvio.ts`
 * para o porquê de não ser um `useMutation` com `scope` fixo).
 */
function useEnvioEmFila<V extends VariaveisDaConversa, D, C>(
  organizationId: string | null | undefined,
  opcoes: MutationObserverOptions<D, Error, V, C>,
): EnvioEmFila<V, D> {
  const queryClient = useQueryClient();
  // As opções mais recentes (closures com teamMember/reply atuais) valem para
  // o PRÓXIMO item; um item já criado mantém as suas, como no useMutation.
  const opcoesRef = useRef(opcoes);
  opcoesRef.current = opcoes;
  const [naFila, setNaFila] = useState(0);

  const mutateAsync = useCallback(async (variaveis: V) => {
    setNaFila(n => n + 1);
    try {
      return await enfileirarEnvio(queryClient, conversaDoEnvio(organizationId, variaveis), opcoesRef.current, variaveis);
    } finally {
      setNaFila(n => n - 1);
    }
  }, [queryClient, organizationId]);

  const mutate = useCallback((variaveis: V) => { mutateAsync(variaveis).catch(() => {}); }, [mutateAsync]);

  return { mutateAsync, mutate, isPending: naFila > 0 };
}

// ─── Hooks públicos ──────────────────────────────────────────────────────────

export interface EnvioDeTexto {
  phoneNumber: string;
  /** `is_group` do contato: o destino vira o JID `<id>@g.us`. */
  isGroup?: boolean;
  message: string;
  instanceName: string;
  instanceId?: string | null;
  leadId?: string | null;
  _sendId?: string;
  replyContext?: ReplyContext;
}

/**
 * Hook para enviar mensagem de texto via WhatsApp — em fila por conversa.
 */
export function useSendWhatsAppMessage() {
  const reply = useChatReply();
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useEnvioEmFila(organizationId, {
    retry: false, // one recovery controller owns the ten-attempt budget
    mutationFn: async (variables: EnvioDeTexto) => {
      const { phoneNumber, isGroup, message, instanceId, leadId, _sendId, replyContext } = variables;
      if (!teamMember?.organization_id || !teamMember?.id) {
        throw new Error("Usuário não vinculado à equipe");
      }
      // Um anterior desta fila falhou: este item nunca chega ao provider.
      const fila = conversaDoEnvio(teamMember.organization_id, variables);
      if (filaInterrompida(queryClient, fila)) throw new FilaInterrompidaError();

      const destination = resolveDestinationOrThrow(phoneNumber, isGroup);
      const formattedNumber = destination.number;

      const isSzChat = await isSzChatInstanceCached(instanceId);

      let data: Record<string, unknown>;
      let error: unknown;

      if (isSzChat && isGroup) throw new Error(SZ_CHAT_GROUP_MESSAGE);
      if (isSzChat && replyContext) throw new Error("Respostas citadas não estão disponíveis nesta conexão");
      if (isSzChat) {
        const result = await invokeWithTimeout("sz-chat-send", {
          action: "send_message",
          organization_id: teamMember.organization_id,
          phone_number: formattedNumber,
          message,
        }, SEND_TIMEOUT_MS, recoveryContext(queryClient, teamMember.organization_id, phoneNumber, destination, instanceId, _sendId, message, fila));
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
            ...(replyContext ? { replyid: replyContext.messageId } : {}),
            ...(leadId ? { lead_id: leadId } : {}),
            ...groupMentionsField(queryClient, isGroup, instanceId, formattedNumber, message),
          },
        }, SEND_TIMEOUT_MS, recoveryContext(queryClient, teamMember.organization_id, phoneNumber, destination, instanceId, _sendId, message, fila));
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
        remote_jid: destination.remoteJid,
        phone_number: isGroup ? destination.phoneNumber : phoneNumber,
        ...(isGroup ? { is_group: true } : {}),
        direction: "outgoing",
        message_type: "text",
        content: message,
        ...(replyContext ? { reply_context: replyContext as unknown as Json } : {}),
        status: providerSendStatus(data),
        timestamp,
      }, { onConflict: "message_id,instance_id", ignoreDuplicates: true })
        .then(({ error: e }) => { if (e) console.warn("[send] upsert fallback failed:", e.message); });

      return { ...data, _localMessage: { phoneNumber, message, instanceId, messageId, timestamp } };
    },
    // Roda na hora do Enter, mesmo para o item que vai esperar a vez: a bolha
    // aparece antes do POST (query-core 5.83.0 mutation.js:82-92).
    onMutate: async (variables): Promise<ContextoDoEnvio> => {
      // Manual retries already carry their original context (including no quote).
      if (!variables._sendId) variables.replyContext ??= reply?.target ?? undefined;
      const orgId = teamMember?.organization_id;
      const phone = variables.phoneNumber;
      const instId = variables.instanceId;

      await queryClient.cancelQueries({ queryKey: ["whatsapp_messages", orgId, phone, instId] });

      const previousMessages = queryClient.getQueryData<WhatsAppMessage[]>(
        ["whatsapp_messages", orgId, phone, instId]
      );

      // `_sendId` é a identidade do item do onMutate ao fim: a bolha, o
      // `onRetry` da recuperação e a bolha de falha usam o MESMO id.
      const optimisticId = variables._sendId ?? makeOptimisticId();
      variables._sendId = optimisticId;
      const optimisticMsg: WhatsAppMessage = {
        id: optimisticId,
        organization_id: orgId || "",
        instance_id: instId || null,
        message_id: optimisticId,
        remote_jid: variables.isGroup ? `${phone}@g.us` : `${phone}@s.whatsapp.net`,
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
        reply_context: variables.replyContext,
      };

      queryClient.setQueryData<WhatsAppMessage[]>(
        ["whatsapp_messages", orgId, phone, instId],
        (old) => [...(old || []), optimisticMsg]
      );

      return { previousMessages, optimisticId, timestamp: optimisticMsg.timestamp };
    },
    onError: (err, variables, context) => {
      const interrompido = err instanceof FilaInterrompidaError;
      // Falha de verdade trava os itens que esperam atrás dela.
      if (!interrompido) interromperFila(queryClient, conversaDoEnvio(teamMember?.organization_id, variables));
      if (context?.optimisticId) {
        queryClient.setQueryData(
          ["whatsapp_messages", teamMember?.organization_id, variables.phoneNumber, variables.instanceId],
          (old: WhatsAppMessage[] = []) => old.filter(m => m.id !== context.optimisticId)
        );
      }
      const failedKey = ["whatsapp_failed_messages", teamMember?.organization_id, variables.phoneNumber, variables.instanceId];
      queryClient.setQueryData<FailedMessage[]>(failedKey, (prev = []) => [
        // A deduplicação por texto junta tentativas repetidas da MESMA frase.
        // Um item interrompido é outra mensagem — "oi", "oi" na fila são duas.
        ...prev.filter((m) => m.id !== context?.optimisticId && (interrompido || m.mediaType || m.message !== variables.message || m.replyContext?.messageId !== variables.replyContext?.messageId)),
        {
          id: context?.optimisticId ?? variables._sendId ?? makeOptimisticId(),
          retry_attempt: err instanceof Error && "retryAttempts" in err ? MAX_SEND_RETRIES : 0,
          phoneNumber: variables.phoneNumber,
          ...(variables.isGroup ? { isGroup: true } : {}),
          instanceId: variables.instanceId ?? null,
          instanceName: variables.instanceName,
          replyContext: variables.replyContext,
          message: variables.message,
          mediaUrl: null,
          mediaType: null,
          error: userMessageOf(err, "Não foi possível enviar a mensagem."),
          timestamp: context?.timestamp ?? new Date().toISOString(),
          direction: "outgoing",
          status: "failed",
          sent_by_ai: false,
        },
      ]);
    },
    onSuccess: (data, variables, context) => {
      if (variables.replyContext) reply?.clear(variables.replyContext.messageId);
      // O operador pode reenviar pelo composer, sem clicar na bolha de retry.
      queryClient.setQueryData<FailedMessage[]>(
        ["whatsapp_failed_messages", teamMember?.organization_id, variables.phoneNumber, variables.instanceId],
        (prev = []) => prev.filter((m) => m.mediaType || m.message !== variables.message || m.replyContext?.messageId !== variables.replyContext?.messageId),
      );
      // Carimba o id real do provider na bolha otimista assim que ele chega.
      // A partir daí o dedupe por message_id do realtime reconhece a linha do
      // webhook e não anexa uma segunda bolha.
      const realMessageId = readProviderMessageId(data);
      // E a fila lembra dele: o confirm de um item seguinte não pode reivindicá-lo.
      if (realMessageId) registrarConfirmado(queryClient, conversaDoEnvio(teamMember?.organization_id, variables), realMessageId);
      if (context?.optimisticId) {
        queryClient.setQueryData<WhatsAppMessage[]>(
          ["whatsapp_messages", teamMember?.organization_id, variables.phoneNumber, variables.instanceId],
          (old) => realMessageId
            ? promoteOptimisticMessage(old, context.optimisticId, realMessageId, providerSendStatus(data))
            : (old ?? []).map(m => m.id === context.optimisticId ? { ...m, status: providerSendStatus(data), retry_attempt: undefined } : m),
        );
      }

      if (teamMember?.organization_id) {
        track({ event: "message_sent", organizationId: teamMember.organization_id, entityType: "conversation" });
      }
    },
    onSettled: (data, _error, variables) => aoTerminarItem(queryClient, teamMember?.organization_id, variables, data ? variables.message : undefined),
  });
}

/**
 * Fecho comum de texto e mídia, no `onSettled` (o item ainda conta como
 * pendente, por isso é ele quem sabe se era o último).
 *
 * - Linha da conversa: patch no lugar (prévia, hora, direção) em cada lista em
 *   cache que mostra aquela caixa — nunca a invalidação da RAIZ
 *   `["whatsapp_contacts"]`, que refazia TODAS as listas da org a cada envio.
 * - Thread: UMA invalidação exata, quando a fila esvazia — e não uma por item.
 */
function aoTerminarItem(
  queryClient: QueryClient,
  organizationId: string | null | undefined,
  variables: VariaveisDaConversa,
  /** Prévia da lista quando o item SAIU; `undefined` = não saiu. `null` = mídia sem legenda. */
  previaEnviada: string | null | undefined,
): void {
  const ultimo = encerrarItem(queryClient, conversaDoEnvio(organizationId, variables));
  if (previaEnviada !== undefined && organizationId) {
    registrarEnvioNaLista(queryClient, {
      organizationId,
      instanceId: variables.instanceId ?? null,
      phoneNumber: variables.phoneNumber,
      conteudo: previaEnviada,
      timestamp: new Date().toISOString(),
    });
  }
  if (ultimo) {
    void queryClient.invalidateQueries({
      queryKey: ["whatsapp_messages", organizationId, variables.phoneNumber, variables.instanceId],
      exact: true,
    });
  }
}

export interface EnvioDeMidia {
  phoneNumber: string;
  /** `is_group` do contato: o destino vira o JID `<id>@g.us`. */
  isGroup?: boolean;
  instanceName: string;
  instanceId?: string | null;
  mediaType: "image" | "audio" | "document" | "video" | "sticker";
  /** URL/data URL pronta, ou o preparo que roda quando a vez do item chega. */
  media: string | MidiaAPreparar;
  caption?: string;
  fileName?: string;
  mimetype?: string;
  leadId?: string | null;
  _sendId?: string;
  replyContext?: ReplyContext;
}

/**
 * Hook para enviar mídia (imagem, áudio) via WhatsApp — na MESMA fila do texto.
 */
export function useSendWhatsAppMedia() {
  const reply = useChatReply();
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;
  // Keep the current attachment after failure, but a second click must only
  // reconcile an ambiguous send; uploading again would generate a new URL and
  // bypass the recovery controller's duplicate protection.
  const unconfirmed = useRef<{
    media: string; phone: string; instance: string | null | undefined;
    org: string; caption: string; quote: string | undefined;
    confirm: () => Promise<SendResponse | null>;
  } | null>(null);

  return useEnvioEmFila(organizationId, {
    retry: false, // one recovery controller owns the ten-attempt budget
    mutationFn: async (variables: EnvioDeMidia) => {
      if (!teamMember?.organization_id || !teamMember?.id) {
        throw new Error("Usuário não vinculado à equipe");
      }
      const fila = conversaDoEnvio(teamMember.organization_id, variables);
      if (filaInterrompida(queryClient, fila)) throw new FilaInterrompidaError();
      // A vez chegou: só agora a leitura/conversão do anexo roda.
      if (typeof variables.media !== "string") variables.media = await prepararUmaVez(variables.media);
      const media = variables.media;
      const { phoneNumber, isGroup, mediaType, caption, fileName, leadId, _sendId, replyContext, instanceId } = variables;

      const destination = resolveDestinationOrThrow(phoneNumber, isGroup);
      const formattedNumber = destination.number;
      const previous = unconfirmed.current;
      if (previous && previous.org === teamMember.organization_id && previous.media === media
        && previous.phone === formattedNumber && previous.instance === instanceId
        && previous.caption === (caption ?? "") && previous.quote === replyContext?.messageId) {
        const confirmed = await withMediaDeadline("connection", () => previous.confirm(), 3_000).catch(() => null);
        if (!confirmed?.data) throw new SendRetriesExhausted();
        unconfirmed.current = null;
        const result = confirmed.data.result as { message_id?: string } | undefined;
        return { ...confirmed.data, _localMessage: { messageId: result?.message_id } };
      }
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
      const recovery = recoveryContext(queryClient, teamMember.organization_id, phoneNumber, destination, instanceId, _sendId, caption ?? null, fila, mediaUrl);

      // Do not depend on realtime/refetch to display an attachment already uploaded.
      queryClient.setQueryData<WhatsAppMessage[]>(
        ["whatsapp_messages", teamMember.organization_id, phoneNumber, instanceId],
        old => old?.map(message => message.id === _sendId ? { ...message, media_url: mediaUrl } : message),
      );

      let data: Record<string, unknown>;
      let error: unknown;

      if (isSzChat && isGroup) throw new Error(SZ_CHAT_GROUP_MESSAGE);
      if (isSzChat && replyContext) throw new Error("Respostas citadas não estão disponíveis nesta conexão");
      if (!isSzChat && !instanceId) throw new Error("Instância WhatsApp não identificada. Recarregue a página.");
      unconfirmed.current = {
        media, phone: formattedNumber, instance: instanceId, org: teamMember.organization_id,
        caption: caption ?? "", quote: replyContext?.messageId, confirm: recovery.confirm,
      };
      if (isSzChat) {
        const result = await invokeWithTimeout("sz-chat-send", {
          action: "send_message",
          organization_id: teamMember.organization_id,
          phone_number: formattedNumber,
          message: caption || "",
          message_type: "media",
          media_url: mediaUrl,
        }, 60_000, recovery);
        // A returned result is success or a definite HTTP rejection. Only
        // exhausted ambiguous sends throw and retain the confirmation guard.
        unconfirmed.current = null;
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
                ...groupMentionsField(queryClient, isGroup, instanceId, formattedNumber, caption),
              };
        if (leadId) proxyPayload.lead_id = leadId;
        if (replyContext) proxyPayload.replyid = replyContext.messageId;

        const result = await invokeWithTimeout(
          "whatsapp-api-proxy",
          {
            action: proxyAction,
            instance_id: instanceId,
            organization_id: teamMember.organization_id,
            payload: proxyPayload,
          },
          60_000, // media needs more time (upload + Uazapi)
          recovery,
        );
        unconfirmed.current = null;
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

      unconfirmed.current = null;
      const d = data as Record<string, any>;
      const messageId = d?.result?.message_id ?? d?.key?.id ?? `local_${Date.now()}`;

      // Fire-and-forget — webhook send.message is the authoritative save
      if (!data._confirmed && !messageId.startsWith("local_")) supabase.from("whatsapp_messages").upsert({
        organization_id: teamMember.organization_id,
        instance_id: instanceId || null,
        message_id: messageId,
        remote_jid: destination.remoteJid,
        phone_number: isGroup ? destination.phoneNumber : phoneNumber,
        ...(isGroup ? { is_group: true } : {}),
        direction: "outgoing",
        message_type: mediaType,
        content: caption || null,
        media_url: mediaUrl,
        // Este fallback não tem raw_payload: sem isto o trigger não acha nome
        // e, se ele chegar antes do eco do webhook, o nome se perde.
        ...(mediaType === "document" && fileName?.trim() ? { media_file_name: fileName.trim().slice(0, 255) } : {}),
        ...(replyContext ? { reply_context: replyContext as unknown as Json } : {}),
        status: providerSendStatus(data),
        timestamp: new Date().toISOString(),
      }, { onConflict: "message_id,instance_id", ignoreDuplicates: true })
        .then(({ error: e }) => { if (e) console.warn("[send] media upsert fallback failed:", e.message); });

      // `_localMessage` carrega o id real do provider até o onSuccess, que o usa
      // pra promover a bolha otimista. Mesmo contrato do envio de texto.
      return { ...(data as Record<string, unknown>), _localMessage: { messageId } };
    },
    onMutate: async (variables): Promise<ContextoDoEnvio> => {
      // Manual retries already carry their original context (including no quote).
      if (!variables._sendId) variables.replyContext ??= reply?.target ?? undefined;
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
        remote_jid: variables.isGroup ? `${phone}@g.us` : `${phone}@s.whatsapp.net`,
        phone_number: phone,
        direction: "outgoing",
        message_type: variables.mediaType,
        content: variables.caption || null,
        media_url: typeof variables.media === "string" ? variables.media : variables.media.previa,
        media_file_name: variables.mediaType === "document" ? variables.fileName?.trim() || null : null,
        push_name: null,
        status: "pending",
        lead_id: null,
        timestamp: new Date().toISOString(),
        created_at: new Date().toISOString(),
        sent_by_ai: false,
        sent_source: "manual",
        reply_context: variables.replyContext,
      };

      queryClient.setQueryData<WhatsAppMessage[]>(
        ["whatsapp_messages", orgId, phone, instId],
        (old) => [...(old || []), optimisticMsg]
      );

      return { previousMessages, optimisticId, timestamp: optimisticMsg.timestamp };
    },
    onSuccess: (data, variables, context) => {
      if (variables.replyContext) reply?.clear(variables.replyContext.messageId);
      // Mesma promoção do envio de texto — ver comentário lá.
      queryClient.setQueryData<FailedMessage[]>(
        ["whatsapp_failed_messages", teamMember?.organization_id, variables.phoneNumber, variables.instanceId],
        (prev = []) => prev.filter(m => m.mediaUrl !== variables.media || m.message !== (variables.caption ?? null) || m.replyContext?.messageId !== variables.replyContext?.messageId),
      );
      const realMessageId = readProviderMessageId(data);
      if (realMessageId) registrarConfirmado(queryClient, conversaDoEnvio(teamMember?.organization_id, variables), realMessageId);
      if (context?.optimisticId) {
        queryClient.setQueryData<WhatsAppMessage[]>(
          ["whatsapp_messages", teamMember?.organization_id, variables.phoneNumber, variables.instanceId],
          (old) => realMessageId
            ? promoteOptimisticMessage(old, context.optimisticId, realMessageId, providerSendStatus(data))
            : (old ?? []).map(m => m.id === context.optimisticId ? { ...m, status: providerSendStatus(data), retry_attempt: undefined } : m),
        );
      }
    },
    onError: (err, variables, context) => {
      const interrompido = err instanceof FilaInterrompidaError;
      if (!interrompido) interromperFila(queryClient, conversaDoEnvio(teamMember?.organization_id, variables));
      if (context?.optimisticId) {
        queryClient.setQueryData(
          ["whatsapp_messages", teamMember?.organization_id, variables.phoneNumber, variables.instanceId],
          (old: WhatsAppMessage[] = []) => old.filter(m => m.id !== context.optimisticId)
        );
      }
      // Mídia pronta → a bolha de falha reenvia a URL/data URL. Mídia que nunca
      // ficou pronta (item interrompido antes da vez, ou o preparo falhou) NÃO
      // é lida aqui: reler o arquivo no onError atrasaria a drenagem da fila
      // e repetiria um preparo que já falhou. Ela vai como `preparo`, e o
      // reenvio manual prepara de novo.
      const mediaUrl = typeof variables.media === "string" ? variables.media : null;
      const preparo = typeof variables.media === "string" ? undefined : variables.media;
      const failedKey = ["whatsapp_failed_messages", teamMember?.organization_id, variables.phoneNumber, variables.instanceId];
      queryClient.setQueryData<FailedMessage[]>(failedKey, (prev = []) => [
        ...prev.filter(m => m.id !== context?.optimisticId && (interrompido || !mediaUrl || m.mediaUrl !== mediaUrl || m.message !== (variables.caption ?? null) || m.replyContext?.messageId !== variables.replyContext?.messageId)),
        {
          id: context?.optimisticId ?? variables._sendId ?? makeOptimisticId(),
          retry_attempt: err instanceof Error && "retryAttempts" in err ? MAX_SEND_RETRIES : 0,
          phoneNumber: variables.phoneNumber,
          ...(variables.isGroup ? { isGroup: true } : {}),
          instanceId: variables.instanceId ?? null,
          instanceName: variables.instanceName,
          replyContext: variables.replyContext,
          message: variables.caption ?? null,
          mediaUrl,
          ...(preparo ? { preparo } : {}),
          mediaType: variables.mediaType,
          error: userMessageOf(err, "Não foi possível enviar a mídia."),
          timestamp: context?.timestamp ?? new Date().toISOString(),
          direction: "outgoing",
          status: "failed",
          sent_by_ai: false,
        },
      ]);
    },
    onSettled: (data, _error, variables) => aoTerminarItem(queryClient, teamMember?.organization_id, variables, data ? (variables.caption ?? null) : undefined),
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
 * Remove do cache paralelo e chama o envio original — que entra na fila da
 * conversa como qualquer outro, atrás do que já estiver saindo.
 */
export function useRetryMessage() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;
  const sendMessage = useSendWhatsAppMessage();
  const sendMedia = useSendWhatsAppMedia();

  return async (failed: FailedMessage) => {
    if ((failed.retry_attempt ?? 0) >= MAX_SEND_RETRIES) return;
    // Mídia sem arquivo não tem o que reenviar — e cair no ramo de texto
    // mandaria só a legenda, como se fosse a mensagem inteira.
    const midia: string | MidiaAPreparar | null = failed.mediaUrl
      // Preparo NOVO (objeto novo, memo novo): o reenvio é uma tentativa nova.
      ?? (failed.preparo ? { previa: failed.preparo.previa, preparar: failed.preparo.preparar } : null);
    if (failed.mediaType && !midia) return;
    const key = ["whatsapp_failed_messages", organizationId, failed.phoneNumber, failed.instanceId];
    queryClient.setQueryData<FailedMessage[]>(key, (prev = []) => prev.filter((m) => m.id !== failed.id));

    if (failed.mediaType && midia) {
      await sendMedia.mutateAsync({
        _sendId: failed.id,
        replyContext: failed.replyContext,
        phoneNumber: failed.phoneNumber,
        isGroup: failed.isGroup,
        instanceName: failed.instanceName,
        instanceId: failed.instanceId,
        mediaType: failed.mediaType as "image" | "audio" | "document" | "video",
        media: midia,
        caption: failed.message ?? undefined,
      });
    } else if (failed.message) {
      await sendMessage.mutateAsync({
        _sendId: failed.id,
        replyContext: failed.replyContext,
        phoneNumber: failed.phoneNumber,
        isGroup: failed.isGroup,
        message: failed.message,
        instanceName: failed.instanceName,
        instanceId: failed.instanceId,
      });
    }
  };
}
