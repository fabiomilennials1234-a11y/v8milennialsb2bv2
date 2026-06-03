/**
 * copilot-v2-save-config — Copilot v2 wizard SAVE endpoint (Slice 8). 🔒
 *
 * Authenticated admin surface for the wizard. Thin I/O wrapper over the pure
 * orchestrateSaveConfig flow (schema → escape-hatch linter → activation → save).
 * The org is NEVER read from the payload: the supabase client carries the admin's
 * JWT and the SECURITY DEFINER RPCs resolve the org from the agent row + assert
 * the caller is an admin. The linter's LLM call is the only network dep here; the
 * decision logic is unit-tested in tests/unit/copilot-v2/save-config-flow.test.ts.
 *
 * Pattern: Deno.serve(withSentry) + withSecurityHeaders(getCorsHeaders) + OPTIONS
 * early return. config.toml: verify_jwt = false (preflight) — the JWT is enforced
 * inside via the user-scoped client + the RPC's admin/org assertion.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { createOpenRouterClient } from "../_shared/copilot-v2/openrouter-client.ts";
import { buildLinterPrompt, type LinterVerdict } from "../_shared/copilot-v2/escape-hatch-linter.ts";
import { mergeFromPersistence } from "../_shared/copilot-v2/config-schema.ts";
import { orchestrateSaveConfig, type SaveConfigResult } from "../_shared/copilot-v2/save-config-flow.ts";

const STATUS_CODE: Record<SaveConfigResult["status"], number> = {
  ok: 200,
  invalid: 422,
  rejected: 422,
  not_activatable: 409,
};

serve(
  withSentry("copilot-v2-save-config", async (req: Request) => {
    const cors = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    // User-scoped client — the admin's JWT flows to the RPCs (auth.uid()).
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    let payload: any;
    try {
      payload = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    const agentId: string | undefined = payload?.agentId;
    const archetype: string | undefined = payload?.archetype;
    const rawConfig = payload?.config;
    const activate = payload?.activate === true;
    const rubricRules = payload?.rubricRules; // undefined = don't touch rubric

    if (!agentId || !archetype) return json({ error: "missing_agent_or_archetype" }, 400);

    // The cheap classifier for the escape-hatch (semantic policy-conflict).
    const llm = createOpenRouterClient({ model: "google/gemini-2.5-flash", temperature: 0, maxTokens: 200 });
    const classifyEscapeHatch = async (notes: string, policy: string | null): Promise<LinterVerdict> => {
      const res = await llm.complete({
        system: buildLinterPrompt(notes, policy),
        messages: [{ role: "user", content: "Classifique as observações acima." }],
        tools: [],
      });
      const parsed = JSON.parse(res.text ?? ""); // throw → fail-CLOSED upstream
      return { violation: parsed.violation === true, category: parsed.category ?? null };
    };

    // rubricPresent: a non-empty rubric row for this agent (Qualificador needs it).
    const rubricPresent = await (async () => {
      const { data } = await supabase
        .from("copilot_v2_rubric")
        .select("rules")
        .eq("agent_id", agentId)
        .maybeSingle();
      const rules = (data as { rules?: unknown } | null)?.rules;
      return Array.isArray(rules) ? rules.length > 0 : !!rules;
    })();

    const result = await orchestrateSaveConfig(
      { agentId, archetype: archetype as any, rawConfig, activate, rubricRules },
      {
        classifyEscapeHatch,
        rubricPresent,
        saveConfig: async (id, slots, escapeHatchNotes, rules) => {
          const { data, error } = await supabase.rpc("save_copilot_v2_config", {
            p_agent_id: id,
            p_slots: slots,
            p_escape_hatch_notes: escapeHatchNotes,
            p_rubric_rules: rules,
          });
          if (error) throw new Error(error.message);
          const row = data as { slots: Record<string, unknown>; escape_hatch_notes: string | null };
          return mergeFromPersistence(row.slots as any, row.escape_hatch_notes);
        },
        setActive: async (id, active) => {
          const { error } = await supabase.rpc("set_copilot_v2_agent_active", {
            p_agent_id: id,
            p_active: active,
          });
          if (error) throw new Error(error.message);
        },
      },
    );

    return json(result, STATUS_CODE[result.status]);
  }),
);
