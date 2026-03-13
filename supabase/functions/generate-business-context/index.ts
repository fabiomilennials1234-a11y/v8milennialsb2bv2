import { withSentry } from '../_shared/sentry.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { logRuntime } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GenerateBusinessContextRequest {
  companyName: string;
  templateType?: string;
  description?: string; // contexto fornecido pelo usuário (o que a empresa faz)
  segment?: string;     // segmento de mercado (opcional)
}

/** Garante que o valor seja string (converte arrays em texto) */
function ensureString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(". ");
  if (value != null) return String(value);
  return "";
}

serve(withSentry('generate-business-context', async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) {
      return new Response(
        JSON.stringify({ error: "OpenRouter API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: GenerateBusinessContextRequest = await req.json();
    const { companyName, templateType = "sdr", description, segment } = body;

    if (!companyName || companyName.trim().length < 2) {
      return new Response(
        JSON.stringify({ error: "companyName is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const templateDescriptions: Record<string, string> = {
      qualificador: "qualificação de leads B2B via BANT",
      sdr: "prospecção ativa e agendamento de reuniões comerciais B2B",
      followup: "reengajamento de leads inativos",
      agendador: "confirmação e redução de no-show em reuniões",
      prospectador: "prospecção cold outreach personalizada",
    };

    const templateDesc = templateDescriptions[templateType] || "vendas B2B";
    const safeCompanyName = companyName.trim();

    // Bloco de contexto adicional fornecido pelo usuário
    const contextLines: string[] = [];
    if (description && description.trim().length > 5) {
      contextLines.push(`Descrição do produto/serviço: ${description.trim()}`);
    }
    if (segment && segment.trim().length > 2) {
      contextLines.push(`Segmento de mercado: ${segment.trim()}`);
    }
    const contextBlock = contextLines.length > 0
      ? `\n\nContexto adicional fornecido pelo usuário:\n${contextLines.join("\n")}`
      : "";

    const prompt = `Você é um especialista em marketing B2B e vendas consultivas.

Gere um contexto de negócio completo para um agente de IA de ${templateDesc} da empresa chamada "${safeCompanyName}".${contextBlock}

${contextBlock ? "Use o contexto adicional acima como base principal para gerar informações precisas e relevantes." : "Infira o contexto de negócio mais provável com base no nome da empresa."}

Responda APENAS com um objeto JSON válido neste formato exato (sem markdown, sem explicações):
{"productSummary":"texto aqui","idealCustomerProfile":"texto aqui","valueProps":"texto aqui","customerPains":"texto aqui","primaryCta":"texto aqui","serviceRegion":"Brasil","socialProof":"texto aqui"}

Regras:
- productSummary: 1-2 frases sobre o produto/serviço principal (minimo 30 chars)
- idealCustomerProfile: descrição do cliente ideal (minimo 30 chars)
- valueProps: 2-3 diferenciais separados por ponto e vírgula (minimo 30 chars)
- customerPains: 2-3 dores resolvidas separadas por ponto e vírgula (minimo 20 chars)
- primaryCta: próximo passo (ex: Agendar demonstração gratuita)
- serviceRegion: região de atendimento
- socialProof: número de clientes ou cases (se não souber, use algo plausível)
- Todos os valores devem ser STRINGS simples (nunca arrays ou objetos)
- Use o nome "${safeCompanyName}" no contexto`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": Deno.env.get("OPENROUTER_REFERER_URL") || "https://v8millennials.com",
        "X-Title": "V8 Millennials - Generate Business Context",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.5,
        max_tokens: 700,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenRouter error status:", response.status, errText);
      return new Response(
        JSON.stringify({ error: `OpenRouter error: ${response.status}`, detail: errText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || "";

    if (!content) {
      console.error("Empty content from LLM");
      return new Response(
        JSON.stringify({ error: "Empty response from AI model" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extrair JSON do conteúdo (remove markdown se houver)
    let rawJson = content
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();

    // Tenta encontrar o objeto JSON dentro da resposta
    const jsonMatch = rawJson.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      rawJson = jsonMatch[0];
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      console.error("Failed to parse LLM response:", content);
      return new Response(
        JSON.stringify({ error: "Failed to parse AI response", raw: content.slice(0, 200) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalizar todos os campos para string (o modelo às vezes retorna arrays)
    const businessContext = {
      companyName: safeCompanyName,
      productSummary: ensureString(parsed.productSummary),
      idealCustomerProfile: ensureString(parsed.idealCustomerProfile),
      valueProps: ensureString(parsed.valueProps),
      customerPains: ensureString(parsed.customerPains),
      primaryCta: ensureString(parsed.primaryCta),
      serviceRegion: ensureString(parsed.serviceRegion),
      socialProof: ensureString(parsed.socialProof),
    };

    await logRuntime({
      module: "copilot",
      action: "generate_context",
      status: "success",
      payloadSnapshot: { companyName: safeCompanyName, templateType },
    });

    return new Response(
      JSON.stringify({ businessContext }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Unhandled error:", error);
    await logRuntime({
      module: "copilot",
      action: "generate_context",
      status: "error",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
