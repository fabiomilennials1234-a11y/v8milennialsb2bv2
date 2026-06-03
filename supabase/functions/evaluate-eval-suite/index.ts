/**
 * evaluate-eval-suite — Copilot v2 eval-suite endpoint (Slice 9). 🔒
 *
 * Thin wrapper over runEvalSuite. Loads the org's enabled eval cases (RLS-scoped
 * via the user client), pre-resolves each archetype's saved agent config + rubric,
 * runs the pure runner with the REAL per-archetype model (the eval is faithful;
 * response caching per (case,model) is a follow-up), and returns PASS/FAIL/SKIP
 * per case. Org NEVER from payload. Persisting results to copilot_v2_eval_runs is
 * a follow-up (service_role write); MVP returns the summary for the UI.
 *
 * Pattern: Deno.serve(withSentry) + withSecurityHeaders + OPTIONS. verify_jwt=false.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { createOpenRouterClient } from "../_shared/copilot-v2/openrouter-client.ts";
import { resolveAgentCapabilities } from "../_shared/copilot-v2/capability-gate.ts";
import { mergeFromPersistence, toAgentConfig } from "../_shared/copilot-v2/config-schema.ts";
import { loadEvalCases } from "../_shared/copilot-v2/eval-cases-loader.ts";
import { runEvalSuite, type AgentResolved } from "../_shared/copilot-v2/eval-runner.ts";
import type { Archetype, ModelId } from "../_shared/copilot-v2/model-selector.ts";

serve(
  withSentry("evaluate-eval-suite", async (req: Request) => {
    const cors = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    const json = (b: unknown, s = 200) =>
      new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // empty body is fine (run all archetypes)
    }
    const archetypeFilter: Archetype | undefined = body?.archetype;

    const cases = await loadEvalCases(supabase, archetypeFilter);

    // Pre-resolve each needed archetype's saved agent config (agentFor is sync).
    const needed = [...new Set(cases.map((c) => c.archetype))];
    const agents: Partial<Record<Archetype, AgentResolved | null>> = {};
    for (const a of needed) {
      const { data: agent } = await supabase
        .from("copilot_v2_agents")
        .select("id")
        .eq("archetype", a)
        .maybeSingle();
      if (!agent?.id) {
        agents[a] = null;
        continue;
      }
      const [{ data: cfg }, { data: rub }] = await Promise.all([
        supabase.from("copilot_v2_config").select("slots, escape_hatch_notes").eq("agent_id", agent.id).maybeSingle(),
        supabase.from("copilot_v2_rubric").select("rules").eq("agent_id", agent.id).maybeSingle(),
      ]);
      const slots = (cfg?.slots as Record<string, unknown>) ?? {};
      agents[a] = {
        config: toAgentConfig(mergeFromPersistence(slots as any, cfg?.escape_hatch_notes ?? null)),
        capabilities: resolveAgentCapabilities(slots),
        rubricRules: Array.isArray(rub?.rules) ? (rub?.rules as AgentResolved["rubricRules"]) : undefined,
      };
    }

    const results = await runEvalSuite(cases, {
      agentFor: (a) => agents[a] ?? null,
      makeLlm: (model: ModelId) => createOpenRouterClient({ model, temperature: 0, maxTokens: 1024 }),
    });

    const summary = {
      total: results.length,
      pass: results.filter((r) => r.status === "pass").length,
      fail: results.filter((r) => r.status === "fail").length,
      skip: results.filter((r) => r.status === "skip").length,
      error: results.filter((r) => r.status === "error").length,
    };
    return json({ summary, results });
  }),
);
