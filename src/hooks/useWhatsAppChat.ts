import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember, isVirtualTeamMember } from "@/hooks/useTeamMembers";
import { track } from "@/lib/analytics";

export interface WhatsAppMessage {
  id: string;
  organization_id: string;
  instance_id: string | null;
  message_id: string;
  remote_jid: string;
  phone_number: string;
  direction: "incoming" | "outgoing";
  message_type: string;
  content: string | null;
  media_url: string | null;
  push_name: string | null;
  status: string;
  lead_id: string | null;
  timestamp: string;
  created_at: string;
}

export interface ChatContactTag {
  id: string;
  name: string;
  color: string;
}

export interface ChatContact {
  phone_number: string;
  push_name: string | null;
  last_message: string | null;
  last_message_time: string;
  /** Direção da última mensagem: incoming = lead enviou, outgoing = você enviou */
  last_message_direction: "incoming" | "outgoing" | null;
  unread_count: number;
  lead_id: string | null;
  lead_name: string | null;
  /** ID do registro em whatsapp_conversations (null se nunca teve ação) */
  conversation_id: string | null;
  /** Se a conversa está arquivada */
  archived_at: string | null;
  /** Tags combinadas: lead_tags + conversation_tags (sem duplicatas) */
  tags: ChatContactTag[];
}

/** Instância de WhatsApp que o usuário pode acessar (para seletor de inbox) */
export interface WhatsAppInstanceForUser {
  id: string;
  instance_name: string;
  status: string;
}

/**
 * Lista instâncias conectadas às quais o usuário está vinculado (pode ver conversas).
 * Se a instância não tiver vendedores em whatsapp_instance_allowed_members, todos da org podem.
 * Caso contrário, só retorna instâncias em que o team_member do usuário está na lista.
 */
export function useWhatsAppInstancesForUser() {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;
  const teamMemberId = teamMember?.id;
  const isMasterVirtual = isVirtualTeamMember(teamMemberId);

  return useQuery({
    queryKey: ["whatsapp_instances_for_user", organizationId, teamMemberId],
    queryFn: async () => {
      if (!organizationId || !teamMemberId) return [];

      const { data: instances, error: instError } = await supabase
        .from("whatsapp_instances")
        .select("id, instance_name, status")
        .eq("organization_id", organizationId)
        .eq("status", "connected")
        .order("instance_name");

      if (instError) throw instError;
      if (!instances?.length) return [];

      // Master (shadow user) vê todas as instâncias sem restrição
      if (isMasterVirtual) {
        return instances as WhatsAppInstanceForUser[];
      }

      const { data: allowedRows } = await supabase
        .from("whatsapp_instance_allowed_members")
        .select("whatsapp_instance_id")
        .in("whatsapp_instance_id", instances.map((i) => i.id));

      const instanceIdsWithRestriction = new Set(
        (allowedRows ?? []).map((r) => r.whatsapp_instance_id)
      );
      const allowedMemberByInstance: Record<string, boolean> = {};
      if (allowedRows?.length) {
        const { data: memberRows } = await supabase
          .from("whatsapp_instance_allowed_members")
          .select("whatsapp_instance_id, team_member_id")
          .in("whatsapp_instance_id", instances.map((i) => i.id))
          .eq("team_member_id", teamMemberId);
        for (const row of memberRows ?? []) {
          allowedMemberByInstance[row.whatsapp_instance_id] = true;
        }
      }

      const result: WhatsAppInstanceForUser[] = [];
      for (const inst of instances) {
        const hasRestriction = instanceIdsWithRestriction.has(inst.id);
        if (!hasRestriction) {
          result.push(inst as WhatsAppInstanceForUser);
        } else if (allowedMemberByInstance[inst.id]) {
          result.push(inst as WhatsAppInstanceForUser);
        }
      }
      return result;
    },
    enabled: !!organizationId && !!teamMemberId,
  });
}

