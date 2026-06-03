/**
 * copilot-v2-simulate — Copilot v2 dry-run simulator endpoint (Slice 9). 🔒
 *
 * Thin wrapper over runSimulatorTurn (the UNCHANGED cognition spine + dry-run
 * executor). CREATE mode tests the IN-FLIGHT draft config in the body; EDIT mode
 * loads the SAVED config for agentId from the DB (org-scoped by RLS via the user
 * client). The model is the REAL per-archetype model (faithful, low volume). The
 * org is NEVER read from the payload. Zero DB writes (dry-run).
 *
 * Reads: stages/fields can be passed live in seed by the caller (hybrid decision);
 * lead-360/contact-status come from the operator-provided seed lead (no real PII).
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
import { runSimulatorTurn } from "../_shared/copilot-v2/simulator-turn.ts";
import type { Archetype, ModelId } from "../_shared/copilot-v2/model-selector.ts";

serve(
  withSentry("copilot-v2-simulate", async (req: Request) => {
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

    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    const archetype: Archetype | undefined = body?.archetype;
    const message: string | undefined = body?.message;
    if (!archetype || !message) return json({ error: "missing_archetype_or_message" }, 400);

    // Resolve config: draft (body.config) for CREATE, saved (DB) for EDIT.
    let config: ReturnType<typeof toAgentConfig>;
    let capabilities: Record<string, boolean | undefined>;
    let rubricRules: unknown[] | undefined = body?.rubricRules;

    if (body?.config) {
      capabilities = resolveAgentCapabilities(body.config);
      config = toAgentConfig({ ...body.config, capabilities: body.config.capabilities ?? {} });
    } else if (body?.agentId) {
      const [{ data: cfg }, { data: rub }] = await Promise.all([
        supabase.from("copilot_v2_config").select("slots, escape_hatch_notes").eq("agent_id", body.agentId).maybeSingle(),
        supabase.from("copilot_v2_rubric").select("rules").eq("agent_id", body.agentId).maybeSingle(),
      ]);
      const slots = (cfg?.slots as Record<string, unknown>) ?? {};
      capabilities = resolveAgentCapabilities(slots);
      config = toAgentConfig(mergeFromPersistence(slots as any, cfg?.escape_hatch_notes ?? null));
      rubricRules = rubricRules ?? (Array.isArray(rub?.rules) ? (rub?.rules as unknown[]) : undefined);
    } else {
      return json({ error: "missing_config_or_agentId" }, 400);
    }

    const makeLlm = (model: ModelId) => createOpenRouterClient({ model, temperature: 0.7, maxTokens: 1024 });

    const result = await runSimulatorTurn(
      { archetype, config, capabilities, rubricRules: rubricRules as any, seed: body?.seed ?? {}, message },
      { makeLlm },
    );

    return json({ trace: result.trace, writes: result.writes, reply: result.reply, model: result.model });
  }),
);
