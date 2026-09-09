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
/**
 * Aviso obrigatório em toda falha de entrega AMBÍGUA.
 *
 * A Uazapi responde 500/timeout no `POST /send/*` para mensagens que ela **já
 * entregou** — medido duas vezes: 4× "Bom dia" na SC Beauty (2026-07-07) e, na
 * Carol Distribuidora (2026-08-05), 4 erros 463 cujas mensagens reapareceram no
 * history sync com o timestamp original casando ao segundo. Como o
 * `whatsapp-api-proxy` só persiste a mensagem pelo webhook, o envio que "falha"
 * some da tela: o vendedor lê o erro, reenvia, e o cliente recebe duas vezes.
 *
 * Sem esta frase a tradução do erro *induz* a duplicidade em vez de evitá-la.
 */
const PODE_TER_SIDO_ENTREGUE =
  "A mensagem pode ter sido entregue mesmo com esse erro — confira a conversa no WhatsApp antes de reenviar.";

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
  // O WhatsApp (não a Uazapi) barra a conta quando ela abre conversa nova demais
  // ou leva bloqueio de destinatário. É temporário e some sozinho em horas, mas
  // sem esta tradução o vendedor lê "non-2xx", reenvia em looping e piora a
  // reputação do número — foi o que aconteceu na Distetica (2026-08-03).
  if (
    s.includes("temporary restriction") ||
    s.includes("whatsapp server error 463") ||
    s.includes("error 463")
  ) {
    return `${PODE_TER_SIDO_ENTREGUE} O WhatsApp bloqueou temporariamente esse número para iniciar conversas novas (volume/qualidade de envio) — pare os disparos por algumas horas que o bloqueio sai sozinho. Conversas já abertas continuam funcionando.`;
  }
  if (s.includes("rate limit")) {
    return "Muitas mensagens em pouco tempo. Aguarde alguns segundos e tente de novo.";
  }
  if (s.includes("instance") && (s.includes("not connected") || s.includes("disconnected"))) {
    return "A instância do WhatsApp está desconectada. Reconecte em Configurações > WhatsApp.";
  }
  // Circuit breaker é o oposto do caso ambíguo: a requisição NÃO chegou a sair,
  // então aqui podemos afirmar que não foi enviada — e o reenvio é seguro.
  if (s.includes("circuit breaker")) {
    return "O envio foi bloqueado após falhas seguidas do provedor e não chegou a sair. Aguarde cerca de 2 minutos e tente de novo.";
  }
  // Rede final: 5xx/timeout da Uazapi cujo motivo não casou com nenhum caso
  // acima. Entrega indeterminada — vale o mesmo aviso do 463. Fica por último
  // de propósito: "is not on WhatsApp" também chega como 500 e tem tratamento
  // próprio (e determinístico) mais acima.
  if (/uazapi server error 5\d\d/.test(s) || s.includes("timeout") || s.includes("aborted")) {
    return `${PODE_TER_SIDO_ENTREGUE} O provedor não confirmou o envio (falha temporária de comunicação).`;
  }
  return raw;
}

/** Atalho: desembrulha e já traduz. Use nos envios de WhatsApp. */
export async function whatsAppSendErrorMessage(error: unknown): Promise<string> {
  return friendlyWhatsAppSendError(await extractEdgeFunctionError(error));
}
