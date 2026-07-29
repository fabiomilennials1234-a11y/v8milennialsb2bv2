/**
 * Desembrulha erros de `supabase.functions.invoke`.
 *
 * O supabase-js v2 embrulha qualquer resposta non-2xx numa `FunctionsHttpError`
 * cujo `.message` é sempre a string genérica "Edge Function returned a non-2xx
 * status code". A mensagem real que a edge function escreveu no corpo fica em
 * `error.context` (um `Response`), que precisa ser lido explicitamente.
 *
 * Sem isso, um erro perfeitamente acionável ("esse número não tem WhatsApp")
 * chega no usuário como uma frase que não diz nada — foi exatamente o que
 * aconteceu no chamado da Mapila Alimentos (2026-07-29): o operador repetiu o
 * envio 4x sem nunca saber que o problema era o telefone do cadastro.
 */

/** Lê a mensagem real do corpo da resposta, com fallback pro `.message`. */
export async function extractEdgeFunctionError(error: unknown): Promise<string> {
  const err = error as { context?: unknown; message?: string } | null;
  const ctx = err?.context as
    | { json?: () => Promise<unknown>; text?: () => Promise<string> }
    | undefined;

  // Cada tentativa tem seu próprio catch: um corpo que não é JSON faz `json()`
  // lançar, e um try compartilhado levaria o `text()` junto — que é justamente
  // o fallback que salva o caso de erro em texto puro.
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = (await ctx.json()) as { error?: unknown; message?: unknown };
      if (body?.error) return String(body.error);
      if (body?.message) return String(body.message);
    } catch {
      // não é JSON — tenta como texto abaixo
    }
  }
  if (ctx && typeof ctx.text === "function") {
    try {
      const text = await ctx.text();
      if (text) return text.slice(0, 500);
    } catch {
      // corpo já consumido — cai no fallback
    }
  }
  return err?.message ?? "Erro desconhecido";
}

/**
 * Traduz o erro cru do provider para algo que o vendedor consegue agir.
 *
 * As mensagens da Uazapi são em inglês e vazam detalhe de transporte
 * ("Uazapi server error 500 on POST /send/text: ..."). Aqui viram instrução.
 * O que não casar com nenhum padrão conhecido passa direto — mensagem feia de
 * verdade ainda é melhor que mensagem genérica.
 */
export function friendlyWhatsAppSendError(raw: string): string {
  const s = raw.toLowerCase();

  if (s.includes("is not on whatsapp") || s.includes("not on whatsapp")) {
    return "Esse número não tem WhatsApp. Confira o telefone no cadastro do lead.";
  }
  if (s.includes("could not parse phone number") || s.includes("invalid number")) {
    return "Número de telefone inválido no cadastro do lead.";
  }
  if (s.includes("número de telefone inválido")) {
    // 422 do whatsapp-api-proxy — já vem pronto em pt-BR
    return raw;
  }
  if (s.includes("rate limit")) {
    return "Muitas mensagens em pouco tempo. Aguarde alguns segundos e tente de novo.";
  }
  if (s.includes("instance") && (s.includes("not connected") || s.includes("disconnected"))) {
    return "A instância do WhatsApp está desconectada. Reconecte em Configurações > WhatsApp.";
  }
  return raw;
}

/** Atalho: desembrulha e já traduz. Use nos envios de WhatsApp. */
export async function whatsAppSendErrorMessage(error: unknown): Promise<string> {
  return friendlyWhatsAppSendError(await extractEdgeFunctionError(error));
}
