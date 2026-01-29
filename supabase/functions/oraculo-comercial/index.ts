import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MetricsData {
  role: "sdr" | "closer";
  // SDR metrics
  confirmados?: number;
  metaReuniao?: number;
  percentualMeta?: number;
  // Closer metrics
  faturamento?: number;
  metaVendas?: number;
  totalGanhos?: number;
  numeroVendas?: number;
  // Common
  diaDoMes?: number;
  diasRestantes?: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { metrics } = await req.json() as { metrics: MetricsData };
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const systemPrompt = `Você é um coach comercial direto e pragmático. Você analisa métricas e dá UMA única tarefa prioritária do dia.

REGRAS:
- Responda APENAS em formato JSON válido
- Seja direto e específico
- Foque no problema mais urgente
- Dê uma tarefa prática e executável
- Use linguagem informal e motivadora
- Limite a 2 frases curtas no máximo por campo

FORMATO OBRIGATÓRIO (JSON):
{
  "problema": "frase curta descrevendo o problema principal",
  "tarefa": "ação específica e prática para resolver"
}`;

    let userPrompt = "";

    if (metrics.role === "sdr") {
      const progresso = metrics.percentualMeta || 0;
      const confirmados = metrics.confirmados || 0;
      const meta = metrics.metaReuniao || 20;
      const diasRestantes = metrics.diasRestantes || 15;
      const faltam = meta - confirmados;

      userPrompt = `Métricas do SDR:
- Confirmados no mês: ${confirmados}
- Meta de reuniões: ${meta}
- Progresso: ${progresso.toFixed(0)}%
- Faltam: ${faltam} reuniões
- Dias restantes no mês: ${diasRestantes}
- Média necessária: ${(faltam / diasRestantes).toFixed(1)} confirmações/dia

Qual o problema principal e qual a tarefa prioritária de hoje?`;
    } else {
      const faturamento = metrics.faturamento || 0;
      const meta = metrics.metaVendas || 10000;
      const progresso = metrics.percentualMeta || 0;
      const diasRestantes = metrics.diasRestantes || 15;
      const vendas = metrics.numeroVendas || 0;
      const falta = meta - faturamento;

      userPrompt = `Métricas do Closer:
- Faturamento no mês: R$ ${faturamento.toLocaleString("pt-BR")}
- Meta de vendas: R$ ${meta.toLocaleString("pt-BR")}
- Progresso: ${progresso.toFixed(0)}%
- Faltam: R$ ${falta.toLocaleString("pt-BR")}
- Número de vendas: ${vendas}
- Dias restantes no mês: ${diasRestantes}

Qual o problema principal e qual a tarefa prioritária de hoje?`;
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Tente novamente em alguns segundos." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Créditos insuficientes. Adicione créditos ao workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Parse JSON from response
    let result = { problema: "", tarefa: "" };
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error("Failed to parse AI response:", content);
      result = {
        problema: "Não consegui analisar as métricas",
        tarefa: "Revise seu pipeline e priorize follow-ups pendentes",
      };
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("oraculo-comercial error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
