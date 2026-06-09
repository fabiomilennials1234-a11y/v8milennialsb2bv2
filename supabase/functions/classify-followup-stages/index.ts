import { withSentry } from "../_shared/sentry.ts";
/**
 * AI Stage Classifier (ADR-0006 amendment).
 *
 * Reads an Organization's funnel stages (by NAME — the stage_key is desynced
 * legacy noise) and asks an LLM to map each to a canonical situation role. The
 * deterministic buildTriggerStageMap then turns that into per-Situation
 * trigger_stage_keys (with a hard terminal override), upserted into
 * copilot_followup_situation_config without touching is_active or tuning.
 *
 * Triggered on-demand (admin) or on funnel change (#745). x-cron-secret /
 * service-role auth + organization_id in the body.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { OpenRouterClient } from "../agent-message/openrouter-client.ts";
import { buildTriggerStageMap, type StageInfo, type StageRole } from "../_shared/copilot/followup-stage-classifier.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";

const VALID_ROLES: StageRole[] = [
  "novo", "qualificado", "proposta_ativa", "frio", "reuniao", "no_show", "ganho", "perdido",
];

interface StageRow {
  stage_key: string;
  name: string;
  position: number;
  is_final_positive: boolean;
  is_final_negative: boolean;
  pipeline_type: string;
}

function buildPrompt(stages: StageRow[]): string {
  const lines = stages.map((s) =>
    `- pipe=${s.pipeline_type} key=${s.stage_key} nome="${s.name}" posição=${s.position}` +
    (s.is_final_positive ? " [GANHO]" : "") + (s.is_final_negative ? " [PERDIDO]" : ""),
  );
  return [
    "Você classifica etapas de funil de vendas B2B em papéis canônicos para follow-up automático.",
    "Para CADA etapa, escolha UM papel pelo NOME da etapa (o key é legado, ignore-o como significado):",
    "- novo: lead novo/recém-chegado, ainda não respondeu",
    "- qualificado: lead qualificado, aguardando agendar conversa/reunião",
    "- proposta_ativa: proposta/orçamento enviado, negociação ativa (somente pipe=propostas)",
    "- reuniao: reunião/ligação marcada (somente pipe=whatsapp)",
    "- no_show: não compareceu / faltou",
    "- frio: nutrição contínua, parado, esfriou, futuro, reativação",
    "- ganho: venda fechada (terminal)",
    "- perdido: perdido/desqualificado (terminal)",
    "Etapas marcadas [GANHO]/[PERDIDO] são terminais.",
    "",
    "Etapas:",
    ...lines,
    "",
    'Responda APENAS um JSON objeto {"<stage_key>":"<papel>", ...}. Sem texto extra.',
  ].join("\n");
}

function parseClassification(raw: string, validKeys: Set<string>): Record<string, StageRole> {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return {};
  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return {};
  }
  const out: Record<string, StageRole> = {};
  for (const [key, role] of Object.entries(parsed)) {
    if (validKeys.has(key) && (VALID_ROLES as string[]).includes(role)) {
      out[key] = role as StageRole;
    }
  }
  return out;
}

Deno.serve(withSentry("classify-followup-stages", async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const cronSecret = req.headers.get("x-cron-secret");
  if (!CRON_SECRET || !cronSecret || !timingSafeCompare(cronSecret, CRON_SECRET)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const organizationId = body.organization_id as string | undefined;
  if (!organizationId) {
    return new Response(JSON.stringify({ error: "organization_id required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: stages } = await supabase
    .from("pipeline_stages")
    .select("stage_key, name, position, is_final_positive, is_final_negative, pipeline_type")
    .eq("organization_id", organizationId)
    .in("pipeline_type", ["whatsapp", "propostas"])
    .eq("is_active", true);

  if (!stages?.length) {
    return new Response(JSON.stringify({ classified: 0, situations: {} }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!OPENROUTER_API_KEY) {
    return new Response(JSON.stringify({ error: "OPENROUTER_API_KEY missing" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const openRouter = new OpenRouterClient(OPENROUTER_API_KEY);
  const response = await openRouter.chat({
    model: Deno.env.get("OPENROUTER_DEFAULT_MODEL") || "google/gemini-2.5-flash",
    messages: [{ role: "user", content: buildPrompt(stages as StageRow[]) }],
    max_tokens: 800,
    temperature: 0,
  });

  const raw = response?.choices?.[0]?.message?.content ?? "";
  const validKeys = new Set((stages as StageRow[]).map((s) => s.stage_key));
  const classification = parseClassification(raw, validKeys);

  const stageInfos: StageInfo[] = (stages as StageRow[]).map((s) => ({
    stageKey: s.stage_key,
    name: s.name,
    position: s.position,
    isFinalPositive: s.is_final_positive,
    isFinalNegative: s.is_final_negative,
  }));

  const situationMap = buildTriggerStageMap({ stages: stageInfos, classification });

  // Upsert trigger_stage_keys per situation WITHOUT touching is_active / tuning.
  for (const [situationId, stageKeys] of Object.entries(situationMap)) {
    await supabase
      .from("copilot_followup_situation_config")
      .upsert(
        { organization_id: organizationId, situation_id: situationId, trigger_stage_keys: stageKeys },
        { onConflict: "organization_id,situation_id", ignoreDuplicates: false },
      );
  }

  return new Response(JSON.stringify({ classified: Object.keys(classification).length, situations: situationMap }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}));
