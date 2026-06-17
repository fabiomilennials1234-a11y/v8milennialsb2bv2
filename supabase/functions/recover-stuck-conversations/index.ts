import { withSentry } from "../_shared/sentry.ts";
import { logRuntime } from "../_shared/logger.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { isCopilotCanceled } from "../_shared/copilot/cancellation.ts";

// Force bundler to include provider modules (used via dynamic import in whatsapp-dispatch)
import "../_shared/whatsapp-providers/evolution-provider.ts";
import "../_shared/whatsapp-providers/uazapi-provider.ts";

/**
 * Edge Function: recover-stuck-conversations
 *
 * Ferramenta administrativa de recuperação. Para um conjunto de leads que
 * ficaram SEM resposta da IA (handoff falhou / dup-guard silenciou / etc),
 * regenera a resposta da IA pra ÚLTIMA mensagem do lead e ENTREGA via WhatsApp,
 * reusando exatamente o pipeline de produção:
 *   1. gate de segurança per-lead (isCopilotCanceled) — NUNCA dispara pra lead
 *      com IA desligada (ai_disabled) ou em pausa humana ativa;
 *   2. agent-message (pipeline completo, já com o fix anti-silêncio) gera a
 *      resposta contextual;
 *   3. sendTextViaInstance (mesmo sender do whatsapp-webhook) entrega, com
 *      re-check de cancelamento per-chunk.
 *
 * `dry_run: true` (default) NÃO chama agent-message nem envia — só resolve e
 * retorna o PLANO (lead, telefone, última msg, instância, gate) pra revisão.
 *
 * Auth: SERVICE_ROLE_KEY (caller interno/admin). Nunca exposto a usuário final.
 */

interface RecoverRequest {
  organization_id: string;
  lead_ids: string[];
  dry_run?: boolean;
}

const UNDELIVERABLE_PREFIXES = ["[undecryptable]", "[mensagem não suportada]", "[unsupported]"];

