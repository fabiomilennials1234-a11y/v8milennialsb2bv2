import { withSentry } from '../_shared/sentry.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { logRuntime } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BusinessContext {
  companyName?: string;
  productSummary?: string;
  idealCustomerProfile?: string;
  valueProps?: string;
  customerPains?: string;
}

interface GenerateCustomInstructionsRequest {
  description: string;            // O que o usuário quer corrigir/adicionar
  templateType?: string;          // sdr | qualificador | followup | agendador | prospectador
  businessContext?: BusinessContext;
  existingDos?: string;
  existingDonts?: string;
  forbiddenTopics?: string[];
  objectiveLimits?: string;
}

serve(withSentry('generate-custom-instructions', async (req) => {
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

    const body: GenerateCustomInstructionsRequest = await req.json();
    const {
      description,
      templateType = "sdr",
      businessContext = {},
      existingDos = "",
      existingDonts = "",
      forbiddenTopics = [],
      objectiveLimits = "",
    } = body;

    if (!description || description.trim().length < 10) {
      return new Response(
        JSON.stringify({ error: "Descrição muito curta. Descreva o problema ou ajuste necessário." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Montar contexto adicional
    const contextLines: string[] = [];
    if (businessContext.companyName) contextLines.push(`Empresa: ${businessContext.companyName}`);
    if (businessContext.productSummary) contextLines.push(`Produto/Serviço: ${businessContext.productSummary}`);
    if (businessContext.idealCustomerProfile) contextLines.push(`ICP: ${businessContext.idealCustomerProfile}`);
    if (forbiddenTopics.length > 0) contextLines.push(`Tópicos proibidos já definidos: ${forbiddenTopics.join(", ")}`);
    if (objectiveLimits) contextLines.push(`Limites do objetivo: ${objectiveLimits}`);

    const contextBlock = contextLines.length > 0
      ? `\n\nContexto da empresa e configuração atual:\n${contextLines.join("\n")}`
      : "";

    const existingBlock = (existingDos.trim() || existingDonts.trim())
      ? `\n\nInstruções existentes (preserve e melhore o que já está bom):
${existingDos ? `Do's atuais:\n${existingDos}` : ""}
${existingDonts ? `Don'ts atuais:\n${existingDonts}` : ""}`
      : "";

    const templateLabels: Record<string, string> = {
      sdr: "SDR (agendamento de reuniões)",
      qualificador: "Qualificador de leads",
      followup: "Follow-up e reengajamento",
      agendador: "Confirmação de agendamentos",
      prospectador: "Prospecção outbound",
    };
    const templateLabel = templateLabels[templateType] || templateType;

    const systemPrompt = `Você é um especialista em configuração de agentes de vendas B2B no WhatsApp.
Sua tarefa é gerar instruções personalizadas claras e objetivas para um agente do tipo: ${templateLabel}.${contextBlock}${existingBlock}

Baseado na descrição do problema/ajuste fornecida pelo usuário, gere:
1. "dos": lista de O QUE O AGENTE DEVE FAZER (comportamentos corretos, positivos)
2. "donts": lista de O QUE O AGENTE NUNCA DEVE FAZER (proibições, erros a evitar)

Regras de formato:
- Cada item em uma linha, começando com "- "
- Máximo 8 itens por seção
- Linguagem imperativa, clara e específica
- Não repita instruções que já existem nas seções atuais (a menos que precise melhorá-las)
- Foque no problema descrito pelo usuário

IMPORTANTE: Responda SOMENTE com o JSON abaixo, sem texto antes ou depois, sem blocos de código markdown:
{"dos":"- Instrução 1\n- Instrução 2","donts":"- Instrução 1\n- Instrução 2"}`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": Deno.env.get("OPENROUTER_REFERER_URL") || "https://v8millennials.com",
        "X-Title": "V8 Millennials - Generate Custom Instructions",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Problema/Ajuste: ${description.trim()}` },
        ],
        temperature: 0.6,
        max_tokens: 800,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenRouter error:", errText);
      return new Response(
        JSON.stringify({ error: "Falha ao gerar instruções" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    const rawContent: string = result.choices?.[0]?.message?.content || "";

    console.log("AI raw response:", rawContent.slice(0, 500));

    // Parse JSON da resposta — múltiplas estratégias
    let parsed: { dos?: string; donts?: string } = {};
    let parseOk = false;

    // Estratégia 1: parse direto
    try {
      parsed = JSON.parse(rawContent.trim());
      parseOk = true;
    } catch { /* tentar próxima estratégia */ }

    // Estratégia 2: extrair bloco ```json ... ``` ou ``` ... ```
    if (!parseOk) {
      const codeBlock = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlock) {
        try {
          parsed = JSON.parse(codeBlock[1].trim());
          parseOk = true;
        } catch { /* tentar próxima */ }
      }
    }

    // Estratégia 3: extrair primeiro { ... } do texto
    if (!parseOk) {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
          parseOk = true;
        } catch { /* tentar próxima */ }
      }
    }

    // Estratégia 4: extrair manualmente campos "dos" e "donts" do texto livre
    if (!parseOk) {
      const dosMatch = rawContent.match(/"dos"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/);
      const dontsMatch = rawContent.match(/"donts"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/);
      if (dosMatch || dontsMatch) {
        parsed = {
          dos: dosMatch ? dosMatch[1].replace(/\\n/g, "\n") : "",
          donts: dontsMatch ? dontsMatch[1].replace(/\\n/g, "\n") : "",
        };
        parseOk = true;
      }
    }

    // Estratégia 5: fallback — tratar o texto livre como Don'ts
    if (!parseOk) {
      console.warn("All JSON parse strategies failed, using raw content as donts:", rawContent);
      // Tentar extrair listas do texto
      const lines = rawContent.split("\n").filter((l: string) => l.trim().startsWith("-")).join("\n");
      parsed = { dos: "", donts: lines || rawContent.slice(0, 800) };
    }

    await logRuntime({
      module: "copilot",
      action: "generate_instructions",
      status: "success",
      payloadSnapshot: { templateType },
    });

    return new Response(
      JSON.stringify({
        dos: typeof parsed.dos === "string" ? parsed.dos.replace(/\\n/g, "\n").trim() : "",
        donts: typeof parsed.donts === "string" ? parsed.donts.replace(/\\n/g, "\n").trim() : "",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    await logRuntime({
      module: "copilot",
      action: "generate_instructions",
      status: "error",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
