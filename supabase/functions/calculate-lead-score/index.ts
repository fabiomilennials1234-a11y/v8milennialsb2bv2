import { withSentry } from '../_shared/sentry.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";
import { logRuntime } from "../_shared/logger.ts";
import { getPipeEntriesByLeads } from "../_shared/pipeline-adapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LeadData {
  id: string;
  name: string;
  company: string | null;
  origin: string;
  faturamento: string | null;
  urgency: string | null;
  segment: string | null;
  rating: number;
  created_at: string;
  phone: string | null;
  email: string | null;
  organization_id: string;
}

interface PipeData {
  whatsapp_status?: string;
  confirmacao_status?: string;
  proposta_status?: string;
  meeting_date?: string;
  calor?: number;
}

interface HistoryData {
  total_interactions: number;
  last_interaction?: string;
}

serve(withSentry('calculate-lead-score', async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { lead_id, batch } = await req.json();
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
    const referer = Deno.env.get("OPENROUTER_REFERER_URL") || "https://v8millennials.com";

    if (!openRouterApiKey) {
      throw new Error("OPENROUTER_API_KEY is not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get leads to process
    let leadsQuery = supabase
      .from("leads")
      .select("id, name, company, origin, faturamento, urgency, segment, rating, created_at, phone, email, organization_id");

    if (lead_id) {
      leadsQuery = leadsQuery.eq("id", lead_id);
    } else if (batch) {
      // Get leads without recent scores (older than 24h or no score)
      const { data: recentScores } = await supabase
        .from("lead_scores")
        .select("lead_id")
        .gte("last_calculated", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      const recentLeadIds = recentScores?.map(s => s.lead_id) || [];
      
      if (recentLeadIds.length > 0) {
        leadsQuery = leadsQuery.not("id", "in", `(${recentLeadIds.join(",")})`);
      }
      leadsQuery = leadsQuery.limit(20); // Process 20 at a time
    }

    const { data: leads, error: leadsError } = await leadsQuery;

    if (leadsError) throw leadsError;
    if (!leads || leads.length === 0) {
      return new Response(
        JSON.stringify({ message: "No leads to process", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results = [];

    // Batch queries: fetch all pipe/history data via pipeline adapter
    const leadIds = (leads as LeadData[]).map(l => l.id);

    // Group leads by org for adapter calls (adapter requires orgId)
    const orgLeadIds = new Map<string, string[]>();
    for (const lead of leads as LeadData[]) {
      const ids = orgLeadIds.get(lead.organization_id) || [];
      ids.push(lead.id);
      orgLeadIds.set(lead.organization_id, ids);
    }

    // Fetch pipeline entries per org in parallel, then merge into lookup maps
    const whatsappMap = new Map<string, { stage_key: string; metadata: Record<string, unknown> }>();
    const confirmacaoMap = new Map<string, { stage_key: string; metadata: Record<string, unknown> }>();
    const propostaMap = new Map<string, { stage_key: string; metadata: Record<string, unknown> }>();

    const pipePromises: Promise<void>[] = [];
    for (const [orgId, ids] of orgLeadIds) {
      pipePromises.push(
        Promise.all([
          getPipeEntriesByLeads(supabase, ids, orgId, "whatsapp"),
          getPipeEntriesByLeads(supabase, ids, orgId, "confirmacao"),
          getPipeEntriesByLeads(supabase, ids, orgId, "propostas"),
        ]).then(([wa, conf, prop]) => {
          for (const e of wa) {
            if (!whatsappMap.has(e.lead_id)) whatsappMap.set(e.lead_id, e);
          }
          for (const e of conf) {
            if (!confirmacaoMap.has(e.lead_id)) confirmacaoMap.set(e.lead_id, e);
          }
          for (const e of prop) {
            if (!propostaMap.has(e.lead_id)) propostaMap.set(e.lead_id, e);
          }
        }),
      );
    }

    const allHistory = await supabase.from("lead_history").select("lead_id, id, created_at").in("lead_id", leadIds).order("created_at", { ascending: false });
    await Promise.all(pipePromises);

    // Group history entries by lead_id (already ordered by created_at desc from query)
    const historyMap = new Map<string, { id: string; created_at: string }[]>();
    for (const row of allHistory.data || []) {
      if (!historyMap.has(row.lead_id)) historyMap.set(row.lead_id, []);
      historyMap.get(row.lead_id)!.push(row);
    }

    for (const lead of leads as LeadData[]) {
      // Lookup from pre-fetched Maps
      const whatsappData = whatsappMap.get(lead.id);
      const confirmacaoData = confirmacaoMap.get(lead.id);
      const propostaData = propostaMap.get(lead.id);
      const historyEntries = historyMap.get(lead.id) || [];

      const pipeData: PipeData = {
        whatsapp_status: whatsappData?.stage_key,
        confirmacao_status: confirmacaoData?.stage_key,
        proposta_status: propostaData?.stage_key,
        meeting_date: confirmacaoData?.metadata?.meeting_date as string | undefined,
        calor: propostaData?.metadata?.calor as number | undefined,
      };

      const historyData: HistoryData = {
        total_interactions: historyEntries.length,
        last_interaction: historyEntries[0]?.created_at,
      };

      // Calculate days since creation
      const daysSinceCreation = Math.floor(
        (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24)
      );

      // Days until meeting
      let daysUntilMeeting: number | null = null;
      if (pipeData.meeting_date) {
        daysUntilMeeting = Math.floor(
          (new Date(pipeData.meeting_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );
      }

      // Build context for AI
      const leadContext = `
Lead: ${lead.name}
Empresa: ${lead.company || "Não informado"}
Origem: ${lead.origin}
Faturamento: ${lead.faturamento || "Não informado"}
Urgência: ${lead.urgency || "Não informado"}
Segmento: ${lead.segment || "Não informado"}
Rating: ${lead.rating}/5
Dias desde criação: ${daysSinceCreation}
Telefone: ${lead.phone ? "Sim" : "Não"}
Email: ${lead.email ? "Sim" : "Não"}

Pipeline:
- WhatsApp: ${pipeData.whatsapp_status || "Não iniciado"}
- Confirmação: ${pipeData.confirmacao_status || "Não iniciado"}
- Proposta: ${pipeData.proposta_status || "Não iniciado"}
- Calor da proposta: ${pipeData.calor ? `${pipeData.calor}/10` : "N/A"}
- Dias até reunião: ${daysUntilMeeting !== null ? daysUntilMeeting : "Sem reunião"}

Histórico:
- Total de interações: ${historyData.total_interactions}
- Última interação: ${historyData.last_interaction ? new Date(historyData.last_interaction).toLocaleDateString("pt-BR") : "Nunca"}
`;

      const systemPrompt = `Você é um analista de vendas especializado em scoring de leads B2B.
Analise o lead fornecido e retorne um JSON com:
1. score: número de 0 a 100 representando a qualidade/probabilidade de conversão
2. predicted_conversion: porcentagem de 0 a 100 de chance de fechar
3. factors: objeto com os principais fatores que influenciaram o score (positivos e negativos)
4. recommended_action: string com a próxima ação recomendada para este lead

Critérios de pontuação:
- Faturamento alto = +20 pontos
- Urgência alta = +15 pontos
- Origin calendly (agendou reunião) = +10 pontos
- Rating alto = +5 por estrela
- Muitas interações = +10 pontos
- Lead antigo sem progresso = -20 pontos
- Sem telefone/email = -10 pontos
- Reunião próxima = +15 pontos
- Calor alto na proposta = +20 pontos

IMPORTANTE: Responda APENAS com JSON válido, sem texto adicional.`;

      const userPrompt = `Analise este lead e gere o scoring:\n${leadContext}`;

      const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openRouterApiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": referer,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.5,
          max_tokens: 400,
        }),
      });

      if (!aiResponse.ok) {
        if (aiResponse.status === 429) {
          console.error("Rate limited, stopping batch");
          break;
        }
        console.error(`AI error for lead ${lead.id}:`, await aiResponse.text());
        continue;
      }

      const aiData = await aiResponse.json();
      const content = aiData.choices?.[0]?.message?.content || "";

      // Parse JSON from response
      let scoreData;
      try {
        // Try to extract JSON from the response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          scoreData = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("No JSON found");
        }
      } catch (parseError) {
        console.error(`Failed to parse AI response for lead ${lead.id}:`, content);
        // Use default values
        scoreData = {
          score: 50,
          predicted_conversion: 30,
          factors: { erro: "Não foi possível analisar" },
          recommended_action: "Revisar lead manualmente",
        };
      }

      // Ensure values are within bounds
      const score = Math.max(0, Math.min(100, scoreData.score || 50));
      const predictedConversion = Math.max(0, Math.min(100, scoreData.predicted_conversion || 30));

      // Upsert score
      const { error: upsertError } = await supabase
        .from("lead_scores")
        .upsert({
          lead_id: lead.id,
          score,
          factors: scoreData.factors || {},
          predicted_conversion: predictedConversion,
          recommended_action: scoreData.recommended_action || null,
          last_calculated: new Date().toISOString(),
        }, {
          onConflict: "lead_id",
        });

      if (upsertError) {
        console.error(`Failed to save score for lead ${lead.id}:`, upsertError);
        continue;
      }

      results.push({
        lead_id: lead.id,
        name: lead.name,
        score,
        predicted_conversion: predictedConversion,
        recommended_action: scoreData.recommended_action,
      });
    }

    await logRuntime({
      module: "copilot",
      action: "calculate_score",
      status: "success",
      payloadSnapshot: { processed: results.length, leadIds: leadIds.slice(0, 5) },
    });

    return new Response(
      JSON.stringify({
        message: "Scores calculated successfully",
        processed: results.length,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error calculating lead scores:", error);
    await logRuntime({
      module: "copilot",
      action: "calculate_score",
      status: "error",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
