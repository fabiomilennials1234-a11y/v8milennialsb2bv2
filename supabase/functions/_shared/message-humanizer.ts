/**
 * Message Humanizer — Gera variações naturais de mensagens para evitar
 * banimento por mensagens repetitivas no WhatsApp.
 *
 * Usa OpenRouter (modelo leve e rápido) para reescrever a mensagem
 * mantendo o mesmo sentido, tom e variáveis já substituídas.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Modelo rápido e barato para reescrita simples */
const HUMANIZER_MODEL = "openai/gpt-4.1-mini";

const SYSTEM_PROMPT = `Você é um reescritor de mensagens de WhatsApp comercial.

REGRAS OBRIGATÓRIAS:
1. Reescreva a mensagem mantendo EXATAMENTE o mesmo sentido e intenção
2. Mude a estrutura da frase, sinônimos e ordem das ideias
3. Mantenha o mesmo tom (profissional, casual, etc.) e nível de formalidade
4. Mantenha a mensagem curta e natural para WhatsApp (não aumente o tamanho)
5. NÃO adicione emojis que não existiam no original
6. NÃO remova emojis que existiam no original (pode reposicionar)
7. NÃO invente informações novas — use apenas o que está na mensagem
8. NÃO adicione saudações extras (bom dia, boa tarde) se não existiam
9. Preserve nomes próprios, empresas e dados específicos exatamente como estão
10. Responda APENAS com a mensagem reescrita, sem explicações

A variação deve ser sutil mas suficiente para que duas mensagens lado a lado
pareçam escritas por uma pessoa real, não copiadas de um template.`;

/**
 * Humaniza uma mensagem gerando uma variação natural.
 * Se falhar (API indisponível, timeout, etc.), retorna a mensagem original.
 */
export async function humanizeMessage(
  originalMessage: string,
): Promise<string> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) {
    console.warn("[message-humanizer] OPENROUTER_API_KEY not set, skipping");
    return originalMessage;
  }

  // Mensagens muito curtas (< 20 chars) não precisam de variação
  if (originalMessage.trim().length < 20) {
    return originalMessage;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": Deno.env.get("OPENROUTER_REFERER_URL") || "https://v8millennials.com",
        "X-Title": "V8 Millennials Message Humanizer",
      },
      body: JSON.stringify({
        model: HUMANIZER_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: originalMessage },
        ],
        temperature: 0.9,
        max_tokens: 300,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.text();
      console.error("[message-humanizer] API error:", response.status, err);
      return originalMessage;
    }

    const data = await response.json();
    const rewritten = data?.choices?.[0]?.message?.content?.trim();

    if (!rewritten || rewritten.length < 10) {
      console.warn("[message-humanizer] Empty/short response, using original");
      return originalMessage;
    }

    // Sanity check: se a resposta for idêntica ao original, retorna original
    if (rewritten === originalMessage) {
      return originalMessage;
    }

    console.log(
      "[message-humanizer] OK |",
      originalMessage.substring(0, 40) + "...",
      "->",
      rewritten.substring(0, 40) + "...",
    );

    return rewritten;
  } catch (error) {
    // Timeout, network error, etc. — não bloqueia o envio
    console.error("[message-humanizer] Error (using original):", String(error));
    return originalMessage;
  }
}
