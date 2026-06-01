/**
 * AI Action handler — envio de documento ao lead via WhatsApp.
 *
 *  - Busca o doc em copilot_agent_documents
 *  - Gera URL assinada (1h)
 *  - Resolve provider/instância via whatsapp-dispatch.resolveDispatchContext
 *  - Despacha sendMedia (image/video/document)
 *  - Registra mensagem outgoing em whatsapp_messages
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ActionResult } from "./types.ts";
import { resolveDispatchContext, DispatchResolutionError } from "../whatsapp-dispatch.ts";
import { isCopilotCanceled, logCopilotCancellation } from "../copilot/cancellation.ts";
import { captureMessage } from "../sentry.ts";

/**
 * Checks if a document was already sent in a conversation.
 * Used as hard dedup gate before dispatching the actual send.
 *
 * Two layers:
 *   1. pending_ai_actions — primary gate scoped per conversation+document.
 *   2. whatsapp_messages fallback — only when filePath provided. Catches the
 *      edge case where the pending_ai_action row was lost (manual delete,
 *      schema migration) but the media was already delivered. Matches the
 *      exact media via media_url ILIKE on the storage path basename.
 *
 * Earlier revisions had a fallback that blocked on "any outgoing AI message
 * within 1h" — that fired on every text reply and silently skipped every
 * legitimate video. The match must be on the document itself, not on
 * unrelated chatter.
 */
export async function checkDocumentAlreadySent(
  supabase: SupabaseClient,
  conversationId: string,
  documentId: string,
  leadId?: string | null,
  filePath?: string | null,
  currentActionId?: string | null,
): Promise<boolean> {
  // Exclude the current action's own row from the dedup query. `claim_pending_ai_actions`
  // sets status='processing' before the executor runs, so without this guard the gate
  // would always match itself and silently skip every legitimate send.
  let query = supabase
    .from("pending_ai_actions")
    .select("id, payload")
    .eq("conversation_id", conversationId)
    .eq("action_type", "send_document")
    .in("status", ["completed", "processing"]);

  if (currentActionId) {
    query = query.neq("id", currentActionId);
  }

  const { data } = await query;

  if (data && data.length > 0) {
    const isDuplicate = data.some(
      (row: any) => (row.payload as Record<string, unknown>)?.document_id === documentId,
    );

    if (isDuplicate) {
      captureMessage("copilot_duplicate_document_blocked", {
        tags: {
          "copilot.document_id": documentId,
          "copilot.conversation_id": conversationId,
        },
      }).catch(() => {});
      return true;
    }
  }

  if (!leadId || !filePath) return false;

  const { data: lead } = await supabase
    .from("leads")
    .select("phone")
    .eq("id", leadId)
    .single();

  if (!lead?.phone) return false;

  const basename = filePath.split("/").pop();
  if (!basename) return false;

  const { data: sentMessages } = await supabase
    .from("whatsapp_messages")
    .select("id")
    .eq("phone_number", lead.phone)
    .eq("direction", "outgoing")
    .eq("sent_by_ai", true)
    .in("message_type", ["document", "image", "video", "audio"])
    .ilike("media_url", `%${basename}%`)
    .gte("timestamp", new Date(Date.now() - 3600_000).toISOString())
    .limit(1);

  if (sentMessages && sentMessages.length > 0) {
    captureMessage("copilot_duplicate_document_blocked_whatsapp_fallback", {
      tags: {
        "copilot.document_id": documentId,
        "copilot.conversation_id": conversationId,
        "copilot.lead_id": leadId,
      },
    }).catch(() => {});
    return true;
  }

  return false;
}

