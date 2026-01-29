import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { getOrCreateLead, associateMessagesToLead } from "../_shared/lead-service.ts";

/**
 * Evolution API Webhook Receiver
 *
 * Recebe eventos da Evolution API:
 * - CONNECTION_UPDATE: Status de conexão mudou
 * - QRCODE_UPDATED: Novo QR code gerado
 * - MESSAGES_UPSERT: Novas mensagens recebidas
 * - MESSAGES_UPDATE: Status de mensagem atualizado (enviado/entregue/lido)
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL") || "";
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") || "";
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";
const OPENROUTER_VISION_MODEL = Deno.env.get("OPENROUTER_VISION_MODEL") || "google/gemini-pro-vision";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";

const MAX_MEDIA_TEXT_CHARS = 1000;
const MAX_RESPONSE_DELAY_SECONDS = 10;
const DEFAULT_BATCH_WAIT_SECONDS = 8;
const MAX_MESSAGE_LENGTH = 350; // Máximo de caracteres por mensagem
const DELAY_BETWEEN_MESSAGES_MS = 1500; // Delay entre mensagens (1.5s)

interface EvolutionWebhookPayload {
  event: string;
  instance: string;
  data: Record<string, unknown>;
  destination?: string;
  date_time?: string;
  sender?: string;
  server_url?: string;
  apikey?: string;
}

interface MessageData {
  key: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
  };
  pushName?: string;
  message?: {
    conversation?: string;
    extendedTextMessage?: {
      text: string;
    };
    imageMessage?: {
      caption?: string;
      url?: string;
      mimetype?: string;
    };
    audioMessage?: {
      url?: string;
      mimetype?: string;
      seconds?: number;
      ptt?: boolean;
    };
    videoMessage?: {
      caption?: string;
      url?: string;
      mimetype?: string;
    };
    documentMessage?: {
      fileName?: string;
      url?: string;
      mimetype?: string;
    };
    stickerMessage?: {
      url?: string;
    };
  };
  messageType?: string;
  messageTimestamp?: number;
}

function isWithinSchedule(availability: Record<string, unknown> | null | undefined): boolean {
  if (!availability || typeof availability !== "object") return true;
  const mode = availability.mode as string | undefined;
  if (!mode || mode === "always") return true;

  const timezone = (availability.timezone as string) || "America/Sao_Paulo";
  const days = Array.isArray(availability.days) ? availability.days as string[] : [];
  const start = (availability.start as string) || "00:00";
  const end = (availability.end as string) || "23:59";

  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const weekday = parts.find((p) => p.type === "weekday")?.value?.toLowerCase();
    const hour = parts.find((p) => p.type === "hour")?.value || "00";
    const minute = parts.find((p) => p.type === "minute")?.value || "00";
    const current = `${hour}:${minute}`;

    const dayMap: Record<string, string> = {
      mon: "mon",
      tue: "tue",
      wed: "wed",
      thu: "thu",
      fri: "fri",
      sat: "sat",
      sun: "sun",
    };

    const currentDay = weekday ? dayMap[weekday.slice(0, 3)] : undefined;
    if (days.length > 0 && currentDay && !days.includes(currentDay)) {
      return false;
    }

    return current >= start && current <= end;
  } catch (error) {
    console.warn("[Evolution Webhook] Schedule check failed, defaulting to allowed:", error);
    return true;
  }
}

async function applyResponseDelay(seconds: number | null | undefined): Promise<void> {
  if (!seconds || seconds <= 0) return;
  const delay = Math.min(seconds, MAX_RESPONSE_DELAY_SECONDS) * 1000;
  await new Promise((resolve) => setTimeout(resolve, delay));
}

async function describeImageWithOpenRouter(mediaUrl: string): Promise<string | null> {
  if (!OPENROUTER_API_KEY) {
    console.warn("[Evolution Webhook] Missing OPENROUTER_API_KEY for image description");
    return null;
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": Deno.env.get("OPENROUTER_REFERER_URL") || "https://v8millennials.com",
        "X-Title": "V8 Millennials CRM Agent",
      },
      body: JSON.stringify({
        model: OPENROUTER_VISION_MODEL,
        messages: [
          {
            role: "system",
            content: "Você recebe uma imagem enviada por um lead no WhatsApp. Descreva em 1-3 frases curtas o que aparece e qualquer texto relevante.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Descreva esta imagem de forma objetiva para uso em atendimento." },
              { type: "image_url", image_url: { url: mediaUrl } },
            ],
          },
        ],
        max_tokens: 200,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Evolution Webhook] Image description failed:", response.status, errorText);
      return null;
    }

    const result = await response.json();
    const content = result?.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim()) {
      return content.trim().slice(0, MAX_MEDIA_TEXT_CHARS);
    }
    return null;
  } catch (error) {
    console.error("[Evolution Webhook] Error describing image:", error);
    return null;
  }
}

async function transcribeAudioWithOpenAI(mediaUrl: string): Promise<string | null> {
  if (!OPENAI_API_KEY) {
    console.warn("[Evolution Webhook] Missing OPENAI_API_KEY for audio transcription");
    return null;
  }

  try {
    const mediaResponse = await fetch(mediaUrl);
    if (!mediaResponse.ok) {
      console.error("[Evolution Webhook] Failed to download audio:", mediaResponse.status);
      return null;
    }

    const audioBlob = await mediaResponse.blob();
    const contentType = audioBlob.type || "audio/ogg";
    const file = new File([audioBlob], "audio", { type: contentType });
    const formData = new FormData();
    formData.append("file", file);
    formData.append("model", "whisper-1");
    formData.append("language", "pt");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Evolution Webhook] Audio transcription failed:", response.status, errorText);
      return null;
    }

    const result = await response.json();
    if (result?.text) {
      return String(result.text).trim().slice(0, MAX_MEDIA_TEXT_CHARS);
    }
    return null;
  } catch (error) {
    console.error("[Evolution Webhook] Error transcribing audio:", error);
    return null;
  }
}

/**
 * Divide uma mensagem longa em chunks menores para envio no WhatsApp
 * Prioriza quebra por parágrafos, depois por frases, depois por tamanho
 */
