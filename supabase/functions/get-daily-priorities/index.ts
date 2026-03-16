/**
 * Get Daily Priorities — "O que fazer hoje" para o vendedor
 *
 * Retorna 3 listas:
 * 1. leads_sem_acao — leads assignados sem contato há 3+ dias
 * 2. followups_vencidos — follow-ups com due_date <= hoje, pendentes
 * 3. leads_quentes — leads com score >= 70 sem contato há 2+ dias
 *
 * Auth via requireAuth() — retorna apenas dados do usuário logado.
 * Todas as queries rodam em paralelo via Promise.all.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { requireAuth, AuthError, authErrorResponse } from "../_shared/user-auth.ts";
import { logRuntime } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(
  withSentry("get-daily-priorities", async (req: Request): Promise<Response> => {
    const corsHeaders = getCorsHeaders(req.headers.get("origin"));
    const headers = withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" });

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    // Auth
    let auth;
    try {
      auth = await requireAuth(req);
    } catch (err) {
      if (err instanceof AuthError) return authErrorResponse(err, corsHeaders);
      return new Response(JSON.stringify({ error: "Auth failed" }), { status: 401, headers });
    }

    const teamMemberId = auth.teamMemberId;
    const orgId = auth.organizationId;

    if (!teamMemberId || !orgId) {
      return new Response(JSON.stringify({ error: "Missing team context" }), { status: 400, headers });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    try {
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const todayEnd = now.toISOString();

      // ── Step 1: Get pipe records + follow-ups in parallel ──
      const [pipeWA, pipeConf, pipeProp, followUpsRes] = await Promise.all([
        supabase
          .from("pipe_whatsapp")
          .select("lead_id, status")
          .eq("organization_id", orgId)
          .eq("responsible_id", teamMemberId)
          .not("status", "in", "(compareceu)"),
        supabase
          .from("pipe_confirmacao")
          .select("lead_id, status")
          .eq("organization_id", orgId)
          .eq("responsible_id", teamMemberId)
          .not("status", "in", "(compareceu,perdido)"),
        supabase
          .from("pipe_propostas")
          .select("lead_id, status")
          .eq("organization_id", orgId)
          .eq("responsible_id", teamMemberId)
          .not("status", "in", "(vendido,perdido)"),
        supabase
          .from("follow_ups")
          .select("id, title, description, due_date, priority, source_pipe, lead:leads(id, name, company, phone)")
          .eq("organization_id", orgId)
          .eq("assigned_to", teamMemberId)
          .is("completed_at", null)
          .is("archived_at", null)
          .lte("due_date", todayEnd)
          .order("due_date", { ascending: true })
          .limit(20),
      ]);

      // ── Step 2: Collect unique lead IDs + pipe info ──
      interface PipeInfo { pipe: string; status: string }
      const pipeLeadMap = new Map<string, PipeInfo>();

      for (const r of pipeWA.data || []) {
        pipeLeadMap.set(r.lead_id, { pipe: "whatsapp", status: r.status });
      }
      for (const r of pipeConf.data || []) {
        if (!pipeLeadMap.has(r.lead_id)) {
          pipeLeadMap.set(r.lead_id, { pipe: "confirmacao", status: r.status });
        }
      }
      for (const r of pipeProp.data || []) {
        if (!pipeLeadMap.has(r.lead_id)) {
          pipeLeadMap.set(r.lead_id, { pipe: "propostas", status: r.status });
        }
      }

      const allLeadIds = [...pipeLeadMap.keys()];

      // If no leads assigned, return empty
      if (allLeadIds.length === 0) {
        return new Response(JSON.stringify({
          leads_sem_acao: [],
          followups_vencidos: followUpsRes.data ?? [],
          leads_quentes: [],
          generated_at: now.toISOString(),
        }), { headers });
      }

      // ── Step 3: Get lead details + recent history in parallel ──
      // Batch lead IDs (Supabase .in() has a practical limit)
      const batchIds = allLeadIds.slice(0, 200);

      const [leadsRes, historyRes] = await Promise.all([
        supabase
          .from("leads")
          .select("id, name, company, phone, email, qualification_score, updated_at")
          .in("id", batchIds)
          .eq("organization_id", orgId),
        supabase
          .from("lead_history")
          .select("lead_id, created_at")
          .in("lead_id", batchIds)
          .gte("created_at", threeDaysAgo)
          .order("created_at", { ascending: false }),
      ]);

      const leadsById = new Map<string, Record<string, unknown>>();
      for (const lead of leadsRes.data || []) {
        leadsById.set(lead.id, lead);
      }

      // Group history by lead_id, track last action
      const lastActionMap = new Map<string, string>(); // lead_id → most recent created_at
      const leadsWithRecent3d = new Set<string>();
      const leadsWithRecent2d = new Set<string>();

      for (const h of historyRes.data || []) {
        leadsWithRecent3d.add(h.lead_id);
        if (h.created_at >= twoDaysAgo) {
          leadsWithRecent2d.add(h.lead_id);
        }
        if (!lastActionMap.has(h.lead_id)) {
          lastActionMap.set(h.lead_id, h.created_at);
        }
      }

      // ── Step 4: For leads without recent 3d action, get their LAST history entry ──
      const leadsSemAcaoIds = allLeadIds.filter((id) => !leadsWithRecent3d.has(id));

      let oldHistoryMap = new Map<string, string>();
      if (leadsSemAcaoIds.length > 0) {
        const { data: oldHistory } = await supabase
          .from("lead_history")
          .select("lead_id, created_at")
          .in("lead_id", leadsSemAcaoIds.slice(0, 50))
          .order("created_at", { ascending: false });

        for (const h of oldHistory || []) {
          if (!oldHistoryMap.has(h.lead_id)) {
            oldHistoryMap.set(h.lead_id, h.created_at);
          }
        }
      }

      // ── Build response lists ──

      // 1. Leads sem ação (sorted by oldest first)
      const leadsSemAcao = leadsSemAcaoIds
        .map((id) => {
          const lead = leadsById.get(id);
          if (!lead) return null;
          const pipeInfo = pipeLeadMap.get(id);
          const lastAction = oldHistoryMap.get(id) || (lead as Record<string, unknown>).updated_at;
          return {
            ...lead,
            pipe_type: pipeInfo?.pipe || null,
            pipe_status: pipeInfo?.status || null,
            last_action_at: lastAction,
          };
        })
        .filter(Boolean)
        .sort((a, b) => {
          const aTime = new Date(a!.last_action_at as string).getTime();
          const bTime = new Date(b!.last_action_at as string).getTime();
          return aTime - bTime; // oldest first
        })
        .slice(0, 20);

      // 2. Follow-ups vencidos (already fetched)
      const followupsVencidos = (followUpsRes.data || []).map((f: Record<string, unknown>) => ({
        ...f,
        days_overdue: Math.max(
          0,
          Math.floor((now.getTime() - new Date(f.due_date as string).getTime()) / (24 * 60 * 60 * 1000))
        ),
      }));

      // 3. Leads quentes (score >= 70, no contact in 2 days)
      const leadsQuentes = allLeadIds
        .filter((id) => !leadsWithRecent2d.has(id))
        .map((id) => {
          const lead = leadsById.get(id);
          if (!lead) return null;
          const score = (lead as Record<string, unknown>).qualification_score as number || 0;
          if (score < 70) return null;
          const pipeInfo = pipeLeadMap.get(id);
          const lastAction = lastActionMap.get(id) || oldHistoryMap.get(id) || (lead as Record<string, unknown>).updated_at;
          return {
            ...lead,
            pipe_type: pipeInfo?.pipe || null,
            pipe_status: pipeInfo?.status || null,
            last_action_at: lastAction,
          };
        })
        .filter(Boolean)
        .sort((a, b) => {
          const aScore = (a as Record<string, unknown>).qualification_score as number || 0;
          const bScore = (b as Record<string, unknown>).qualification_score as number || 0;
          return bScore - aScore; // highest score first
        })
        .slice(0, 10);

      await logRuntime({
        organizationId: orgId,
        module: "general",
        action: "daily_priorities",
        status: "success",
        payloadSnapshot: {
          leads_sem_acao: leadsSemAcao.length,
          followups_vencidos: followupsVencidos.length,
          leads_quentes: leadsQuentes.length,
        },
      });

      return new Response(JSON.stringify({
        leads_sem_acao: leadsSemAcao,
        followups_vencidos: followupsVencidos,
        leads_quentes: leadsQuentes,
        generated_at: now.toISOString(),
      }), { headers });
    } catch (err) {
      console.error("[get-daily-priorities] Error:", err);
      await logRuntime({
        organizationId: orgId,
        module: "general",
        action: "daily_priorities",
        status: "error",
        errorMessage: String(err),
      });
      return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers });
    }
  }),
);