export async function executeSendDocument(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
  organizationId: string,
  leadId: string | null,
  conversationId: string | null = null,
  actionId: string | null = null,
): Promise<ActionResult> {
  const documentId = payload.document_id as string;
  const caption = payload.caption as string | undefined;

  if (!documentId) {
    return { success: false, error: "document_id is required" };
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(documentId)) {
    return { success: false, error: `invalid document_id: expected UUID, got "${documentId}"` };
  }
  if (!leadId) {
    return { success: false, error: "lead_id is required to send document" };
  }

  // 1. Buscar documento e metadados (antes do gate — fallback whatsapp_messages
  //    precisa do file_path pra fazer match preciso via media_url ILIKE).
  const { data: doc, error: docError } = await supabase
    .from("copilot_agent_documents")
    .select("id, file_name, file_path, mime_type, organization_id, file_type")
    .eq("id", documentId)
    .eq("organization_id", organizationId)
    .single();

  if (docError || !doc) {
    return { success: false, error: `Document not found: ${docError?.message || "not found"}` };
  }

  // 2. Dedup gate — block duplicate document sends per conversation lifetime.
  if (conversationId) {
    const alreadySent = await checkDocumentAlreadySent(
      supabase,
      conversationId,
      documentId,
      leadId,
      doc.file_path,
      actionId,
    );
    if (alreadySent) {
      console.debug("[executeSendDocument] Duplicate document skipped:", { conversationId, documentId });
      return {
        success: true,
        message: "Document already sent in this conversation — skipped",
        data: { skipped: true, reason: "duplicate_document" },
      };
    }
  }

  // 3. Gerar URL assinada (valida por 1 hora)
  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from("agent-documents")
    .createSignedUrl(doc.file_path, 3600);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    return {
      success: false,
      error: `Failed to generate signed URL: ${signedUrlError?.message || "unknown"}`,
    };
  }

  // 4. Buscar telefone do lead e instância WhatsApp
  const { data: lead } = await supabase
    .from("leads")
    .select("phone")
    .eq("id", leadId)
    .single();

  if (!lead?.phone) {
    return { success: false, error: "Lead has no phone number" };
  }

  // RC-cancel: gate antes de enviar via provider. SEND_DOCUMENT é enfileirado
  // em pending_ai_actions e processado por process-ai-actions (cron 1min).
  // Janela: user pode desligar "IA" entre AgentEngine decidir o envio e o
  // worker pegar a ação — sem este gate, o documento ainda é entregue mesmo
  // depois do toggle off. Fonte canônica: phone_ai_preferences > leads.ai_disabled.
  const cancelCheck = await isCopilotCanceled(supabase, organizationId, lead.phone);
  if (cancelCheck.canceled) {
    logCopilotCancellation({
      organizationId,
      gate: "ai_action_send",
      leadId,
      conversationId: conversationId ?? undefined,
      phone: lead.phone,
      source: cancelCheck.source,
    });
    return {
      success: false,
      error: "Copilot disabled for lead — send_document skipped",
    };
  }

  // Find the correct instance: prefer the one linked to the conversation's agent.
  let preferredInstanceId: string | null = null;

  if (conversationId) {
    const { data: conv } = await supabase
      .from("conversations")
      .select("agent_id")
      .eq("id", conversationId)
      .maybeSingle();

    if (conv?.agent_id) {
      const { data: linkedInst } = await supabase
        .from("whatsapp_instances")
        .select("id, status")
        .eq("copilot_agent_id", conv.agent_id)
        .eq("organization_id", organizationId)
        .in("status", ["open", "connected"])
        .limit(1)
        .maybeSingle();
      if (linkedInst?.id) preferredInstanceId = linkedInst.id;
    }
  }

  let ctx;
  try {
    ctx = await resolveDispatchContext(supabase, {
      organization_id: organizationId,
      phone: lead.phone,
      preferred_instance_id: preferredInstanceId,
      require_connected: true,
      // Etapa B: quando flag user_write_instance_strict ON, força vínculo via
      // responsável; OFF mantém precedência legada acima.
      lead_id: leadId,
    });
  } catch (e) {
    const err = e as InstanceType<typeof DispatchResolutionError>;
    return { success: false, error: err.message };
  }

  const { provider, instance, normalizedPhone: phone } = ctx;

  // Detect media type based on file_type column (image/video/document)
  const fileType = (doc as any).file_type || "document";
  let mediaType: "image" | "video" | "document" = "document";
  let messageType = "document";
  if (fileType === "image" || (doc.mime_type && doc.mime_type.startsWith("image/"))) {
    mediaType = "image";
    messageType = "image";
  } else if (fileType === "video" || (doc.mime_type && doc.mime_type.startsWith("video/"))) {
    mediaType = "video";
    messageType = "video";
  }

  try {
    const sendResult = await provider.sendMedia({
      number: phone,
      type: mediaType,
      file: signedUrlData.signedUrl,
      filename: doc.file_name,
      caption: caption || undefined,
      trackSource: "ai-action-send-document",
      trackId: doc.id,
    });

    // Registrar mensagem de saída
    try {
      const { error: insertErr } = await supabase.from("whatsapp_messages").upsert(
        {
          organization_id: organizationId,
          instance_id: instance.id,
          message_id:
            sendResult.message_id ||
            `doc_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          remote_jid: `${phone}@s.whatsapp.net`,
          phone_number: phone,
          direction: "outgoing",
          message_type: messageType,
          content:
            caption ||
            `[${messageType === "image" ? "Imagem" : messageType === "video" ? "Video" : "Documento"}: ${doc.file_name}]`,
          media_url: signedUrlData.signedUrl,
          status: "sent",
          timestamp: new Date().toISOString(),
          sent_by_ai: true,
          sent_source: "copilot",
        },
        { onConflict: "message_id,instance_id", ignoreDuplicates: false },
      );
      if (insertErr)
        console.warn("[executeSendDocument] Failed to log outgoing message:", insertErr);
    } catch (e) {
      console.warn("[executeSendDocument] Failed to log outgoing message:", e);
    }

    return {
      success: true,
      message: `Documento "${doc.file_name}" enviado com sucesso`,
      data: { file_name: doc.file_name, message_id: sendResult.message_id },
    };
  } catch (error) {
    // UazapiError é objeto plano (não instância de Error) → String(error) daria
    // "[object Object]" e perderia o motivo real. Extrai message/status/code/raw.
    let detail: string;
    if (error instanceof Error) {
      detail = error.message;
    } else if (error && typeof error === "object") {
      const e = error as Record<string, unknown>;
      const parts: string[] = [];
      if (e.message) parts.push(String(e.message));
      if (e.status) parts.push(`status=${e.status}`);
      if (e.provider_code) parts.push(`code=${e.provider_code}`);
      if (e.raw) parts.push(`raw=${JSON.stringify(e.raw)}`);
      detail = parts.length > 0 ? parts.join(" | ") : JSON.stringify(error);
    } else {
      detail = String(error);
    }
    return {
      success: false,
      error: `Failed to send document: ${detail}`,
    };
  }
}