function splitMessageIntoChunks(message: string, maxLength: number = MAX_MESSAGE_LENGTH): string[] {
  // Se a mensagem é curta, retorna como está
  if (message.length <= maxLength) {
    return [message.trim()];
  }

  const chunks: string[] = [];
  
  // Primeiro, dividir por parágrafos (linhas duplas)
  const paragraphs = message.split(/\n\n+/).filter(p => p.trim());
  
  let currentChunk = "";
  
  for (const paragraph of paragraphs) {
    // Se o parágrafo cabe no chunk atual
    if (currentChunk.length + paragraph.length + 2 <= maxLength) {
      currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
    } 
    // Se o parágrafo é muito grande, precisa dividir por frases
    else if (paragraph.length > maxLength) {
      // Salvar chunk atual se tiver algo
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = "";
      }
      
      // Dividir parágrafo por frases (. ? !)
      const sentences = paragraph.split(/(?<=[.!?])\s+/).filter(s => s.trim());
      
      for (const sentence of sentences) {
        if (currentChunk.length + sentence.length + 1 <= maxLength) {
          currentChunk += (currentChunk ? " " : "") + sentence;
        } else {
          // Salvar chunk atual
          if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
          }
          
          // Se a frase é maior que maxLength, dividir por palavras
          if (sentence.length > maxLength) {
            const words = sentence.split(/\s+/);
            currentChunk = "";
            for (const word of words) {
              if (currentChunk.length + word.length + 1 <= maxLength) {
                currentChunk += (currentChunk ? " " : "") + word;
              } else {
                if (currentChunk.trim()) chunks.push(currentChunk.trim());
                currentChunk = word;
              }
            }
          } else {
            currentChunk = sentence;
          }
        }
      }
    }
    // Parágrafo cabe sozinho, mas não com o atual
    else {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = paragraph;
    }
  }
  
  // Adicionar último chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks.filter(c => c.trim());
}

/**
 * Envia uma única mensagem via Evolution API
 */