/**
 * Hook para listar contatos/conversas do WhatsApp de uma instância (inbox por número).
 * Se instanceId for null, não retorna conversas — usuário deve escolher um número primeiro.
 */
export function useWhatsAppContacts(instanceId: string | null) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["whatsapp_contacts", organizationId, instanceId],
    queryFn: async () => {
      if (!organizationId || !instanceId) return [];

      // Buscar mensagens agrupadas por contato desta instância
      const { data, error } = await supabase
        .from("whatsapp_messages")
        .select(`
          phone_number,
          push_name,
          content,
          timestamp,
          direction,
          lead_id,
          leads(name)
        `)
        .eq("organization_id", organizationId)
        .eq("instance_id", instanceId)
        .order("timestamp", { ascending: false });

      if (error) throw error;

      // Normalizar telefone: últimos 10 dígitos para coincidir com qualquer formato (com/sem 55)
      const normalizePhone = (p: string) => p.replace(/\D/g, "").slice(-10) || p;

      // Agrupar por telefone normalizado; priorizar nome do lead quando existir
      const contactsMap = new Map<string, ChatContact>();

      for (const msg of data || []) {
        const key = normalizePhone(msg.phone_number);
        const existing = contactsMap.get(key);
        const leadName = (msg.leads as { name?: string } | null)?.name ?? null;

        if (!existing) {
          contactsMap.set(key, {
            phone_number: msg.phone_number,
            push_name: msg.direction === "incoming" ? msg.push_name : null,
            last_message: msg.content,
            last_message_time: msg.timestamp,
            last_message_direction: msg.direction === "incoming" || msg.direction === "outgoing" ? msg.direction : null,
            unread_count: 0,
            lead_id: msg.lead_id,
            lead_name: leadName,
            conversation_id: null,
            archived_at: null,
            tags: [],
          });
        } else {
          // Manter a mensagem mais recente; preferir lead_id/lead_name quando existir
          if (new Date(msg.timestamp) > new Date(existing.last_message_time)) {
            existing.last_message = msg.content;
            existing.last_message_time = msg.timestamp;
            existing.last_message_direction = msg.direction === "incoming" || msg.direction === "outgoing" ? msg.direction : existing.last_message_direction;
          }
          if (msg.lead_id || leadName) {
            existing.lead_id = existing.lead_id || msg.lead_id;
            existing.lead_name = existing.lead_name || leadName;
          }
          if (msg.direction === "incoming" && msg.push_name) {
            existing.push_name = existing.push_name || msg.push_name;
          }
        }
      }

      // Buscar contagem de mensagens não lidas (incoming após último acesso)
      const LAST_SEEN_KEY = "whatsapp_last_seen_";
      const lastSeenMap: Record<string, string> = {};
      if (typeof localStorage !== "undefined") {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k?.startsWith(LAST_SEEN_KEY)) {
            const phone = k.slice(LAST_SEEN_KEY.length);
            lastSeenMap[phone] = localStorage.getItem(k) || "";
          }
        }
      }

      // Buscar incoming messages, metadados de conversas e tags em paralelo
      const [{ data: incomingData }, { data: convMeta }, { data: convTagsData }] = await Promise.all([
        supabase
          .from("whatsapp_messages")
          .select("phone_number, timestamp")
          .eq("organization_id", organizationId)
          .eq("instance_id", instanceId)
          .eq("direction", "incoming")
          .order("timestamp", { ascending: false }),
        supabase
          .from("whatsapp_conversations")
          .select("id, phone_number, archived_at, deleted_at")
          .eq("organization_id", organizationId)
          .eq("instance_id", instanceId),
        supabase
          .from("whatsapp_conversation_tags")
          .select(`
            conversation_id,
            tags!inner(id, name, color)
          `),
      ]);

      const unreadByPhone: Record<string, number> = {};
      for (const m of incomingData || []) {
        const key = normalizePhone(m.phone_number);
        const lastSeen = lastSeenMap[key] ? new Date(lastSeenMap[key]).getTime() : 0;
        if (new Date(m.timestamp).getTime() > lastSeen) {
          unreadByPhone[key] = (unreadByPhone[key] ?? 0) + 1;
        }
      }

      for (const contact of contactsMap.values()) {
        const key = normalizePhone(contact.phone_number);
        contact.unread_count = unreadByPhone[key] ?? 0;
      }

      // Mapear conversation tags por conversation_id
      const convTagsByConvId = new Map<string, ChatContactTag[]>();
      for (const row of convTagsData || []) {
        const tag = row.tags as unknown as ChatContactTag;
        const existing = convTagsByConvId.get(row.conversation_id) || [];
        existing.push(tag);
        convTagsByConvId.set(row.conversation_id, existing);
      }

      // Buscar lead_tags para leads associados
      const leadIds = Array.from(contactsMap.values())
        .map((c) => c.lead_id)
        .filter((id): id is string => !!id);

      const leadTagsMap = new Map<string, ChatContactTag[]>();
      if (leadIds.length > 0) {
        const { data: leadTagsData } = await supabase
          .from("lead_tags")
          .select("lead_id, tags!inner(id, name, color)")
          .in("lead_id", leadIds);

        for (const row of leadTagsData || []) {
          const tag = (row as unknown as { tags: ChatContactTag }).tags;
          const existing = leadTagsMap.get(row.lead_id) || [];
          existing.push(tag);
          leadTagsMap.set(row.lead_id, existing);
        }
      }

      // Enriquecer contatos com metadados de conversa e tags
      const convMetaMap = new Map<string, { id: string; archived_at: string | null; deleted_at: string | null }>();
      for (const row of convMeta || []) {
        convMetaMap.set(row.phone_number, row);
      }

      const results: ChatContact[] = [];
      for (const contact of contactsMap.values()) {
        const meta = convMetaMap.get(contact.phone_number);

        // Filtrar conversas excluídas
        if (meta?.deleted_at) continue;

        contact.conversation_id = meta?.id ?? null;
        contact.archived_at = meta?.archived_at ?? null;

        // Merge tags: lead_tags + conversation_tags (sem duplicatas por tag.id)
        const tagIds = new Set<string>();
        const mergedTags: ChatContactTag[] = [];

        // Lead tags primeiro
        if (contact.lead_id) {
          for (const tag of leadTagsMap.get(contact.lead_id) || []) {
            if (!tagIds.has(tag.id)) {
              tagIds.add(tag.id);
              mergedTags.push(tag);
            }
          }
        }

        // Conversation tags
        if (meta?.id) {
          for (const tag of convTagsByConvId.get(meta.id) || []) {
            if (!tagIds.has(tag.id)) {
              tagIds.add(tag.id);
              mergedTags.push(tag);
            }
          }
        }

        contact.tags = mergedTags;
        results.push(contact);
      }

      return results;
    },
    enabled: !!organizationId && !!instanceId,
    // Polling de fallback: atualiza lista (e badge da sidebar) a cada 20s quando a aba está em foco (realtime pode falhar em produção)
    refetchInterval: instanceId ? 20_000 : false,
    refetchIntervalInBackground: false,
  });
}