Deno.serve(withSentry("recover-stuck-conversations", async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Auth: caller interno. Aceita Bearer service_role (function-to-function) OU
  // header dedicado x-recover-secret (operador/admin), comparado em tempo
  // constante. Fail-closed se RECOVER_SECRET não configurado e bearer ausente.
  const authHeader = req.headers.get("Authorization");
  const recoverSecretEnv = Deno.env.get("RECOVER_SECRET");
  const recoverSecretHdr = req.headers.get("x-recover-secret");
  const constEq = (a: string, b: string): boolean => {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  };
  const bearerOk = !!authHeader && authHeader === `Bearer ${serviceKey}`;
  const secretOk = !!recoverSecretEnv && !!recoverSecretHdr &&
    constEq(recoverSecretHdr, recoverSecretEnv);
  if (!bearerOk && !secretOk) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const body = (await req.json()) as RecoverRequest;
  const { organization_id, lead_ids } = body;
  const dryRun = body.dry_run !== false; // default TRUE (fail-safe)

  if (!organization_id || !Array.isArray(lead_ids) || lead_ids.length === 0) {
    return new Response(
      JSON.stringify({ error: "organization_id e lead_ids[] são obrigatórios" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { sendTextViaInstance } = await import("../_shared/whatsapp-dispatch.ts");

  // Resolve uma instância ativa da org (sender). Reusada por todos os leads.
  const { data: instance } = await supabase
    .from("whatsapp_instances")
    .select("*")
    .eq("organization_id", organization_id)
    // Meta isolation (cert Rule 2): never auto-pick a Meta number for a legacy send.
    .in("provider", ["uazapi", "evolution"])
    .in("status", ["open", "connected"])
    .limit(1)
    .maybeSingle();

  const results: Array<Record<string, unknown>> = [];

  for (const leadId of lead_ids) {
    const r: Record<string, unknown> = { lead_id: leadId };
    try {
      const { data: lead } = await supabase
        .from("leads")
        .select("id, name, phone, normalized_phone, organization_id, ai_disabled")
        .eq("id", leadId)
        .eq("organization_id", organization_id)
        .maybeSingle();

      if (!lead) { r.status = "skipped"; r.reason = "lead_not_found"; results.push(r); continue; }
      r.name = lead.name;
      r.phone = lead.phone;

      if (!lead.phone) { r.status = "skipped"; r.reason = "no_phone"; results.push(r); continue; }

      // ── Gate de segurança: nunca dispara pra IA desligada / pausa humana ──
      const gate = await isCopilotCanceled(supabase, organization_id, lead.phone);
      if (gate.canceled) {
        r.status = "skipped"; r.reason = "gate_blocked"; r.gate_source = gate.source;
        results.push(r); continue;
      }

      // Última mensagem ENTRANTE do lead (é a que ficou sem resposta).
      const { data: lastIn } = await supabase
        .from("whatsapp_messages")
        .select("content, created_at")
        .eq("lead_id", leadId)
        .eq("direction", "incoming")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastMsg = (lastIn?.content || "").trim();
      r.last_msg = lastMsg.slice(0, 80);
      r.last_in_at = lastIn?.created_at ?? null;

      if (!lastMsg || UNDELIVERABLE_PREFIXES.some((p) => lastMsg.toLowerCase().startsWith(p))) {
        r.status = "skipped"; r.reason = "no_usable_inbound";
        results.push(r); continue;
      }

      if (!instance) { r.status = "skipped"; r.reason = "no_active_instance"; results.push(r); continue; }

      // ── DRY-RUN: só plano, sem gerar nem enviar ──
      if (dryRun) {
        r.status = "planned";
        r.would = "generate_via_agent_message_and_send";
        results.push(r); continue;
      }

      // ── REAL: gera resposta contextual via pipeline de produção ──
      const agentResp = await fetch(`${supabaseUrl}/functions/v1/agent-message`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: lead.phone,
          message: lastMsg,
          channel: "whatsapp",
          organization_id,
          incoming_message_type: "text",
        }),
      });

      if (!agentResp.ok) {
        r.status = "error"; r.reason = `agent_message_${agentResp.status}`;
        results.push(r); continue;
      }
      const agentData = await agentResp.json().catch(() => null);
      if (!agentData || agentData.skipped) {
        r.status = "skipped"; r.reason = agentData?.reason || "agent_skipped";
        results.push(r); continue;
      }

      const parts: string[] = agentData.messages ?? (agentData.message ? [agentData.message] : []);
      if (parts.length === 0) { r.status = "skipped"; r.reason = "empty_generation"; results.push(r); continue; }

      // ── Entrega (mesmo padrão do whatsapp-webhook) ──
      let chunksSent = 0;
      for (let i = 0; i < parts.length; i++) {
        const text = parts[i]?.trim();
        if (!text) continue;
        if (i > 0) await new Promise((res) => setTimeout(res, 1200 + Math.random() * 800));

        const recheck = await isCopilotCanceled(supabase, organization_id, lead.phone);
        if (recheck.canceled) { r.canceled_mid_delivery = true; break; }

        const sendResult = await sendTextViaInstance(
          supabase, instance, lead.phone, text, { trackSource: "copilot" },
        );
        const msgId = sendResult.messageId
          ?? `recover_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        await supabase.from("whatsapp_messages").upsert({
          organization_id,
          instance_id: instance.id,
          message_id: msgId,
          remote_jid: `${lead.phone}@s.whatsapp.net`,
          phone_number: lead.phone,
          direction: "outgoing",
          message_type: "text",
          content: text,
          status: sendResult.success ? "sent" : "failed",
          timestamp: new Date().toISOString(),
          sent_by_ai: true,
          sent_source: "copilot",
        }, { onConflict: "message_id,instance_id", ignoreDuplicates: true });

        if (sendResult.success) chunksSent++;
      }

      r.status = chunksSent > 0 ? "sent" : "send_failed";
      r.chunks_sent = chunksSent;
      r.parts = parts.length;
      results.push(r);
    } catch (e) {
      r.status = "error"; r.reason = e instanceof Error ? e.message : String(e);
      results.push(r);
    }
  }

  await logRuntime({
    organizationId: organization_id,
    module: "copilot",
    action: "recover_stuck_conversations",
    status: "success",
    payloadSnapshot: {
      dry_run: dryRun,
      total: lead_ids.length,
      sent: results.filter((x) => x.status === "sent").length,
      skipped: results.filter((x) => x.status === "skipped").length,
    },
  });

  return new Response(JSON.stringify({ dry_run: dryRun, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}));
