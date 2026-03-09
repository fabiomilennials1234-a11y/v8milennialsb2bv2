/**
 * send-meta-message
 *
 * Envia mensagem via Messenger ou Instagram Direct usando a Graph API.
 * Salva a mensagem outgoing em channel_messages.
 *
 * Body: { recipientId, channel, message, pageId, mediaUrl?, mediaType? }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { sendMessage, sendMediaMessage } from "../_shared/meta-api.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const {
      recipientId,
      channel,
      message,
      pageId,
      mediaUrl,
      mediaType,
    } = await req.json();

    if (!recipientId || !channel || (!message && !mediaUrl)) {
      return new Response(
        JSON.stringify({ error: "recipientId, channel, e message/mediaUrl sao obrigatorios" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (channel !== "messenger" && channel !== "instagram") {
      return new Response(
        JSON.stringify({ error: "channel deve ser 'messenger' ou 'instagram'" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Buscar pagina pelo page_id para obter token e org
    let pageQuery = supabase
      .from("meta_pages")
      .select("id, organization_id, page_id, page_access_token, instagram_account_id")
      .eq("is_active", true);

    if (pageId) {
      pageQuery = pageQuery.eq("page_id", pageId);
    } else if (channel === "instagram") {
      // Tentar encontrar a pagina pelo instagram_account_id
      // Se nao tiver pageId, buscar qualquer pagina com IG ativo
      pageQuery = pageQuery.not("instagram_account_id", "is", null);
    }

    const { data: page, error: pageError } = await pageQuery.limit(1).single();

    if (pageError || !page) {
      return new Response(
        JSON.stringify({ error: "Pagina Meta nao encontrada ou inativa" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let result;

    if (mediaUrl && mediaType) {
      // Enviar midia
      result = await sendMediaMessage(
        page.page_access_token,
        recipientId,
        mediaUrl,
        mediaType,
        channel,
        page.page_id,
        page.instagram_account_id || undefined
      );
    } else {
      // Enviar texto
      result = await sendMessage(
        page.page_access_token,
        recipientId,
        message,
        channel,
        page.page_id,
        page.instagram_account_id || undefined
      );
    }

    // Salvar mensagem outgoing em channel_messages
    const { error: insertError } = await supabase.from("channel_messages").insert({
      organization_id: page.organization_id,
      channel,
      page_id: page.page_id,
      external_id: result.message_id || `meta_${Date.now()}`,
      sender_id: recipientId,
      direction: "outgoing",
      message_type: mediaType || "text",
      content: message || null,
      media_url: mediaUrl || null,
      status: "sent",
      timestamp: new Date().toISOString(),
    });

    if (insertError) {
      console.error("[send-meta-message] Error saving outgoing message:", insertError);
    }

    return new Response(
      JSON.stringify({ success: true, message_id: result.message_id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("[send-meta-message] Error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
