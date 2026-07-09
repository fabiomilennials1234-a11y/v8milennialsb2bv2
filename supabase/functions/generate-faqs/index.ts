import { withErrorBoundary } from '../_shared/error-boundary.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { logRuntime } from "../_shared/logger.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";

interface BusinessContextInput {
  companyName?: string;
  productSummary?: string;
  idealCustomerProfile?: string;
  valueProps?: string;
  customerPains?: string;
  primaryCta?: string;
}

interface GenerateFaqsRequest {
  businessContext: BusinessContextInput;
  templateType?: string;
  count?: number; // quantas FAQs gerar (padrão: 6)
}

interface FaqItem {
  question: string;
  answer: string;
}

serve(withErrorBoundary('generate-faqs', async (req) => {
  const origin = req.headers.get("Origin") ?? undefined;
  const corsHeaders = withSecurityHeaders(getCorsHeaders(origin));

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

    const body: GenerateFaqsRequest = await req.json();
    const { businessContext, templateType = "sdr", count = 6 } = body;

    if (!businessContext || !businessContext.companyName) {
      return new Response(
        JSON.stringify({ error: "businessContext.companyName is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const safeCount = Math.min(Math.max(Number(count) || 6, 3), 12);

    const templateDescriptions: Record<string, string> = {
      qualificador: "qualificação de leads B2B via BANT",
      sdr: "prospecção ativa e agendamento de reuniões comerciais B2B",
      followup: "reengajamento de leads inativos",
      agendador: "confirmação e redução de no-show em reuniões",
      prospectador: "prospecção cold outreach personalizada",
    };

    const templateDesc = templateDescriptions[templateType] || "vendas B2B";

    // Montar bloco de contexto com o que tiver preenchido
    const contextParts: string[] = [];
    if (businessContext.companyName) contextParts.push(`Empresa: ${businessContext.companyName}`);
    if (businessContext.productSummary) contextParts.push(`Produto/serviço: ${businessContext.productSummary}`);
    if (businessContext.idealCustomerProfile) contextParts.push(`Cliente ideal: ${businessContext.idealCustomerProfile}`);
    if (businessContext.valueProps) contextParts.push(`Diferenciais: ${businessContext.valueProps}`);
    if (businessContext.customerPains) contextParts.push(`Dores resolvidas: ${businessContext.customerPains}`);
    if (businessContext.primaryCta) contextParts.push(`Próximo passo: ${businessContext.primaryCta}`);

    const contextBlock = contextParts.join("\n");

    const prompt = `Você é um especialista em vendas B2B e atendimento ao cliente.

Contexto do negócio:
${contextBlock}

Tipo de agente: ${templateDesc}

Gere exatamente ${safeCount} perguntas frequentes (FAQs) que prospects e leads fazem durante uma conversa de ${templateDesc} com a empresa "${businessContext.companyName}".

Regras:
- As perguntas devem ser dúvidas REAIS que clientes fazem durante a prospecção/venda
- As respostas devem ser diretas, persuasivas e alinhadas com os diferenciais da empresa
- Cada resposta deve ter entre 1 e 3 frases
- NÃO inclua FAQs sobre suporte técnico, devoluções ou pós-venda
- Priorize dúvidas sobre preço, prazo, diferencial, como funciona, cases, próximos passos

Responda APENAS com um array JSON válido neste formato exato (sem markdown, sem explicações):
[{"question":"texto","answer":"texto"},{"question":"texto","answer":"texto"}]

Os valores devem ser STRINGS simples.`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": Deno.env.get("OPENROUTER_REFERER_URL") || "https://v8millennials.com",
        "X-Title": "V8 Millennials - Generate FAQs",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.6,
        max_tokens: 1200,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenRouter error:", response.status, errText);
      return new Response(
        JSON.stringify({ error: `OpenRouter error: ${response.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || "";

    if (!content) {
      return new Response(
        JSON.stringify({ error: "Empty response from AI model" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extrair o array JSON da resposta
    let rawJson = content
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();

    const arrayMatch = rawJson.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      rawJson = arrayMatch[0];
    }

    let parsed: FaqItem[];
    try {
      parsed = JSON.parse(rawJson);
      if (!Array.isArray(parsed)) throw new Error("Not an array");
    } catch {
      console.error("Failed to parse LLM response:", content);
      return new Response(
        JSON.stringify({ error: "Failed to parse AI response", raw: content.slice(0, 200) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalizar e filtrar itens válidos
    const faqs = parsed
      .filter((item) => item?.question && item?.answer)
      .map((item) => ({
        question: String(item.question).trim(),
        answer: String(item.answer).trim(),
      }))
      .slice(0, safeCount);

    await logRuntime({
      module: "copilot",
      action: "generate_faqs",
      status: "success",
      payloadSnapshot: { companyName: businessContext.companyName, templateType, faqCount: faqs.length },
    });

    return new Response(
      JSON.stringify({ faqs }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Unhandled error:", error);
    await logRuntime({
      module: "copilot",
      action: "generate_faqs",
      status: "error",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