/**
 * Hook para buscar mensagens de um contato específico em uma instância (inbox).
 * Filtra por instanceId para mostrar só a conversa daquele número.
 */
export function useWhatsAppMessages(
  phoneNumber: string | null,
  instanceId: string | null
) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["whatsapp_messages", organizationId, phoneNumber, instanceId],
    queryFn: async () => {
      if (!organizationId || !phoneNumber || !instanceId) return [];

      const { data, error } = await supabase
        .from("whatsapp_messages")
        .select("id, organization_id, instance_id, message_id, remote_jid, phone_number, direction, message_type, content, media_url, push_name, status, lead_id, timestamp, created_at")
        .eq("organization_id", organizationId)
        .eq("instance_id", instanceId)
        .eq("phone_number", phoneNumber)
        .order("timestamp", { ascending: true });

      if (error) throw error;
      return data as WhatsAppMessage[];
    },
    enabled: !!organizationId && !!phoneNumber && !!instanceId,
    // Polling de fallback: atualiza mensagens do chat a cada 20s quando a aba está em foco
    refetchInterval: phoneNumber && instanceId ? 20_000 : false,
    refetchIntervalInBackground: false,
  });
}

/**
 * Verifica se o usuário pode responder neste número (instância).
 * Se a instância não tiver vendedores definidos, todos podem.
 */
