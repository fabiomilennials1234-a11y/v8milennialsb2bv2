/**
 * process-pipe-distribution
 *
 * Executes automatic lead distribution based on pipe_distribution_rules config.
 * Called by PostgreSQL trigger (via pg_net) when a lead is inserted into a pipe.
 *
 * Supports three modes:
 *  - single: always assign to the configured member
 *  - random: pick randomly from the pool
 *  - round_robin: assign to the member with fewest active leads (least-loaded)
 */

import { withSentry } from "../_shared/sentry.ts";
import { logRuntime } from "../_shared/logger.ts";
import { trackEvent } from "../_shared/track.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { updatePipeEntryById } from "../_shared/pipeline-adapter.ts";
import type { PipeSlug } from "../_shared/pipeline-adapter.ts";
import { requireCronAuth } from "../_shared/auth.ts";

const VALID_PIPE_SLUGS: Record<string, PipeSlug> = {
  whatsapp: "whatsapp",
  confirmacao: "confirmacao",
  propostas: "propostas",
};

const TERMINAL_STATUSES = ["vendido", "perdido", "cancelado"];

Deno.serve(
  withSentry("process-pipe-distribution", async (req) => {
    const corsHeaders = getCorsHeaders(req.headers.get("origin"));

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Auth: cron secret (fail-closed)
    if (!requireCronAuth(req).authorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const { organizationId, leadId, pipeRecordId, pipeType } = body as {
      organizationId?: string;
      leadId?: string;
      pipeRecordId?: string;
      pipeType?: string;
    };

    if (!organizationId || !pipeRecordId || !pipeType) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: organizationId, pipeRecordId, pipeType" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const pipeSlug = VALID_PIPE_SLUGS[pipeType];
    if (!pipeSlug) {
      return new Response(
        JSON.stringify({ error: `Unknown pipe_type: ${pipeType}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 1. Fetch distribution rule ──────────────────────────────────────────
    const { data: rule, error: ruleError } = await supabase
      .from("pipe_distribution_rules")
      .select("id, sdr_mode, sdr_assigned_to")
      .eq("organization_id", organizationId)
      .eq("pipe_type", pipeType)
      .maybeSingle();

    if (ruleError || !rule || !rule.sdr_mode) {
      await logRuntime({
        organizationId,
        module: "pipe_distribution",
        action: "auto_distribute",
        status: "skipped",
        entityType: "pipeline_entries",
        entityId: pipeRecordId,
        payloadSnapshot: {
          pipeType,
          reason: ruleError ? "rule_query_error" : !rule ? "no_rule" : "mode_is_null",
        },
      });
      return json(corsHeaders, { distributed: false, reason: "no_active_rule" });
    }

    // ── 2. Check if already assigned (via pipeline_entries) ────────────────
    const { data: pipeRecord } = await supabase
      .from("pipeline_entries")
      .select("assigned_to, metadata")
      .eq("id", pipeRecordId)
      .maybeSingle();

    const existingAssignment = pipeRecord?.assigned_to ||
      (pipeRecord?.metadata as Record<string, unknown>)?.responsible_id;
    if (existingAssignment) {
      return json(corsHeaders, { distributed: false, reason: "already_assigned" });
    }

    // ── 3. Resolve the member to assign ─────────────────────────────────────
    let selectedMemberId: string | null = null;

    if (rule.sdr_mode === "single") {
      selectedMemberId = rule.sdr_assigned_to;
    }

    if (rule.sdr_mode === "random" || rule.sdr_mode === "round_robin") {
      // Fetch pool members (no role filter — unified pool)
      const { data: members } = await supabase
        .from("pipe_distribution_members")
        .select("team_member_id")
        .eq("rule_id", rule.id)
        .order("created_at");

      const memberIds = members?.map((m) => m.team_member_id) ?? [];

      if (memberIds.length === 0) {
        await logRuntime({
          organizationId,
          module: "pipe_distribution",
          action: "auto_distribute",
          status: "skipped",
          entityType: "pipeline_entries",
          entityId: pipeRecordId,
          payloadSnapshot: { pipeType, reason: "empty_pool" },
        });
        return json(corsHeaders, { distributed: false, reason: "empty_pool" });
      }

      if (rule.sdr_mode === "random") {
        selectedMemberId = memberIds[Math.floor(Math.random() * memberIds.length)];
      }

      if (rule.sdr_mode === "round_robin") {
        // Atomic RPC with advisory lock — prevents race conditions
        const { data: chosen } = await supabase.rpc("distribute_pipe_round_robin", {
          p_pipe_type: pipeType,
          p_organization_id: organizationId,
          p_member_ids: memberIds,
        });
        selectedMemberId = chosen ?? null;
      }
    }

    if (!selectedMemberId) {
      await logRuntime({
        organizationId,
        module: "pipe_distribution",
        action: "auto_distribute",
        status: "skipped",
        entityType: "pipeline_entries",
        entityId: pipeRecordId,
        payloadSnapshot: { pipeType, mode: rule.sdr_mode, reason: "no_member_resolved" },
      });
      return json(corsHeaders, { distributed: false, reason: "no_member_resolved" });
    }

    // ── 4. Assign responsible on pipeline_entries record ────────────────────
    const updateSuccess = await updatePipeEntryById(supabase, pipeRecordId, {
      assignedTo: selectedMemberId,
      metadata: {
        responsible_id: selectedMemberId,
        sdr_id: selectedMemberId,
        pre_sale_responsible_id: selectedMemberId,
      },
    });

    // ── 5. Also update lead record ──────────────────────────────────────────
    if (leadId) {
      await supabase
        .from("leads")
        .update({ responsible_id: selectedMemberId, pre_sale_responsible_id: selectedMemberId })
        .eq("id", leadId);
    }

    // ── 6. Log & track ─────────────────────────────────────────────────────
    await logRuntime({
      organizationId,
      module: "pipe_distribution",
      action: "auto_distribute",
      status: updateSuccess ? "success" : "error",
      entityType: "pipeline_entries",
      entityId: pipeRecordId,
      payloadSnapshot: {
        pipeType,
        mode: rule.sdr_mode,
        selectedMemberId,
        leadId: leadId ?? null,
      },
      errorMessage: updateSuccess ? undefined : "Failed to update pipeline entry",
    });

    await trackEvent({
      organizationId,
      eventType: "automation_triggered",
      entityType: "pipeline_entries",
      entityId: pipeRecordId,
      metadata: {
        action: "auto_distribute",
        mode: rule.sdr_mode,
        assignedTo: selectedMemberId,
      },
    });

    return json(corsHeaders, {
      distributed: true,
      assignedTo: selectedMemberId,
      mode: rule.sdr_mode,
    });
  }),
);

// ── Helpers ─────────────────────────────────────────────────────────────────

function json(
  corsHeaders: Record<string, string>,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
