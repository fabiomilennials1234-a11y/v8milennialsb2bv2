import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isQuoteConfirmation } from "./confirmation.ts";
import { runQuoteTool, type QuoteContext } from "./tool.ts";

/** Resolves confirmations before the LLM can rewrite the draft or invent an ID. */
export async function handleConfirmedQuote(db: SupabaseClient, ctx: QuoteContext): Promise<{ message: string; result: Record<string, unknown> } | null> {
  if (!isQuoteConfirmation(ctx.userMessage) && !/^CONFIRMO [A-F0-9]{8}$/i.test(ctx.userMessage.trim())) return null;
  const current = await runQuoteTool(db, ctx, { operation: "status" });
  const quote = current.quote as { status?: string } | null;
  if (!current.success || !quote || quote.status !== "awaiting_confirmation") return null;
  let result = await runQuoteTool(db, ctx, { operation: "generate" });
  if (result.error_code === "quote_summary_required") return null;
  if (typeof result.customer_message === "string") return { message: result.customer_message, result };
  if (!result.success) return { message: "Não consegui gerar o documento agora. O pedido foi preservado; não é necessário refazer o cadastro. A geração precisa de verificação técnica.", result };
  if (result.status === "ready") result = await runQuoteTool(db, ctx, { operation: "send" });
  if (!result.success) return { message: "O documento foi gerado, mas o envio está bloqueado ou indisponível. Seu pedido foi preservado e ainda não confirmei o envio.", result };
  const messages: Record<string, string> = {
    queued: "Orçamento confirmado. O documento foi gerado e está na fila de envio por aqui.",
    sent: "O documento deste orçamento já foi enviado. Não vou duplicar o envio.",
    generating: "A geração deste documento já está em andamento. Não é necessário confirmar novamente.",
    sending: "O envio deste documento já está em andamento. Não é necessário confirmar novamente.",
    reconcile: "O envio anterior precisa ser conferido antes de uma nova tentativa, para evitar duplicidade.",
  };
  return { message: messages[String(result.status)] ?? "O processamento do documento precisa de verificação técnica. Seu pedido foi preservado.", result };
}
