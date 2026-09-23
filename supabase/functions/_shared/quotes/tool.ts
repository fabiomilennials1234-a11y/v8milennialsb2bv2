import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOCX_MIME, QUOTE_BUCKET, QUOTE_MAX_BYTES, renderQuoteData, type QuoteConfig } from "../../../../src/contracts/copilot/quote-document.ts";
import { base64, documentService, sha256 } from "./service.ts";
import { enqueueAiAction } from "../ai-queue.ts";
import { quoteLiveSendEnabled } from "./live-send.ts";
import { isQuoteConfirmation, quoteSummary, sameQuoteData } from "./confirmation.ts";
import { receivedAfterSummary, type QuoteInbound } from "./presentation.ts";

export interface QuoteContext { organizationId: string; agentId: string; leadId: string; conversationId: string; userMessage: string; inbound?: QuoteInbound }
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** All identity fields come from the engine, never from LLM arguments. */
export async function quoteContext(db: SupabaseClient, ctx: QuoteContext) {
  const agent = await db.from("copilot_agents").select("id,is_active,can_generate_order_request,order_request_config,whatsapp_instance_id")
    .eq("organization_id", ctx.organizationId).eq("id", ctx.agentId).single();
  const conversation = await db.from("conversations").select("id").eq("organization_id", ctx.organizationId).eq("id", ctx.conversationId).eq("agent_id", ctx.agentId).eq("lead_id", ctx.leadId).single();
  const lead = await db.from("leads").select("id,name,company,email,phone,ai_disabled").eq("organization_id", ctx.organizationId).eq("id", ctx.leadId).single();
  if (agent.error || conversation.error || lead.error || !agent.data?.is_active || agent.data.can_generate_order_request !== true || !lead.data) throw new Error("Orçamento indisponível para esta conversa.");
  const config = agent.data.order_request_config as QuoteConfig;
  if (!config?.template_document_id || !UUID.test(config.template_document_id)) throw new Error("Configure um modelo Word válido.");
  const template = await db.from("copilot_quote_templates").select("*").eq("organization_id", ctx.organizationId).eq("agent_id", ctx.agentId).eq("id", config.template_document_id).single();
  if (template.error || !template.data) throw new Error("Modelo indisponível para este agente.");
  return { agent: agent.data, lead: lead.data, template: template.data, config };
}