async function assertCanReplyOnInstance(
  instanceName: string,
  organizationId: string,
  teamMemberId: string
): Promise<void> {
  // Master (shadow user) pode responder em qualquer instância
  if (isVirtualTeamMember(teamMemberId)) return;

  const { data: instance } = await supabase
    .from("whatsapp_instances")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("instance_name", instanceName)
    .maybeSingle();

  if (!instance?.id) return;

  const { data: allowed } = await supabase
    .from("whatsapp_instance_allowed_members")
    .select("team_member_id")
    .eq("whatsapp_instance_id", instance.id);

  if (allowed && allowed.length > 0) {
    const allowedIds = allowed.map((a) => a.team_member_id);
    if (!allowedIds.includes(teamMemberId)) {
      throw new Error(
        "Apenas os vendedores selecionados para este número podem responder no chat. Peça ao admin para incluir você na configuração da instância."
      );
    }
  }
}

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
    }: {
      phoneNumber: string;
      message: string;
      instanceName: string;
      instanceId?: string | null;
    }) => {
      if (!teamMember?.organization_id || !teamMember?.id) {
        throw new Error("Usuário não vinculado à equipe");
      }
      await assertCanReplyOnInstance(
        instanceName,
        teamMember.organization_id,
        teamMember.id
      );

      // Formatar número (remover caracteres especiais)
      const formattedNumber = phoneNumber.replace(/\D/g, "");

      // Chamar a Evolution API via proxy
      const { data, error } = await supabase.functions.invoke("evolution-api-proxy", {
        body: {
          endpoint: `/message/sendText/${instanceName}`,
          method: "POST",
          body: {
            number: formattedNumber,
            text: message,
          },
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Salvar mensagem no banco localmente (com instance_id para aparecer no inbox correto)
      const messageId = data?.key?.id || `local_${Date.now()}`;
      const timestamp = new Date().toISOString();
      const { error: insertError } = await supabase.from("whatsapp_messages").insert({
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
      });

      if (insertError && !insertError.message?.includes("duplicate")) {
        console.error("Error saving outgoing message:", insertError);
        // Não bloquear: o webhook send.message também salva como fallback
      }

      return { ...data, _localMessage: { phoneNumber, message, instanceId, messageId, timestamp } };
    },
    onMutate: async (variables) => {
      const orgId = teamMember?.organization_id;
      const phone = variables.phoneNumber;
      const instId = variables.instanceId;

      // Cancelar refetches pendentes para não sobrescrever o optimistic update
      await queryClient.cancelQueries({ queryKey: ["whatsapp_messages", orgId, phone, instId] });

      const previousMessages = queryClient.getQueryData<WhatsAppMessage[]>(
        ["whatsapp_messages", orgId, phone, instId]
      );

      // Optimistic update: adicionar mensagem imediatamente na UI
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
      };

      queryClient.setQueryData<WhatsAppMessage[]>(
        ["whatsapp_messages", orgId, phone, instId],
        (old) => [...(old || []), optimisticMsg]
      );

      return { previousMessages };
    },
    onError: (_err, variables, context) => {
      // Reverter optimistic update em caso de erro
      if (context?.previousMessages) {
        queryClient.setQueryData(
          ["whatsapp_messages", teamMember?.organization_id, variables.phoneNumber, variables.instanceId],
          context.previousMessages
        );
      }
    },
    onSuccess: () => {
      if (teamMember?.organization_id) track({ event: "message_sent", organizationId: teamMember.organization_id, entityType: "conversation" });
    },
    onSettled: (_, __, variables) => {
      // Sempre refetch após completar (sucesso ou erro) para sincronizar com o banco
      queryClient.invalidateQueries({
        queryKey: ["whatsapp_messages", teamMember?.organization_id, variables.phoneNumber, variables.instanceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["whatsapp_contacts"],
      });
    },
  });
}

