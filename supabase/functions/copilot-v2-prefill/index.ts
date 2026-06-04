/**
 * copilot-v2-prefill — Copilot v2 cutover wizard SEED endpoint (Slice 12b). 🔒
 *
 * Read-only, admin-gated. Feeds the wizard's "Pré-preencher do v1" affordance:
 *   • POST {}                       → list the org's legacy v1 copilot_agents
 *                                     (slim {id,name,template_type}) for the picker.
 *   • POST {sourceAgentId, archetype?} → run the tested, pure prefillFromV1Agent on
 *                                     that v1 row and return {archetype,config,gaps,
 *                                     dropped} for the wizard to hydrate.
 *
 * The org is NEVER read from the payload: the admin's JWT flows to the SECURITY
 * DEFINER RPC copilot_v2_v1_prefill_candidates, which resolves the org from the
 * caller's admin set and asserts admin (42501 → 403 here). The transform is the
 * SAME implementation the unit suite locks (tests/unit/copilot-v2/v1-prefill.test.ts)
 * — no FE mirror, no drift. Zero writes.
 *
 * Pattern: Deno.serve(withSentry) + withSecurityHeaders(getCorsHeaders) + OPTIONS
 * early return. config.toml: verify_jwt = false (preflight) — JWT enforced inside
 * via the user-scoped client + the RPC's admin/org assertion.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { prefillFromV1Agent, type V1AgentLike } from "../_shared/copilot-v2/v1-prefill.ts";
import type { Archetype } from "../_shared/copilot-v2/model-selector.ts";

interface CandidateRow extends V1AgentLike {
  id?: string;
}

interface PrefillCandidatesResult {
  organization_id: string;
  organization_name: string | null;
  candidates: CandidateRow[];
}

const VALID_ARCHETYPES: ReadonlySet<string> = new Set(["qualificador", "vendedor", "carteira"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(
  withSentry("copilot-v2-prefill", async (req: Request) => {
    const cors = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    // User-scoped client — the admin's JWT flows to the RPC (auth.uid()).
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    let payload: { sourceAgentId?: string; archetype?: string; organizationId?: string } = {};
    if (req.headers.get("content-length") !== "0") {
      try {
        const raw = await req.text();
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        return json({ error: "invalid_json" }, 400);
      }
    }

    const sourceAgentId = payload.sourceAgentId;
    const archetypeOverride = payload.archetype;
    if (archetypeOverride !== undefined && !VALID_ARCHETYPES.has(archetypeOverride)) {
      return json({ error: "invalid_archetype" }, 400);
    }

    // organizationId is an optional DISAMBIGUATION hint for multi-org admins/masters
    // (the RPC re-validates it is in the caller's admin set — never trusted as-is).
    const orgId = payload.organizationId;
    if (orgId !== undefined && !UUID_RE.test(orgId)) {
      return json({ error: "invalid_organization_id" }, 400);
    }

    // Admin-gated, org-resolved read of the org's legacy v1 agents.
    const { data, error } = await supabase.rpc(
      "copilot_v2_v1_prefill_candidates",
      orgId ? { p_organization_id: orgId } : {},
    );
    if (error) {
      // 22023 = multi-org admin must disambiguate → 400 so the wizard can prompt.
      if (error.code === "22023") return json({ error: "organization_required" }, 400);
      // The RPC raises 42501 for non-admins; surface as 403 (others as 500).
      const denied = error.code === "42501" || /not authorized/i.test(error.message ?? "");
      return json({ error: denied ? "forbidden" : "prefill_candidates_failed", detail: error.message }, denied ? 403 : 500);
    }

    const result = data as PrefillCandidatesResult;
    const candidates = Array.isArray(result?.candidates) ? result.candidates : [];

    // ── List mode: slim picker payload ──────────────────────────────────────
    if (!sourceAgentId) {
      return json({
        organizationName: result?.organization_name ?? null,
        candidates: candidates.map((c) => ({
          id: c.id,
          name: typeof c.name === "string" ? c.name : null,
          templateType: typeof c.template_type === "string" ? c.template_type : null,
        })),
      });
    }

    // ── Seed mode: run the pure transform on the chosen v1 row ───────────────
    const source = candidates.find((c) => c.id === sourceAgentId);
    if (!source) return json({ error: "source_agent_not_found" }, 404);

    const prefill = prefillFromV1Agent(source, {
      orgName: result?.organization_name ?? undefined,
      archetype: (archetypeOverride as Archetype | undefined),
    });

    return json({
      sourceName: typeof source.name === "string" ? source.name : null,
      prefill,
    });
  }),
);
