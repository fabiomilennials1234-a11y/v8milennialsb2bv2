import { withErrorBoundary } from '../_shared/error-boundary.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { requireAuth, AuthError, authErrorResponse } from "../_shared/user-auth.ts";
import { logRuntime } from "../_shared/logger.ts";

interface GenerateExamplesRequest {
  businessContext: {
    companyName?: string;
    productSummary?: string;
    idealCustomerProfile?: string;
    valueProps?: string;
    customerPains?: string;
  };
  templateType: string;
  personality: {
    tone?: string;
    style?: string;
    energy?: string;
  };
  count?: number;
  personaDescription?: string;
  skillsAndTopics?: string;
}

serve(withErrorBoundary('generate-agent-examples', async (req) => {
  const origin = req.headers.get("Origin") ?? undefined;
  const corsHeaders = withSecurityHeaders(getCorsHeaders(origin));

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // AUTH: require an authenticated user — closes unauthenticated denial-of-wallet on the
  // shared OpenRouter key (audit 2026-07-14 #17). No org data is read here.
  try {
    await requireAuth(req);
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e, corsHeaders);
    throw e;
  }

  try {
    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) {
      return new Response(
        JSON.stringify({ error: "OpenRouter API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: GenerateExamplesRequest = await req.json();
    const { businessContext, templateType, personality, personaDescription, skillsAndTopics } = body;
    const count = Math.min(Math.max(body.count || 3, 1), 10);

    if (!businessContext?.productSummary || businessContext.productSummary.length < 20) {
      return new Response(
        JSON.stringify({ error: "productSummary must be at least 20 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const templateDescriptions: Record<string, string> = {
      qualificador: "qualificação de leads via BANT (Budget, Authority, Need, Timeline)",
      sdr: "prospecção ativa e agendamento de reuniões comerciais",
      followup: "reengajamento de leads inativos com abordagens de valor",
      agendador: "confirmação e gestão de reuniões agendadas",
      prospectador: "prospecção cold outreach com mensagens personalizadas",
    };

    const templateDesc = templateDescriptions[templateType] || "vendas B2B";

    // Build persona section
    let personaSection = "";
    if (personaDescription && personaDescription.trim().length > 10) {
      personaSection = `\nPersona do agente (use este tom e estilo):\n${personaDescription.trim()}\n`;
    } else {
      personaSection = `\nTom: ${personality.tone || "profissional"}, Estilo: ${personality.style || "consultivo"}, Energia: ${personality.energy || "moderada"}.\n`;
    }

    // Build skills/topics section
    let skillsSection = "";
    if (skillsAndTopics && skillsAndTopics.trim().length > 10) {
      skillsSection = `\nHabilidades e tópicos do agente:\n${skillsAndTopics.trim()}\n`;
    }

    const exampleWord = count === 1 ? "exemplo" : "exemplos";
    const jsonArrayTemplate = Array.from({ length: count }, () => '{"lead": "...", "agent": "..."}').join(", ");

    const systemPrompt = `Você é um especialista em vendas B2B e WhatsApp marketing.
Gere exatamente ${count} ${exampleWord} de conversa curtos e realistas entre um lead e um agente de IA.

Contexto da empresa:
- Empresa: ${businessContext.companyName || "Não informado"}
- Produto/Serviço: ${businessContext.productSummary}
- Cliente ideal: ${businessContext.idealCustomerProfile || "Empresas B2B"}
- Proposta de valor: ${businessContext.valueProps || "Não informado"}
- Dores que resolve: ${businessContext.customerPains || "Não informado"}

O agente é do tipo "${templateType}" — especializado em ${templateDesc}.
${personaSection}${skillsSection}
REGRAS:
- Cada exemplo deve ter 1 mensagem do lead e 1 resposta do agente
- Use o nome da empresa e produto reais
- Mantenha o tom e estilo indicados
- Cada exemplo deve cobrir um cenário diferente (ex: primeiro contato, objeção, interesse, dúvida técnica, pedido de preço)
- Mensagens curtas como no WhatsApp (1-3 frases cada)
- Gere exatamente ${count} ${exampleWord}

Responda APENAS em JSON válido, sem markdown:
{"examples": [${jsonArrayTemplate}]}`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": Deno.env.get("OPENROUTER_REFERER_URL") || "https://v8millennials.com",
        "X-Title": "V8 Millennials - Generate Examples",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Gere os ${count} ${exampleWord} de conversa agora.` },
        ],
        temperature: 0.7,
        max_tokens: 300 * count,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("OpenRouter error:", error);
      return new Response(
        JSON.stringify({ error: "Failed to generate examples" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || "";

    // Parse JSON from response (handle potential markdown wrapping)
    let parsed: { examples: Array<{ lead: string; agent: string }> };
    try {
      const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error("Failed to parse LLM response:", content);
      return new Response(
        JSON.stringify({ error: "Failed to parse generated examples", raw: content }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await logRuntime({
      module: "copilot",
      action: "generate_examples",
      status: "success",
      payloadSnapshot: { templateType, count, generatedCount: (parsed.examples || []).length },
    });

    return new Response(
      JSON.stringify({ examples: parsed.examples || [] }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    await logRuntime({
      module: "copilot",
      action: "generate_examples",
      status: "error",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