/**
 * Hook para enviar mídia (imagem, áudio) via WhatsApp
 * 
 * Fluxo:
 * 1. Se for base64, faz upload para Supabase Storage
 * 2. Obtém URL pública
 * 3. Envia URL para Evolution API (evita limite de payload)
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
    }: {
      phoneNumber: string;
      instanceName: string;
      instanceId?: string | null;
      mediaType: "image" | "audio" | "document" | "video";
      media: string; // base64 ou URL
      caption?: string;
      fileName?: string;
      mimetype?: string;
    }) => {
      if (!teamMember?.organization_id || !teamMember?.id) {
        throw new Error("Usuário não vinculado à equipe");
      }
      await assertCanReplyOnInstance(
        instanceName,
        teamMember.organization_id,
        teamMember.id
      );

      const formattedNumber = phoneNumber.replace(/\D/g, "");
      let mediaUrl = media;

      // Se for base64, fazer upload para Storage primeiro
      if (media.startsWith("data:")) {
        console.log("[WhatsApp Media] Base64 detected, uploading to Storage...");
        try {
          mediaUrl = await uploadMediaToStorage(
            media,
            mediaType,
            teamMember?.organization_id || "default",
            fileName
          );
          console.log("[WhatsApp Media] Upload complete. URL:", mediaUrl);
        } catch (uploadError: any) {
          console.error("[WhatsApp Media] Storage upload failed:", uploadError);
          throw new Error(`Erro no upload: ${uploadError.message}`);
        }
      }

      let endpoint: string;
      let body: Record<string, unknown>;

      if (mediaType === "audio") {
        // Endpoint para áudio PTT (push-to-talk)
        endpoint = `/message/sendWhatsAppAudio/${instanceName}`;
        body = {
          number: formattedNumber,
          audio: mediaUrl,
        };
      } else {
        // Endpoint para imagem, documento, vídeo
        endpoint = `/message/sendMedia/${instanceName}`;
        body = {
          number: formattedNumber,
          mediatype: mediaType,
          mimetype: mimetype || getMimeType(mediaType),
          caption: caption || "",
          media: mediaUrl,
          fileName: fileName || `file_${Date.now()}`,
        };
      }

      const requestPayload = {
        endpoint,
        method: "POST",
        body,
      };

      console.log("[WhatsApp Media] ====== REQUEST DETAILS ======");
      console.log("[WhatsApp Media] Endpoint:", endpoint);
      console.log("[WhatsApp Media] To:", formattedNumber);
      console.log("[WhatsApp Media] Media URL:", mediaUrl);
      console.log("[WhatsApp Media] Full Body:", JSON.stringify(body, null, 2));
      console.log("[WhatsApp Media] Request Payload:", JSON.stringify(requestPayload, null, 2));
      console.log("[WhatsApp Media] ==============================");

      const { data, error } = await supabase.functions.invoke("evolution-api-proxy", {
        body: requestPayload,
      });

      console.log("[WhatsApp Media] ====== RESPONSE ======");
      console.log("[WhatsApp Media] Data:", data);
      console.log("[WhatsApp Media] Error:", error);
      console.log("[WhatsApp Media] ========================");

      if (error) {
        console.error("[WhatsApp Media] Edge Function Error:", error);
        // Tentar extrair mais detalhes do erro
        const errorContext = error.context || {};
        console.error("[WhatsApp Media] Error Context:", errorContext);
        throw new Error(error.message || "Erro ao enviar mídia");
      }
      if (data?.error) {
        console.error("[WhatsApp Media] API Error:", data);
        // Mostrar detalhes do erro da Evolution API
        const details = data.details ? JSON.stringify(data.details) : "";
        throw new Error(`${data.error}${details ? ` - ${details}` : ""}`);
      }

      console.log("[WhatsApp Media] Success:", data);

      // Salvar mensagem no banco (com instance_id para aparecer no inbox correto)
      const { error: insertError } = await supabase.from("whatsapp_messages").insert({
        organization_id: teamMember.organization_id,
        instance_id: instanceId || null,
        message_id: data?.key?.id || `local_${Date.now()}`,
        remote_jid: `${formattedNumber}@s.whatsapp.net`,
        phone_number: phoneNumber,
        direction: "outgoing",
        message_type: mediaType,
        content: caption || null,
        media_url: mediaUrl,
        status: "sent",
        timestamp: new Date().toISOString(),
      });

      if (insertError && !insertError.message?.includes("duplicate")) {
        console.error("Error saving outgoing media message:", insertError);
        // Não bloquear: o webhook send.message também salva como fallback
      }

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

      // Optimistic update: adicionar mídia imediatamente na UI
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
      };

      queryClient.setQueryData<WhatsAppMessage[]>(
        ["whatsapp_messages", orgId, phone, instId],
        (old) => [...(old || []), optimisticMsg]
      );

      return { previousMessages };
    },
    onError: (_err, variables, context) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(
          ["whatsapp_messages", teamMember?.organization_id, variables.phoneNumber, variables.instanceId],
          context.previousMessages
        );
      }
    },
    onSettled: (_, __, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["whatsapp_messages", teamMember?.organization_id, variables.phoneNumber, variables.instanceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["whatsapp_contacts"],
      });
    },
  });
}

/**
 * Sanitiza nome de arquivo para ser compatível com Storage
 */