async function sendSingleWhatsAppMessage(
  instanceName: string,
  phoneNumber: string,
  message: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `${EVOLUTION_API_URL}/message/sendText/${instanceName}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": EVOLUTION_API_KEY,
        },
        body: JSON.stringify({
          number: phoneNumber,
          text: message,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Evolution Webhook] Failed to send message:", response.status, errorText);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[Evolution Webhook] Error sending message:", error);
    return false;
  }
}

/**
 * Envia resposta do WhatsApp, dividindo em múltiplas mensagens se necessário
 */
async function sendWhatsAppResponse(
  instanceName: string,
  phoneNumber: string,
  message: string
): Promise<boolean> {
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    console.error("[Evolution Webhook] Missing EVOLUTION_API_URL or EVOLUTION_API_KEY for sending response");
    return false;
  }

  // Dividir mensagem em chunks
  const chunks = splitMessageIntoChunks(message);
  
  console.log("[Evolution Webhook] Sending response in", chunks.length, "message(s) to:", phoneNumber);

  let allSent = true;
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    
    // Delay entre mensagens (exceto a primeira)
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_MESSAGES_MS));
    }
    
    const sent = await sendSingleWhatsAppMessage(instanceName, phoneNumber, chunk);
    if (!sent) {
      allSent = false;
      console.error("[Evolution Webhook] Failed to send chunk", i + 1, "of", chunks.length);
    } else {
      console.log("[Evolution Webhook] Sent chunk", i + 1, "of", chunks.length, "- length:", chunk.length);
    }
  }

  console.log("[Evolution Webhook] WhatsApp response sent successfully to:", phoneNumber);
  return allSent;
}

/**
 * Chama o agent-message para processar mensagem com IA
 */
async function triggerAgentMessage(
  organizationId: string,
  phoneNumber: string,
  messageText: string,
  pushName?: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    console.log("[Evolution Webhook] Triggering agent-message for:", {
      organizationId,
      phoneNumber,
      pushName,
      messagePreview: messageText.substring(0, 50),
    });

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/agent-message`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          from: phoneNumber,
          message: messageText,
          channel: "whatsapp",
          organization_id: organizationId,
          push_name: pushName,
        }),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error("[Evolution Webhook] Agent-message error:", result);
      return { success: false, error: result.error || "Agent processing failed" };
    }

    console.log("[Evolution Webhook] Agent-message response:", {
      hasMessage: !!result.message,
      state: result.state,
      action: result.action,
    });

    return { success: true, message: result.message };
  } catch (error) {
    console.error("[Evolution Webhook] Error calling agent-message:", error);
    return { success: false, error: String(error) };
  }
}

