import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";

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
}

/**
 * Hook para listar contatos/conversas do WhatsApp
 */
export function useWhatsAppContacts() {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["whatsapp_contacts", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      // Buscar mensagens agrupadas por contato
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
            push_name: msg.push_name,
            last_message: msg.content,
            last_message_time: msg.timestamp,
            last_message_direction: msg.direction === "incoming" || msg.direction === "outgoing" ? msg.direction : null,
            unread_count: 0,
            lead_id: msg.lead_id,
            lead_name: leadName,
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
          existing.push_name = existing.push_name || msg.push_name;
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

      const { data: incomingData } = await supabase
        .from("whatsapp_messages")
        .select("phone_number, timestamp")
        .eq("organization_id", organizationId)
        .eq("direction", "incoming")
        .order("timestamp", { ascending: false });

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

      return Array.from(contactsMap.values());
    },
    enabled: !!organizationId,
  });
}

/**
 * Hook para buscar mensagens de um contato específico
 */
export function useWhatsAppMessages(phoneNumber: string | null) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["whatsapp_messages", organizationId, phoneNumber],
    queryFn: async () => {
      if (!organizationId || !phoneNumber) return [];

      const { data, error } = await supabase
        .from("whatsapp_messages")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("phone_number", phoneNumber)
        .order("timestamp", { ascending: true });

      if (error) throw error;
      return data as WhatsAppMessage[];
    },
    enabled: !!organizationId && !!phoneNumber,
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
    }: {
      phoneNumber: string;
      message: string;
      instanceName: string;
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

      // Salvar mensagem no banco localmente
      const { error: insertError } = await supabase.from("whatsapp_messages").insert({
        organization_id: teamMember?.organization_id,
        message_id: data?.key?.id || `local_${Date.now()}`,
        remote_jid: `${formattedNumber}@s.whatsapp.net`,
        phone_number: formattedNumber,
        direction: "outgoing",
        message_type: "text",
        content: message,
        status: "sent",
        timestamp: new Date().toISOString(),
      });

      if (insertError && !insertError.message?.includes("duplicate")) {
        console.error("Error saving outgoing message:", insertError);
      }

      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["whatsapp_messages", teamMember?.organization_id, variables.phoneNumber.replace(/\D/g, "")],
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
      mediaType,
      media,
      caption,
      fileName,
      mimetype,
    }: {
      phoneNumber: string;
      instanceName: string;
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

      // Salvar mensagem no banco
      const { error: insertError } = await supabase.from("whatsapp_messages").insert({
        organization_id: teamMember?.organization_id,
        message_id: data?.key?.id || `local_${Date.now()}`,
        remote_jid: `${formattedNumber}@s.whatsapp.net`,
        phone_number: formattedNumber,
        direction: "outgoing",
        message_type: mediaType,
        content: caption || null,
        media_url: mediaUrl,
        status: "sent",
        timestamp: new Date().toISOString(),
      });

      if (insertError && !insertError.message?.includes("duplicate")) {
        console.error("Error saving outgoing media message:", insertError);
      }

      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["whatsapp_messages", teamMember?.organization_id, variables.phoneNumber.replace(/\D/g, "")],
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

  // Gerar nome único do arquivo (sanitizado)
  const extension = mimeType.split("/")[1]?.split(";")[0] || "bin";
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

          // Invalidar queries para atualizar a UI
          queryClient.invalidateQueries({ queryKey: ["whatsapp_contacts", organizationId] });

          // Se temos um telefone selecionado, atualizar mensagens desse contato
          if (phoneNumber) {
            const message = (payload.new || payload.old) as WhatsAppMessage;
            if (message?.phone_number === phoneNumber) {
              console.log("[WhatsApp Realtime] Updating messages for phone:", phoneNumber);
              queryClient.invalidateQueries({
                queryKey: ["whatsapp_messages", organizationId, phoneNumber],
              });
            }
          } else {
            // Se não tem telefone selecionado, atualizar todas as mensagens
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