function sanitizeFileName(fileName: string): string {
  return fileName
    .normalize("NFD") // Normaliza caracteres acentuados
    .replace(/[\u0300-\u036f]/g, "") // Remove acentos
    .replace(/[^a-zA-Z0-9._-]/g, "_") // Substitui caracteres especiais por _
    .replace(/_+/g, "_") // Remove underscores duplicados
    .toLowerCase();
}

/**
 * Normaliza o mimetype removendo parâmetros extras (como codecs)
 * Ex: "audio/webm;codecs=opus" -> "audio/webm"
 */
function normalizeMimeType(mimeType: string): string {
  // Remove parâmetros após o ;
  const baseMime = mimeType.split(";")[0].trim();
  
  // Mapeia tipos conhecidos para garantir compatibilidade
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

/**
 * Faz upload de mídia para Supabase Storage e retorna URL pública
 */
async function uploadMediaToStorage(
  base64Data: string,
  mediaType: string,
  organizationId: string,
  fileName?: string
): Promise<string> {
  // Extrair dados do base64
  // Formato: data:audio/webm;codecs=opus;base64,XXXX ou data:image/png;base64,XXXX
  const matches = base64Data.match(/^data:([^;,]+)[^,]*;base64,(.+)$/);
  if (!matches) {
    console.error("[Storage Upload] Invalid base64 format:", base64Data.substring(0, 100));
    throw new Error("Formato de arquivo inválido");
  }

  const rawMimeType = matches[1];
  const mimeType = normalizeMimeType(rawMimeType);
  const base64 = matches[2];
  
  console.log("[Storage Upload] MimeType:", { raw: rawMimeType, normalized: mimeType });
  
  // Converter base64 para Blob
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mimeType });

  // Gerar nome único do arquivo (sanitizado); .mp3 para áudio universal
  const extMap: Record<string, string> = { mpeg: "mp3", mp3: "mp3" };
  const rawExt = mimeType.split("/")[1]?.split(";")[0] || "bin";
  const extension = extMap[rawExt] || rawExt;
  const timestamp = Date.now();
  const baseName = fileName ? sanitizeFileName(fileName) : `${mediaType}_${timestamp}`;
  const uniqueFileName = `${baseName}_${timestamp}.${extension}`;
  const filePath = `whatsapp-media/${organizationId}/${uniqueFileName}`;

  console.log("[Storage Upload] Uploading:", {
    filePath,
    mimeType,
    size: blob.size,
  });

  // Fazer upload
  const { data, error } = await supabase.storage
    .from("media")
    .upload(filePath, blob, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) {
    console.error("[Storage Upload] Error:", error);
    throw new Error(`Erro ao fazer upload: ${error.message}`);
  }

  // Obter URL pública
  const { data: urlData } = supabase.storage
    .from("media")
    .getPublicUrl(filePath);

  if (!urlData?.publicUrl) {
    throw new Error("Erro ao obter URL pública do arquivo");
  }

  console.log("[Storage Upload] Success:", urlData.publicUrl);
  return urlData.publicUrl;
}