export async function runQuoteTool(db: SupabaseClient, ctx: QuoteContext, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (args.operation === "send" && !quoteLiveSendEnabled(ctx.organizationId)) return { success: false, error: "quote_live_send_disabled", instruction: "Envios reais estão bloqueados nesta fase de testes. Não afirme envio ou entrega." };
  try {
    const operation = args.operation;
    // The model cannot select an order: resolve the latest quote using trusted context only.
    const { template, config, lead } = await quoteContext(db, ctx);
    let read = db.from("copilot_quotes").select("*").eq("organization_id", ctx.organizationId).eq("agent_id", ctx.agentId).eq("lead_id", ctx.leadId).eq("conversation_id", ctx.conversationId);
    const query = await read.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (query.error) throw new Error("Falha ao consultar orçamento.");
    let quote = query.data;
    const update = async (patch: Record<string, unknown>, statuses: string[]) => {
      const result = await db.from("copilot_quotes").update(patch).eq("organization_id", ctx.organizationId).eq("id", quote.id).eq("revision", quote.revision).eq("updated_at", quote.updated_at).in("status", statuses).select("*").maybeSingle();
      if (result.error || !result.data) throw new Error("Orçamento alterado em outro turno. Consulte o estado novamente.");
      quote = result.data;
    };
    if (operation === "status") return { success: true, quote: quote ? { id: quote.id, revision: quote.revision, status: quote.status, data: quote.data, error: quote.error_code, file_name: quote.file_name } : null,
      lead: { name: lead.name, company: lead.company, email: lead.email, phone: lead.phone }, fields: template.fields, required_fields: config.required_fields ?? template.fields };
    if (operation === "save") {
      if (!args.data || typeof args.data !== "object" || Array.isArray(args.data) || JSON.stringify(args.data).length > 60000) throw new Error("Rascunho inválido.");
      if (quote && ["awaiting_confirmation", "ready", "failed"].includes(quote.status) && isQuoteConfirmation(ctx.userMessage)) {
        return { success: false, error_code: "confirmation_must_not_resave", error: "O cliente confirmou o orçamento existente. Use generate, sem salvar outra revisão." };
      }
      if (quote && ["draft", "awaiting_confirmation", "ready"].includes(quote.status) && quote.template_id === template.id && quote.convert_to_pdf === (config.convert_to_pdf === true) && sameQuoteData(quote.data, args.data)) {
        return { success: true, quote_id: quote.id, revision: quote.revision, status: quote.status, unchanged: true };
      }
      // A new order can follow a completed one, without overwriting its audit trail.
      if (quote && ["sent", "canceled"].includes(quote.status)) quote = null;
      if (quote && !["draft", "awaiting_confirmation", "failed", "ready"].includes(quote.status)) throw new Error("Orçamento bloqueado. Consulte o estado antes de continuar.");
      const patch = { data: args.data, status: "draft", template_id: template.id, required_fields: config.required_fields ?? template.fields,
        convert_to_pdf: config.convert_to_pdf === true, confirmation_code: null, confirmed_at: null, file_path: null, file_name: null, error_code: null };
      if (quote) await update({ ...patch, revision: quote.revision + 1 }, [quote.status]);
      else {
        const result = await db.from("copilot_quotes").insert({ ...patch, organization_id: ctx.organizationId, agent_id: ctx.agentId, lead_id: ctx.leadId, conversation_id: ctx.conversationId }).select("*").single();
        if (result.error || !result.data) throw new Error("Não foi possível salvar o rascunho."); quote = result.data;
      }
      return { success: true, quote_id: quote.id, revision: quote.revision, status: quote.status };
    }
    if (!quote || quote.template_id !== template.id || quote.convert_to_pdf !== (config.convert_to_pdf === true)) throw new Error("Salve um rascunho com a configuração atual.");
    if (operation === "prepare") {
      const rendered = renderQuoteData(quote.data, template.fields, quote.required_fields);
      if (!["draft", "awaiting_confirmation"].includes(quote.status)) throw new Error("Estado incompatível com confirmação.");
      if (quote.status !== "awaiting_confirmation") await update({ status: "awaiting_confirmation", confirmation_code: null }, [quote.status]);
      return { success: true, quote_id: quote.id, revision: quote.revision, summary: rendered, customer_message: quoteSummary(quote.data, template.fields, quote.required_fields), confirmation_instruction: "Apresente este resumo e peça confirmação natural. Não peça IDs ou códigos e não salve novamente após a confirmação." };
    }
    if (operation === "generate") {
      // A killed renderer must not leave the order generating forever. The CAS
      // below also prevents a late result from the previous attempt overwriting us.
      if (quote.status === "generating" && quote.confirmed_at && Date.now() - Date.parse(quote.updated_at) > 120_000) {
        await update({ status: "failed", error_code: "generation_interrupted" }, ["generating"]);
      }
      if (["ready", "sending", "sent", "reconcile", "generating"].includes(quote.status)) return { success: true, quote_id: quote.id, status: quote.status, file_name: quote.file_name };
      const legacyConfirmation = Boolean(quote.confirmation_code && ctx.userMessage.trim().toUpperCase() === `CONFIRMO ${quote.confirmation_code}`);
      if (!isQuoteConfirmation(ctx.userMessage) && !legacyConfirmation) throw new Error("Aguarde uma confirmação clara do cliente, sem alterações no pedido.");
      const retry = quote.status === "failed" && Boolean(quote.confirmed_at);
      if (quote.status !== "awaiting_confirmation" && !retry) throw new Error("Apresente o resumo antes de gerar o documento.");
      if (!retry) {
        const messages = await db.from("conversation_messages").select("content,metadata").eq("conversation_id", ctx.conversationId).eq("role", "assistant").gte("created_at", quote.updated_at).order("created_at", { ascending: false }).limit(1);
        const last = String(messages.data?.[0]?.content ?? "");
        const receipt = messages.data?.[0]?.metadata?.quote_presentation;
        if (messages.error || receipt?.quote_id !== quote.id || receipt?.revision !== quote.revision || !(last === quoteSummary(quote.data, template.fields, quote.required_fields) || (legacyConfirmation && last.includes(`CONFIRMO ${quote.confirmation_code}`))) || !await receivedAfterSummary(db, ctx, quote.updated_at, last, receipt)) {
          return { success: false, error_code: "quote_summary_required", error: "Esta mensagem não confirma uma apresentação entregue desta revisão. Não gere nem salve novamente. Apresente o resumo com prepare e aguarde a resposta posterior do cliente." };
        }
      }
      const rendered = renderQuoteData(quote.data, template.fields, quote.required_fields);
      await update({ status: "generating", confirmed_at: quote.confirmed_at ?? new Date().toISOString() }, [quote.status]);
      try {
        const download = await db.storage.from(QUOTE_BUCKET).download(template.file_path);
        if (download.error || !download.data) throw new Error("Modelo indisponível.");
        const bytes = new Uint8Array(await download.data.arrayBuffer());
        if (await sha256(bytes) !== template.sha256) throw new Error("Integridade do modelo inválida.");
        const result = await documentService("render", { template: base64(bytes), ...rendered, convert_to_pdf: quote.convert_to_pdf });
        const format = quote.convert_to_pdf ? "pdf" : "docx";
        if (result.format !== format || typeof result.file !== "string") throw new Error("Formato de saída inválido.");
        const output = Uint8Array.from(atob(result.file), c => c.charCodeAt(0));
        if (output.length > QUOTE_MAX_BYTES || !output.length || (format === "pdf" ? new TextDecoder().decode(output.slice(0, 5)) !== "%PDF-" : output[0] !== 80 || output[1] !== 75)) throw new Error("Arquivo gerado inválido.");
        const path = `${ctx.organizationId}/${ctx.agentId}/quotes/${quote.id}/${quote.revision}-${crypto.randomUUID()}.${format}`;
        const upload = await db.storage.from(QUOTE_BUCKET).upload(path, output, { contentType: quote.convert_to_pdf ? "application/pdf" : DOCX_MIME, upsert: false });
        if (upload.error) throw new Error("Falha ao salvar documento.");
        await update({ status: "ready", file_path: path, file_name: `orcamento-${quote.id.slice(0, 8)}-r${quote.revision}.${format}`, error_code: null }, ["generating"]);
        return { success: true, quote_id: quote.id, revision: quote.revision, status: "ready", file_name: quote.file_name, instruction: "Documento gerado. Use operation=send para solicitar entrega. Ainda não foi enviado." };
      } catch {
        await update({ status: "failed", error_code: "generation_failed" }, ["generating"]);
        return { success: false, quote_id: quote.id, error_code: "generation_failed", error: "Falha técnica ao gerar o documento. A confirmação foi preservada; não salve outra revisão. Uma nova tentativa pode usar generate." };
      }
    }
    if (operation === "send") {
      if (quote.status === "sent") return { success: true, quote_id: quote.id, status: "sent" };
      if (quote.status !== "ready") throw new Error("O arquivo ainda não está pronto para envio.");
      const result = await enqueueAiAction(db, { organizationId: ctx.organizationId, leadId: ctx.leadId, conversationId: ctx.conversationId, actionType: "send_quote_document", payload: { quote_id: quote.id, revision: quote.revision }, idempotencyKey: `quote:${quote.id}:${quote.revision}` });
      if (!result.queued && result.reason !== "duplicate_idempotency_key") throw new Error("Falha ao enfileirar envio.");
      if (!result.queued) {
        const existing = await db.from("pending_ai_actions").select("status").eq("organization_id", ctx.organizationId).eq("lead_id", ctx.leadId).eq("conversation_id", ctx.conversationId).eq("idempotency_key", `quote:${quote.id}:${quote.revision}`).maybeSingle();
        if (existing.error || !existing.data || !["pending", "processing"].includes(existing.data.status)) {
          return { success: false, error_code: "quote_queue_requires_review", error: "A tentativa anterior não está pendente. Confira o resultado da fila antes de reenviar; não anuncie novo envio." };
        }
      }
      return { success: true, quote_id: quote.id, status: "queued", instruction: "Envio solicitado. Não afirme entrega confirmada." };
    }
    throw new Error("Operação inválida.");
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : "Falha no orçamento." }; }
}
