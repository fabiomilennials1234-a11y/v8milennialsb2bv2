/**
 * Context Extractor — LLM-based conversation context extraction (background).
 *
 * Replaces keyword-based objection detection with intelligent extraction.
 * Runs AFTER copilot responds, fire-and-forget. Results available next turn.
 */

export interface ExtractedContext {
  objections: string[];
  intent: string;
  sentiment: "cold" | "warm" | "hot";
  collected_info: Record<string, string>;
  suggested_next_action: string;
}

interface LlmClient {
  chat(request: {
    model: string;
    messages: Array<{ role: string; content: string | null }>;
    max_tokens?: number;
    temperature?: number;
  }): Promise<{ choices: Array<{ message: { content: string | null } }> }>;
}

const EXTRACTION_PROMPT = `Analise a conversa abaixo entre um vendedor (assistant) e um lead (user).
Extraia um JSON com exatamente estes campos:
- objections: array de objeções reais do lead (strings curtas)
- intent: string — "buying" | "exploring" | "comparing" | "complaining" | "returning" | "unknown"
- sentiment: "cold" | "warm" | "hot"
- collected_info: objeto com informações coletadas (empresa, cargo, necessidade, orçamento, timeline, etc.)
- suggested_next_action: string curta com próxima ação recomendada pro vendedor

Retorne APENAS o JSON, sem markdown, sem explicação.`;

export async function extractConversationContext(
  messages: Array<{ role: string; content: string }>,
  llmClient: LlmClient,
): Promise<ExtractedContext | null> {
  if (!messages || messages.length === 0) return null;

  try {
    const conversationText = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const response = await llmClient.chat({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: EXTRACTION_PROMPT },
        { role: "user", content: conversationText },
      ],
      max_tokens: 512,
      temperature: 0.2,
    });

    const raw = response.choices?.[0]?.message?.content;
    if (!raw) return null;

    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned) as ExtractedContext;

    if (!Array.isArray(parsed.objections) || !parsed.intent || !parsed.sentiment) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}