// Helper para obter mimetype padrão
function getMimeType(mediaType: string): string {
  switch (mediaType) {
    case "image":
      return "image/png";
    case "video":
      return "video/mp4";
    case "audio":
      return "audio/ogg";
    case "document":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

/**
 * Hook para subscrição em tempo real de mensagens
 */
export function useWhatsAppMessagesRealtime(phoneNumber: string | null) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!organizationId) {
      console.log("[WhatsApp Realtime] No organization ID, skipping subscription");
      return;
    }

    console.log("[WhatsApp Realtime] Setting up subscription for org:", organizationId);

    // Nome único do canal baseado na org e telefone
    const channelName = `whatsapp-messages-${organizationId}${phoneNumber ? `-${phoneNumber}` : ""}`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*", // Escutar INSERT, UPDATE e DELETE
          schema: "public",
          table: "whatsapp_messages",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          console.log("[WhatsApp Realtime] Event received:", payload.eventType, payload);

          const message = (payload.new || payload.old) as WhatsAppMessage | undefined;
          const messagePhone = message?.phone_number;
          const normalizePhone = (p: string) => p.replace(/\D/g, "").slice(-10) || p;

          // Forçar refetch imediato da lista de contatos (sidebar e inbox) para notificação e última mensagem
          queryClient.refetchQueries({ queryKey: ["whatsapp_contacts", organizationId] });

          // Atualizar mensagens do chat aberto se o evento for do contato selecionado (comparar telefone normalizado)
          if (phoneNumber && messagePhone) {
            if (normalizePhone(messagePhone) === normalizePhone(phoneNumber)) {
              queryClient.refetchQueries({
                queryKey: ["whatsapp_messages", organizationId, phoneNumber],
              });
            }
          } else {
            queryClient.invalidateQueries({ queryKey: ["whatsapp_messages", organizationId] });
          }
        }
      )
      .subscribe((status) => {
        console.log("[WhatsApp Realtime] Subscription status:", status);
      });

    return () => {
      console.log("[WhatsApp Realtime] Cleaning up subscription");
      supabase.removeChannel(channel);
    };
  }, [organizationId, phoneNumber, queryClient]);
}

/**
 * Hook para buscar instância ativa do WhatsApp
 */
export function useActiveWhatsAppInstance() {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["whatsapp_active_instance", organizationId],
    queryFn: async () => {
      if (!organizationId) return null;

      const { data, error } = await supabase
        .from("whatsapp_instances")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("status", "connected")
        .single();

      if (error) {
        if (error.code === "PGRST116") return null; // Nenhum resultado
        throw error;
      }

      return data;
    },
    enabled: !!organizationId,
  });
}
