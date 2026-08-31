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
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { sendMessage, sendMediaMessage } from "../_shared/meta-api.ts";
import { withErrorBoundary } from '../_shared/error-boundary.ts';
import { requireAuth, AuthError, authErrorResponse } from "../_shared/user-auth.ts";
import { logRuntime } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(withErrorBoundary('send-meta-message', async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      recipientId,
      channel,
      message,
      pageId,
      mediaUrl,
      mediaType,
    } = body;

    // Authenticate user
    let auth;
    try {
      auth = await requireAuth(req, { body });
    } catch (err) {
      if (err instanceof AuthError) {
        return authErrorResponse(err, corsHeaders);
      }
      throw err;
    }

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

    // Buscar pagina pelo page_id (scoped to user's org)
    let pageQuery = supabase
      .from("meta_pages")
      .select("id, organization_id, page_id, page_access_token, instagram_account_id")
      .eq("is_active", true)
      .eq("organization_id", auth.organizationId);

    if (pageId) {
      pageQuery = pageQuery.eq("page_id", pageId);
    } else if (channel === "instagram") {
      pageQuery = pageQuery.not("instagram_account_id", "is", null);
    }

    const { data: page, error: pageError } = await pageQuery.limit(1).single();

    if (pageError || !page) {
      return new Response(
        JSON.stringify({ error: "Pagina Meta nao encontrada ou inativa" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Defense-in-depth: verify org match
    if (page.organization_id !== auth.organizationId) {
      await logRuntime({
        organizationId: auth.organizationId,
        module: "permission",
        action: "send_meta_message",
        status: "error",
        errorMessage: `Org mismatch: user org ${auth.organizationId} vs page org ${page.organization_id}`,
        entityType: "meta_page",
        entityId: page.page_id,
      });
      return new Response(
        JSON.stringify({ error: "Você não tem permissão para enviar mensagens desta página" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
      // Autoria (SCRUM-593, ADR-0033 §4). Aqui a linha nasce no próprio envio,
      // então o autor é gravado direto — sem depender do eco do provedor.
      // NULL quando o ator não tem cadeira na org (Master, Gestor).
      sent_by_team_member_id: auth.teamMemberId || null,
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
}));
