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

export async function executeSendDocument(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
  organizationId: string,
  leadId: string | null,
  conversationId: string | null = null,
): Promise<ActionResult> {
  const documentId = payload.document_id as string;
  const caption = payload.caption as string | undefined;

  if (!documentId) {
    return { success: false, error: "document_id is required" };
  }
  if (!leadId) {
    return { success: false, error: "lead_id is required to send document" };
  }

  // 1. Buscar documento e metadados
  const { data: doc, error: docError } = await supabase
    .from("copilot_agent_documents")
    .select("id, file_name, file_path, mime_type, organization_id, file_type")
    .eq("id", documentId)
    .eq("organization_id", organizationId)
    .single();

  if (docError || !doc) {
    return { success: false, error: `Document not found: ${docError?.message || "not found"}` };
  }

  // 2. Gerar URL assinada (valida por 1 hora)
  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from("agent-documents")
    .createSignedUrl(doc.file_path, 3600);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    return {
      success: false,
      error: `Failed to generate signed URL: ${signedUrlError?.message || "unknown"}`,
    };
  }

  // 3. Buscar telefone do lead e instância WhatsApp
  const { data: lead } = await supabase
    .from("leads")
    .select("phone")
    .eq("id", leadId)
    .single();

  if (!lead?.phone) {
    return { success: false, error: "Lead has no phone number" };
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

  // Resolve provider + instance + phone via adapter
  const { resolveDispatchContext, DispatchResolutionError } = await import(
    "../whatsapp-dispatch.ts"
  );
  let ctx;
  try {
    ctx = await resolveDispatchContext(supabase, {
      organization_id: organizationId,
      phone: lead.phone,
      preferred_instance_id: preferredInstanceId,
      require_connected: true,
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
    return {
      success: false,
      error: `Failed to send document: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
