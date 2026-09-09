// deno-lint-ignore-file no-explicit-any
/**
 * disparo-planilha-create — "Subir planilha" blast source (ADR-0014, #906).
 *
 * Upserts a blast list keyed by canonical phone (E.164-ish, mirrors the stored
 * `normalized_phone`) and returns the set of valid recipients for the wizard to
 * dispatch (#910). The pure partition lives in `_shared/quick-blast/
 * spreadsheet-upsert.ts` (`partitionSpreadsheet`) — this function only does the
 * IO around it: load the existing Leads for the uploaded phones, create the
 * non-matches, seed them into the chosen funnel/stage, tag the new ones.
 *
 * Partition rules (ADR-0014):
 *   - match (phone already a Lead) → dispatch as-is; NEVER overwrite. Only empty
 *     fields are back-filled (name/company/email).
 *   - non-match → create a Lead (origin `disparo_planilha`, chosen funnel/stage,
 *     chosen tags).
 *   - no usable phone → invalid (reported, not sent).
 *   - duplicate phone within the file → collapse to one send.
 *
 * Access policy (ADR-0014, same as ADR-0002 Quick Blast): NO role gate. Any
 * authenticated member may fire, scoped to their own org. The org is resolved
 * server-side from the JWT — the front NEVER sends organization_id.
 *
 * Two-phase usage: call with `dry_run: true` for the preview counts (read-only,
 * no writes), then call again without it to create + return `lead_ids`.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import {
  partitionSpreadsheet,
  type ExistingLead,
  type MappedRow,
} from "../_shared/quick-blast/spreadsheet-upsert.ts";
import { normalizeCanonicalPhone } from "../_shared/copilot-v2/phone-normalizer.ts";
import {
  isPipelineResolutionError,
  resolvePipeline,
  upsertPipeEntry,
} from "../_shared/pipeline-adapter.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const PHONE_CHUNK = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Coerce an inbound row to the pure MappedRow shape (trimmed, string phone). */
function toMappedRow(raw: any): MappedRow {
  return {
    phone: typeof raw?.phone === "string" ? raw.phone.trim() : String(raw?.phone ?? "").trim(),
    name: typeof raw?.name === "string" ? raw.name.trim() || undefined : undefined,
    company: typeof raw?.company === "string" ? raw.company.trim() || undefined : undefined,
    email: typeof raw?.email === "string" ? raw.email.trim() || undefined : undefined,
  };
}

