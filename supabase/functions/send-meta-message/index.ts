import { storedMetaToken } from "../_shared/meta-token-crypto.ts";
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
import { canUserPerformAction } from "../_shared/permission_engine.ts";
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
      conversationId,
      channel,
      message,
      pageId,
      mediaUrl,
      mediaType,
    } = body;

    // Authenticate user
    let auth;
    try {
      auth = await requireAuth(req, { body, requireOrganization: true });
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

    if (message !== undefined && (typeof message !== "string" || message.length > 2000)) return new Response(JSON.stringify({ error: "invalid_message" }), { status: 400, headers: corsHeaders });
    if (mediaUrl) {
      let valid = false;
      try { const url = new URL(mediaUrl); valid = url.protocol === "https:" && !url.username && !url.password && ["image", "video", "audio", "file"].includes(mediaType); } catch { /* invalid media URL */ }
      if (!valid) return new Response(JSON.stringify({ error: "invalid_media" }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const permission = await canUserPerformAction({ supabase, userId: auth.userId, organizationId: auth.organizationId, action: "send_message" });
    if (!permission.allowed) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: corsHeaders });

    const { data: conversation, error: conversationError } = await supabase.from("meta_conversations")
      .select("meta_page_id,external_user_id,channel,last_inbound_at").eq("id", conversationId).eq("organization_id", auth.organizationId).maybeSingle();
    if (conversationError || !conversation || conversation.external_user_id !== recipientId || conversation.channel !== channel) return new Response(JSON.stringify({ error: "conversation_not_found" }), { status: 404, headers: corsHeaders });
    const inbound = new Date(conversation.last_inbound_at ?? "").getTime();
    if (!Number.isFinite(inbound) || inbound > Date.now() || Date.now() - inbound >= 24 * 60 * 60 * 1000) return new Response(JSON.stringify({ error: "messaging_window_closed" }), { status: 409, headers: corsHeaders });

    // Buscar pagina pelo page_id (scoped to user's org)
    let pageQuery = supabase
      .from("meta_pages")
      .select("id, organization_id, page_id, page_access_token, instagram_account_id, meta_connections!inner(app_id,status)")
      .eq("is_active", true)
      .eq("organization_id", auth.organizationId)
      .eq("id", conversation.meta_page_id);

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

    const binding = Array.isArray(page.meta_connections) ? page.meta_connections[0] : page.meta_connections;
    if (binding?.status !== "connected") return new Response(JSON.stringify({ error: "connection_inactive" }), { status: 409, headers: corsHeaders });
    const appId = binding.app_id;
    const pageToken = await storedMetaToken(page.page_access_token, appId, auth.organizationId, `page:${page.page_id}`);
    let result;

    if (mediaUrl && mediaType) {
      // Enviar midia
      result = await sendMediaMessage(
        pageToken,
        recipientId,
        mediaUrl,
        mediaType,
        channel,
        page.page_id,
        page.instagram_account_id || undefined,
        appId
      );
    } else {
      // Enviar texto
      result = await sendMessage(
        pageToken,
        recipientId,
        message,
        channel,
        page.page_id,
        page.instagram_account_id || undefined,
        appId
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