// Import authentication helpers
import { 
  validateEvolutionWebhook, 
  checkRateLimit, 
  getClientIdentifier,
  unauthorizedResponse,
  rateLimitedResponse 
} from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Apenas POST é permitido
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // SECURITY: Validate webhook authentication
  const authResult = validateEvolutionWebhook(req);
  if (!authResult.valid) {
    console.warn("[Evolution Webhook] Authentication failed:", authResult.error);
    return unauthorizedResponse(authResult.error || "Unauthorized", corsHeaders);
  }

  // SECURITY: Rate limiting
  const clientId = getClientIdentifier(req);
  const rateLimit = checkRateLimit(`evolution:${clientId}`, 200, 60000); // 200 requests per minute
  if (!rateLimit.allowed) {
    console.warn("[Evolution Webhook] Rate limit exceeded for:", clientId);
    return rateLimitedResponse(rateLimit.resetIn, corsHeaders);
  }

  try {
    const payload: EvolutionWebhookPayload = await req.json();

    // SECURITY: Don't log sensitive data in production
    console.log("[Evolution Webhook] Received event:", {
      event: payload.event,
      instance: payload.instance,
      timestamp: payload.date_time,
      // Don't log payload.data which may contain messages
    });

    // Criar cliente Supabase com service role
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Buscar instância pelo nome COM o agente vinculado
    const { data: whatsappInstance, error: instanceError } = await supabase
      .from("whatsapp_instances")
      .select(`
        id, 
        organization_id, 
        instance_name,
        copilot_agent_id,
        copilot_agents:copilot_agent_id (
          id,
          name,
          is_active,
          is_default,
          availability,
          response_delay_seconds
        )
      `)
      .eq("instance_name", payload.instance)
      .single();

    if (instanceError || !whatsappInstance) {
      console.log("[Evolution Webhook] Instance not found:", payload.instance);
      // Retornar 200 mesmo assim para não bloquear a Evolution API
      return new Response(
        JSON.stringify({ success: true, message: "Instance not registered in system" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verificar se tem agente vinculado e ativo
    const hasLinkedAgent = whatsappInstance.copilot_agent_id && 
      whatsappInstance.copilot_agents?.is_active;
    
    console.log("[Evolution Webhook] Instance agent status:", {
      instanceName: whatsappInstance.instance_name,
      hasLinkedAgent,
      agentId: whatsappInstance.copilot_agent_id,
      agentName: whatsappInstance.copilot_agents?.name,
      agentActive: whatsappInstance.copilot_agents?.is_active,
    });

    // Processar evento baseado no tipo
    switch (payload.event) {
      case "connection.update":
        await handleConnectionUpdate(supabase, whatsappInstance, payload.data);
        break;

      case "qrcode.updated":
        await handleQrcodeUpdated(supabase, whatsappInstance, payload.data);
        break;

      case "messages.upsert":
        await handleMessagesUpsert(supabase, whatsappInstance, payload.data);
        break;

      case "messages.update":
        await handleMessagesUpdate(supabase, whatsappInstance, payload.data);
        break;

      case "send.message":
        // Mensagem enviada por nós - apenas log
        console.log("[Evolution Webhook] Message sent:", payload.data);
        break;

      default:
        console.log("[Evolution Webhook] Unhandled event:", payload.event);
    }

    return new Response(
      JSON.stringify({ success: true, event: payload.event }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Evolution Webhook] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Processa atualização de conexão
 */
async function handleConnectionUpdate(
  supabase: ReturnType<typeof createClient>,
  instance: { id: string; organization_id: string; instance_name: string },
  data: Record<string, unknown>
) {
  console.log("[Evolution Webhook] Connection update:", data);

  const state = data.state as string;
  const statusOpen = data.statusReason === 200;

  let status: string;
  let phoneNumber: string | null = null;

  if (state === "open" || statusOpen) {
    status = "connected";
    // Tentar extrair número do telefone
    if (data.ownerJid) {
      phoneNumber = extractPhoneNumber(data.ownerJid as string);
    }
  } else if (state === "connecting") {
    status = "connecting";
  } else {
    status = "disconnected";
  }

  const updateData: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (status === "connected") {
    updateData.last_connection_at = new Date().toISOString();
    updateData.qr_code = null; // Limpar QR code após conexão
    updateData.qr_code_expires_at = null;
    if (phoneNumber) {
      updateData.phone_number = phoneNumber;
    }
  }

  const { error } = await supabase
    .from("whatsapp_instances")
    .update(updateData)
    .eq("id", instance.id);

  if (error) {
    console.error("[Evolution Webhook] Error updating connection status:", error);
  } else {
    console.log("[Evolution Webhook] Connection status updated:", status);
  }
}

/**
 * Processa atualização de QR code
 */
async function handleQrcodeUpdated(
  supabase: ReturnType<typeof createClient>,
  instance: { id: string; organization_id: string; instance_name: string },
  data: Record<string, unknown>
) {
  console.log("[Evolution Webhook] QR code updated");

  const qrcode = data.qrcode as { base64?: string; code?: string } | undefined;

  if (!qrcode?.base64) {
    console.log("[Evolution Webhook] No QR code base64 in payload");
    return;
  }

  const { error } = await supabase
    .from("whatsapp_instances")
    .update({
      qr_code: qrcode.base64,
      qr_code_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      status: "connecting",
      updated_at: new Date().toISOString(),
    })
    .eq("id", instance.id);

  if (error) {
    console.error("[Evolution Webhook] Error updating QR code:", error);
  } else {
    console.log("[Evolution Webhook] QR code saved successfully");
  }
}

/**
 * Processa novas mensagens recebidas
 */
async function handleMessagesUpsert(
  supabase: ReturnType<typeof createClient>,
  instance: { 
    id: string; 
    organization_id: string; 
    instance_name: string;
    copilot_agent_id?: string | null;
    copilot_agents?: { id: string; name: string; is_active: boolean; is_default: boolean } | null;
  },
  data: Record<string, unknown>
) {
  const messages = (data.messages || data) as MessageData[] | MessageData;
  const messageArray = Array.isArray(messages) ? messages : [messages];

  console.log("[Evolution Webhook] Processing", messageArray.length, "messages");

  for (const msg of messageArray) {
    try {
      // Ignorar mensagens de status/broadcast
      if (!msg.key?.remoteJid || msg.key.remoteJid.includes("@broadcast") || msg.key.remoteJid.includes("@g.us")) {
        continue;
      }

      const phoneNumber = extractPhoneNumber(msg.key.remoteJid);
      let messageText = extractMessageText(msg);
      const direction = msg.key.fromMe ? "outgoing" : "incoming";

      // Determinar tipo de mensagem e extrair URL de mídia
      let messageType = "text";
      let mediaUrl: string | null = null;
      let mediaMimeType: string | null = null;

      if (msg.message?.imageMessage) {
        messageType = "image";
        mediaUrl = msg.message.imageMessage.url || null;
        mediaMimeType = msg.message.imageMessage.mimetype || "image/jpeg";
      } else if (msg.message?.audioMessage) {
        messageType = msg.message.audioMessage.ptt ? "ptt" : "audio";
        mediaUrl = msg.message.audioMessage.url || null;
        mediaMimeType = msg.message.audioMessage.mimetype || "audio/ogg";
      } else if (msg.message?.videoMessage) {
        messageType = "video";
        mediaUrl = msg.message.videoMessage.url || null;
        mediaMimeType = msg.message.videoMessage.mimetype || "video/mp4";
      } else if (msg.message?.documentMessage) {
        messageType = "document";
        mediaUrl = msg.message.documentMessage.url || null;
        mediaMimeType = msg.message.documentMessage.mimetype || "application/octet-stream";
      } else if (msg.message?.stickerMessage) {
        messageType = "sticker";
        mediaUrl = msg.message.stickerMessage.url || null;
        mediaMimeType = "image/webp";
      }

      console.log("[Evolution Webhook] Message details:", {
        type: messageType,
        hasMedia: messageType !== "text",
        mimetype: mediaMimeType,
        phone: phoneNumber,
        direction,
        messageId: msg.key.id,
      });

      // Se tiver mídia, tentar fazer download via getBase64 e salvar no Storage
      if (messageType !== "text" && direction === "incoming") {
        try {
          const savedUrl = await downloadAndSaveMedia(
            supabase,
            instance.instance_name,
            msg.key.id,
            messageType,
            mediaMimeType,
            instance.organization_id
          );
          if (savedUrl) {
            mediaUrl = savedUrl;
            console.log("[Evolution Webhook] Media saved to storage:", savedUrl);
          }
        } catch (mediaError) {
          console.error("[Evolution Webhook] Error saving media:", mediaError);
          // Continua sem URL se falhar
        }
      }

      // Se não houver texto e for mídia, tentar interpretar para IA
      if (!messageText && direction === "incoming" && mediaUrl) {
        // @ts-ignore - copilot_agents vem do join
        const hasAgent = instance.copilot_agent_id && instance.copilot_agents?.is_active;
        if (hasAgent) {
          if (messageType === "image") {
            const description = await describeImageWithOpenRouter(mediaUrl);
            if (description) {
              messageText = `[Imagem] ${description}`;
            }
          } else if (messageType === "audio" || messageType === "ptt") {
            const transcript = await transcribeAudioWithOpenAI(mediaUrl);
            if (transcript) {
              messageText = `[Áudio transcrito] ${transcript}`;
            }
          }
        }
      }

      // Inserir mensagem no banco
      const { error: msgError } = await supabase.from("whatsapp_messages").insert({
        organization_id: instance.organization_id,
        instance_id: instance.id,
        message_id: msg.key.id,
        remote_jid: msg.key.remoteJid,
        phone_number: phoneNumber,
        direction,
        message_type: messageType,
        content: messageText,
        media_url: mediaUrl,
        push_name: msg.pushName,
        status: direction === "incoming" ? "received" : "sent",
        timestamp: msg.messageTimestamp
          ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
          : new Date().toISOString(),
        raw_payload: msg as unknown as Record<string, unknown>,
      });

      if (msgError) {
        // Pode ser duplicado, ignorar
        if (!msgError.message?.includes("duplicate")) {
          console.error("[Evolution Webhook] Error saving message:", msgError);
        }
      } else {
        console.log("[Evolution Webhook] Message saved:", {
          direction,
          phone: phoneNumber,
          type: messageType,
        });
      }

      // Se for mensagem recebida, processar com IA (se tiver agente vinculado)
      if (direction === "incoming" && messageText) {
        // Primeiro associar a um lead
        await associateMessageToLeadCentralized(supabase, instance.organization_id, phoneNumber, msg.pushName);

        // Verificar se tem agente vinculado à instância
        // @ts-ignore - copilot_agents vem do join
        const hasAgent = instance.copilot_agent_id && instance.copilot_agents?.is_active;
        
        if (hasAgent) {
          // Verificar disponibilidade
          // @ts-ignore - availability vem do join
          const availability = instance.copilot_agents?.availability || null;
          if (!isWithinSchedule(availability)) {
            console.log("[Evolution Webhook] Agent outside schedule, skipping response");
            continue;
          }

          // =====================================================
          // MESSAGE BATCHING: Aguardar mais mensagens do lead
          // =====================================================
          // @ts-ignore - response_delay_seconds vem do join
          const batchWaitSeconds = instance.copilot_agents?.response_delay_seconds || DEFAULT_BATCH_WAIT_SECONDS;
          
          console.log("[Evolution Webhook] Starting batch wait:", {
            seconds: batchWaitSeconds,
            messageId: msg.key.id,
            phone: phoneNumber,
          });

          // Aguardar o tempo configurado para acumular mensagens
          await new Promise((resolve) => setTimeout(resolve, batchWaitSeconds * 1000));

          // Verificar se ESTA mensagem ainda é a mais recente não processada
          // Se não for, outra mensagem chegou e vai processar (evita duplicação)
          const { data: latestUnprocessed, error: checkError } = await supabase
            .from("whatsapp_messages")
            .select("message_id")
            .eq("organization_id", instance.organization_id)
            .eq("phone_number", phoneNumber)
            .eq("direction", "incoming")
            .is("processed_by_agent_at", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

          if (checkError || !latestUnprocessed) {
            console.log("[Evolution Webhook] No unprocessed messages found, skipping");
            continue;
          }

          // Se não é a mensagem mais recente, deixar a próxima processar
          if (latestUnprocessed.message_id !== msg.key.id) {
            console.log("[Evolution Webhook] Newer message exists, letting it handle the batch:", {
              thisMessageId: msg.key.id,
              latestMessageId: latestUnprocessed.message_id,
            });
            continue;
          }

          // Esta é a mensagem mais recente! Buscar TODAS não processadas
          const { data: pendingMessages, error: fetchError } = await supabase
            .from("whatsapp_messages")
            .select("message_id, content, created_at")
            .eq("organization_id", instance.organization_id)
            .eq("phone_number", phoneNumber)
            .eq("direction", "incoming")
            .is("processed_by_agent_at", null)
            .not("content", "is", null)
            .order("created_at", { ascending: true });

          if (fetchError || !pendingMessages || pendingMessages.length === 0) {
            console.log("[Evolution Webhook] No pending messages to process");
            continue;
          }

          // Concatenar todas as mensagens pendentes
          const batchedMessageText = pendingMessages
            .map((m: { content: string }) => m.content)
            .filter((c: string) => c && c.trim())
            .join("\n\n");

          console.log("[Evolution Webhook] Processing batched messages:", {
            // @ts-ignore
            agentName: instance.copilot_agents?.name,
            phone: phoneNumber,
            messageCount: pendingMessages.length,
            totalLength: batchedMessageText.length,
          });

          // Chamar agent-message para processar com IA
          const agentResult = await triggerAgentMessage(
            instance.organization_id,
            phoneNumber,
            batchedMessageText,
            msg.pushName
          );

          // Marcar TODAS as mensagens como processadas
          const messageIds = pendingMessages.map((m: { message_id: string }) => m.message_id);
          const { error: markError } = await supabase
            .from("whatsapp_messages")
            .update({ processed_by_agent_at: new Date().toISOString() })
            .in("message_id", messageIds);

          if (markError) {
            console.warn("[Evolution Webhook] Error marking messages as processed:", markError);
          } else {
            console.log("[Evolution Webhook] Marked", messageIds.length, "messages as processed");
          }

          // Se o agente retornou uma resposta, enviar de volta via WhatsApp
          if (agentResult.success && agentResult.message) {
            const sent = await sendWhatsAppResponse(
              instance.instance_name,
              phoneNumber,
              agentResult.message
            );

            // Salvar mensagem de saída no banco
            if (sent) {
              const { error: outMsgError } = await supabase.from("whatsapp_messages").insert({
                organization_id: instance.organization_id,
                instance_id: instance.id,
                message_id: `agent_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                remote_jid: `${phoneNumber}@s.whatsapp.net`,
                phone_number: phoneNumber,
                direction: "outgoing",
                message_type: "text",
                content: agentResult.message,
                status: "sent",
                timestamp: new Date().toISOString(),
              });

              if (outMsgError) {
                console.error("[Evolution Webhook] Error saving outgoing message:", outMsgError);
              } else {
                console.log("[Evolution Webhook] Outgoing agent message saved");
              }
            }
          } else if (!agentResult.success) {
            console.warn("[Evolution Webhook] Agent processing failed:", agentResult.error);
          }
        } else {
          console.log("[Evolution Webhook] No active agent linked to this instance, skipping AI processing");
        }
      } else if (direction === "incoming") {
        // Mensagem sem texto (mídia), apenas associar ao lead
        await associateMessageToLeadCentralized(supabase, instance.organization_id, phoneNumber, msg.pushName);
      }
    } catch (error) {
      console.error("[Evolution Webhook] Error processing message:", error);
    }
  }
}

/**
 * Processa atualização de status de mensagem
 */
async function handleMessagesUpdate(
  supabase: ReturnType<typeof createClient>,
  instance: { id: string; organization_id: string; instance_name: string },
  data: Record<string, unknown>
) {
  const updates = Array.isArray(data) ? data : [data];

  for (const update of updates) {
    const key = update.key as { id: string } | undefined;
    const status = update.update?.status as number | undefined;

    if (!key?.id || !status) continue;

    // Mapear status numérico para texto
    let statusText: string;
    switch (status) {
      case 1:
        statusText = "pending";
        break;
      case 2:
        statusText = "sent";
        break;
      case 3:
        statusText = "delivered";
        break;
      case 4:
        statusText = "read";
        break;
      default:
        statusText = "unknown";
    }

    const { error } = await supabase
      .from("whatsapp_messages")
      .update({ status: statusText })
      .eq("message_id", key.id)
      .eq("instance_id", instance.id);

    if (error) {
      console.error("[Evolution Webhook] Error updating message status:", error);
    }
  }
}

/**
 * Associa mensagem a um lead existente ou cria um novo
 * Usa o serviço centralizado lead-service para busca/criação
 */
async function associateMessageToLeadCentralized(
  supabase: ReturnType<typeof createClient>,
  organizationId: string,
  phoneNumber: string,
  pushName?: string
) {
  // Usar serviço centralizado para buscar ou criar lead
  const result = await getOrCreateLead(supabase, {
    organizationId,
    phone: phoneNumber,
    pushName,
    origin: 'whatsapp',
  });

  if (result?.lead) {
    // Associar mensagens não vinculadas a este lead
    await associateMessagesToLead(supabase, organizationId, phoneNumber, result.lead.id);

    console.log("[Evolution Webhook] Lead resolved:", {
      leadId: result.lead.id,
      created: result.created,
      source: result.source
    });
  }
}

/**
 * Extrai número de telefone do JID
 */
function extractPhoneNumber(jid: string): string {
  return jid.replace("@s.whatsapp.net", "").replace("@c.us", "");
}

/**
 * Extrai texto da mensagem
 */
function extractMessageText(msg: MessageData): string | null {
  if (msg.message?.conversation) {
    return msg.message.conversation;
  }
  if (msg.message?.extendedTextMessage?.text) {
    return msg.message.extendedTextMessage.text;
  }
  if (msg.message?.imageMessage?.caption) {
    return msg.message.imageMessage.caption;
  }
  if (msg.message?.videoMessage?.caption) {
    return msg.message.videoMessage.caption;
  }
  return null;
}

/**
 * Baixa mídia usando a API getBase64FromMediaMessage e salva no Storage
 */
async function downloadAndSaveMedia(
  supabase: ReturnType<typeof createClient>,
  instanceName: string,
  messageId: string,
  mediaType: string,
  mimeType: string | null,
  organizationId: string
): Promise<string | null> {
  try {
    console.log("[Evolution Webhook] Downloading media via getBase64FromMediaMessage:", {
      instance: instanceName,
      messageId,
      mediaType,
    });

    // Chamar a Evolution API para obter o base64 da mídia
    const evolutionApiUrl = Deno.env.get("EVOLUTION_API_URL");
    const evolutionApiKey = Deno.env.get("EVOLUTION_API_KEY");

    if (!evolutionApiUrl || !evolutionApiKey) {
      console.error("[Evolution Webhook] Missing EVOLUTION_API_URL or EVOLUTION_API_KEY");
      return null;
    }

    const response = await fetch(
      `${evolutionApiUrl}/chat/getBase64FromMediaMessage/${instanceName}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": evolutionApiKey,
        },
        body: JSON.stringify({
          message: {
            key: {
              id: messageId,
            },
          },
          convertToMp4: mediaType === "video", // Converter vídeo para MP4
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Evolution Webhook] getBase64 failed:", response.status, errorText);
      return null;
    }

    const result = await response.json();
    
    if (!result.base64) {
      console.error("[Evolution Webhook] No base64 in response:", result);
      return null;
    }

    console.log("[Evolution Webhook] Got base64, length:", result.base64.length);

    // Determinar content type
    const rawMimeType = result.mimetype || mimeType || "application/octet-stream";
    let contentType = rawMimeType.split(";")[0].trim();
    
    // Para áudio OGG com opus, manter como audio/ogg
    if (contentType === "audio/ogg" || rawMimeType.includes("opus")) {
      contentType = "audio/ogg";
    }

    // Determinar extensão do arquivo
    const extMap: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "audio/ogg": "ogg",
      "audio/mpeg": "mp3",
      "audio/mp4": "m4a",
      "audio/aac": "aac",
      "video/mp4": "mp4",
      "application/pdf": "pdf",
    };
    const ext = extMap[contentType] || contentType.split("/")[1]?.split(";")[0] || "bin";

    // Converter base64 para Uint8Array
    const binaryString = atob(result.base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Gerar nome único do arquivo
    const fileName = `${mediaType}_${messageId}_${Date.now()}.${ext}`;
    const filePath = `whatsapp-media/${organizationId}/${fileName}`;

    console.log("[Evolution Webhook] Saving to storage:", {
      filePath,
      contentType,
      size: bytes.byteLength,
    });

    // Fazer upload para o Storage
    const { data, error } = await supabase.storage
      .from("media")
      .upload(filePath, bytes, {
        contentType,
        upsert: true,
      });

    if (error) {
      console.error("[Evolution Webhook] Storage upload error:", error);
      return null;
    }

    // Obter URL pública
    const { data: urlData } = supabase.storage
      .from("media")
      .getPublicUrl(filePath);

    console.log("[Evolution Webhook] Media saved successfully:", urlData?.publicUrl);
    return urlData?.publicUrl || null;
  } catch (error) {
    console.error("[Evolution Webhook] Download/save error:", error);
    return null;
  }
}