Deno.serve(
  withErrorBoundary("disparo-planilha-create", async (req: Request) => {
    const origin = req.headers.get("Origin") ?? undefined;
    const corsHeaders = withSecurityHeaders(
      (await import("../_shared/cors.ts")).getCorsHeaders(origin) as Record<string, string>,
    );
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" }, corsHeaders);

    // --- Auth: validate the caller's JWT, resolve their org (never trust the body). ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse(401, { error: "Missing auth" }, corsHeaders);
    }
    const userJwt = authHeader.slice(7);
    const supabaseUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: userData, error: userErr } = await supabaseUser.auth.getUser(userJwt);
    if (userErr || !userData?.user) {
      return jsonResponse(401, { error: "Invalid token" }, corsHeaders);
    }
    const user = userData.user;

    // NO role gate (ADR-0014). Any member may fire, scoped to their org.
    const { data: member } = await supabaseAdmin
      .from("team_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!member?.organization_id) {
      return jsonResponse(403, { error: "No organization" }, corsHeaders);
    }
    const orgId = member.organization_id as string;

    const body = await req.json().catch(() => null);
    if (!body) return jsonResponse(400, { error: "Invalid JSON" }, corsHeaders);

    const {
      rows: rawRows,
      funnel,
      funnel_kind,
      stage,
      tags,
      dry_run,
    } = body as {
      rows?: any[];
      funnel?: string;
      funnel_kind?: "system" | "custom";
      stage?: string;
      tags?: string[];
      dry_run?: boolean;
    };

    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return jsonResponse(400, { error: "Missing rows" }, corsHeaders);
    }
    if (!funnel || !stage) {
      return jsonResponse(400, { error: "Missing funnel or stage" }, corsHeaders);
    }

    const rows = rawRows.map(toMappedRow);
    // `funnel_kind` legado é aceito e IGNORADO (Fatia B): o destino resolve por
    // (org, id-ou-slug) em `pipelines` — funil é funil, sem família.
    void funnel_kind;

    try {
      // --- Load existing Leads for the uploaded phones only (bounded by file size). ---
      const canonicalPhones = Array.from(
        new Set(
          rows
            .map((r) => normalizeCanonicalPhone(r.phone))
            .filter((p): p is string => !!p),
        ),
      );

      const existingForPartition: ExistingLead[] = [];
      const existingById = new Map<
        string,
        { name: string | null; email: string | null; company: string | null }
      >();
      for (const phones of chunk(canonicalPhones, PHONE_CHUNK)) {
        if (phones.length === 0) continue;
        const { data: existingLeads, error: existErr } = await supabaseAdmin
          .from("leads")
          .select("id, normalized_phone, name, email, company")
          .eq("organization_id", orgId)
          .in("normalized_phone", phones);
        if (existErr) throw new Error(`lead lookup failed: ${existErr.message}`);
        for (const l of existingLeads ?? []) {
          if (!l.normalized_phone) continue;
          existingForPartition.push({ id: l.id, normalizedPhone: l.normalized_phone });
          existingById.set(l.id, { name: l.name, email: l.email, company: l.company });
        }
      }

      const partition = partitionSpreadsheet(rows, existingForPartition);
      const report = {
        created: partition.toCreate.length,
        matched: partition.matched.length,
        invalid: partition.invalid.length,
        duplicates: partition.duplicates.length,
      };

      // --- Preview: counts only, no writes. ---
      if (dry_run === true) {
        return jsonResponse(200, {
          ok: true,
          dry_run: true,
          recipient_count: report.created + report.matched,
          report,
        }, corsHeaders);
      }

      // --- Resolve + validate the destination funnel/stage (org-scoped). ---
      // Fatia B: UM caminho para qualquer funil — `funnel` é pipelines.id
      // (canônico) ou slug/alias legado; `stage` é pipeline_stages.id
      // (canônico) ou stage_key legada. Fail-closed: destino que não resolve
      // na org do chamador é 400 antes de qualquer escrita.
      let destPipelineId: string;
      try {
        destPipelineId = (await resolvePipeline(supabaseAdmin, orgId, funnel)).id;
      } catch (e) {
        if (isPipelineResolutionError(e)) {
          return jsonResponse(400, { error: "Funnel not found in your organization" }, corsHeaders);
        }
        throw e;
      }
      let stageQuery = supabaseAdmin
        .from("pipeline_stages")
        .select("id, stage_key")
        .eq("organization_id", orgId)
        .eq("pipeline_id", destPipelineId)
        .eq("is_active", true);
      stageQuery = UUID_RE.test(stage)
        ? stageQuery.eq("id", stage)
        : stageQuery.eq("stage_key", stage);
      const { data: stageRow } = await stageQuery.maybeSingle();
      if (!stageRow) {
        return jsonResponse(400, { error: "Stage not found in this funnel" }, corsHeaders);
      }
      const destStageKey = stageRow.stage_key as string;

      // --- Validate the chosen tags belong to the org (drop anything cross-tenant). ---
      let validTagIds: string[] = [];
      if (Array.isArray(tags) && tags.length > 0) {
        const { data: tagRows } = await supabaseAdmin
          .from("tags")
          .select("id")
          .eq("organization_id", orgId)
          .in("id", tags);
        validTagIds = (tagRows ?? []).map((t) => t.id as string);
      }

      // --- Create the non-matches in one batch. normalized_phone is filled by trigger. ---
      const createdLeadIds: string[] = [];
      if (partition.toCreate.length > 0) {
        const insertRows = partition.toCreate.map((entry) => ({
          name: entry.row.name || `Lead ${entry.normalizedPhone.slice(-4)}`,
          phone: entry.row.phone || null,
          email: entry.row.email || null,
          company: entry.row.company || null,
          origin: "disparo_planilha",
          organization_id: orgId,
        }));

        const { data: created, error: createErr } = await supabaseAdmin
          .from("leads")
          .insert(insertRows)
          .select("id, normalized_phone");
        if (createErr) throw new Error(`lead creation failed: ${createErr.message}`);

        // Map back by canonical phone so seeding is order-independent.
        const idByPhone = new Map<string, string>();
        for (const l of created ?? []) {
          const key = normalizeCanonicalPhone(l.normalized_phone);
          if (key) idByPhone.set(key, l.id);
        }

        for (const entry of partition.toCreate) {
          const leadId = idByPhone.get(entry.normalizedPhone);
          if (!leadId) continue;
          createdLeadIds.push(leadId);

          // Seed into the chosen funnel/stage — motor único (o adapter aceita
          // uuid além de slug; lead recém-criado nunca tem entry, então o
          // upsert é o INSERT do fluxo legado nos dois mundos).
          await upsertPipeEntry(supabaseAdmin, {
            leadId,
            orgId,
            slug: destPipelineId,
            stageKey: destStageKey,
          });
        }

        // Tag the new leads (never the matched ones — ADR-0014: match = no overwrite).
        if (validTagIds.length > 0 && createdLeadIds.length > 0) {
          const tagRows = createdLeadIds.flatMap((leadId) =>
            validTagIds.map((tagId) => ({ lead_id: leadId, tag_id: tagId })),
          );
          const { error: tagErr } = await supabaseAdmin
            .from("lead_tags")
            .upsert(tagRows, { onConflict: "lead_id,tag_id", ignoreDuplicates: true });
          if (tagErr) {
            console.warn("[disparo-planilha-create] lead_tags upsert failed:", tagErr.message);
          }
        }
      }

      // --- Matched: fill empty fields only; never overwrite existing data. ---
      for (const m of partition.matched) {
        const current = existingById.get(m.leadId);
        if (!current) continue;
        const fill: Record<string, unknown> = {};
        if (!current.name && m.row.name) fill.name = m.row.name;
        if (!current.email && m.row.email) fill.email = m.row.email;
        if (!current.company && m.row.company) fill.company = m.row.company;
        if (Object.keys(fill).length > 0) {
          await supabaseAdmin.from("leads").update(fill).eq("id", m.leadId);
        }
      }

      // --- Recipients = matched (as-is) + freshly created. ---
      const leadIds = [...partition.matched.map((m) => m.leadId), ...createdLeadIds];

      await logRuntime({
        organizationId: orgId,
        module: "disparo-planilha-create",
        action: "created",
        status: "success",
        payloadSnapshot: { ...report, recipients: leadIds.length, pipeline_id: destPipelineId },
      });

      return jsonResponse(200, { ok: true, lead_ids: leadIds, recipient_count: leadIds.length, report }, corsHeaders);
    } catch (e) {
      const msg = (e as Error).message ?? "unknown error";
      await logRuntime({
        organizationId: orgId,
        module: "disparo-planilha-create",
        action: "failed",
        status: "error",
        errorMessage: msg,
      });
      return jsonResponse(500, { error: msg }, corsHeaders);
    }
  }),
);
