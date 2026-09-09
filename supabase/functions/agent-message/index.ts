import { withErrorBoundary } from '../_shared/error-boundary.ts';
import { logRuntime } from '../_shared/logger.ts';
import { trackEvent } from '../_shared/track.ts';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { findLeadByPhoneOrEmail, getOrCreateLead, normalizePhoneForSearch } from "../_shared/lead-service.ts";
import { OpenRouterClient } from "./openrouter-client.ts";
import { AgentEngine } from "./agent-engine.ts";
import { fireTrigger, hasActiveWorkflowsForTrigger } from "../_shared/workflow-trigger.ts";
import { isCopilotCanceled, logCopilotCancellation, reactivateSystemDisabledContact } from "../_shared/copilot/cancellation.ts";

// Force bundler to include provider modules (used via dynamic import in whatsapp-client)
import "../_shared/whatsapp-providers/evolution-provider.ts";
import "../_shared/whatsapp-providers/uazapi-provider.ts";

import { buildBatchContent, absorbPendingMessages } from "./batch-helpers.ts";
import { checkAudienceGate } from "./audience-gate.ts";
import { decideBlockedInboundAction } from "./gate-decision.ts";
import { resolveMediaContent } from "../_shared/audio-transcription.ts";
import { assertPlanFeature, PlanFeatureDeniedError } from "../_shared/plan-gate.ts";
import { isOrgBlocked } from "../_shared/org-status.ts";

/**
 * Webhook receptor de mensagens de leads
 * Twilio/WhatsApp → /agent-message
 */
Deno.serve(withErrorBoundary('agent-message', async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader || authHeader !== `Bearer ${supabaseKey}`) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!openRouterApiKey) {
    return new Response(JSON.stringify({ error: "OPENROUTER_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const openRouter = new OpenRouterClient(openRouterApiKey);

  try {
    // Parse webhook de Twilio ou formato genérico
    const body = await req.json();
    const { from, channel, organization_id, push_name, incoming_message_type, instance_id } = body; // from = phone number ou user_id

    // A. Batch mode: message_ids array → load + concat from channel_messages
    const isBatchMode = body.batch_mode === true && Array.isArray(body.message_ids) && body.message_ids.length > 0;
    let message: string;

    if (isBatchMode) {
      const { data: batchMsgs, error: batchErr } = await supabase
        .from("channel_messages")
        .select("content, message_type, media_url")
        .in("id", body.message_ids)
        .order("created_at", { ascending: true });

      if (batchErr || !batchMsgs || batchMsgs.length === 0) {
        console.warn('[agent-message] Batch mode: failed to load messages', { ids: body.message_ids, error: batchErr });
        return new Response(
          JSON.stringify({ error: "Failed to load batch messages", code: "BATCH_LOAD_FAILED" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const resolvedParts: string[] = [];
      for (const msg of batchMsgs) {
        const resolved = await resolveMediaContent({
          content: msg.content,
          messageType: msg.message_type || "text",
          mediaUrl: msg.media_url || null,
        });
        if (resolved) resolvedParts.push(resolved);
      }
      message = resolvedParts.join("\n");
      console.log('[agent-message] Batch mode: resolved', batchMsgs.length, 'messages into', message.length, 'chars');
    } else {
      message = await resolveMediaContent({
        content: body.message,
        messageType: incoming_message_type || "text",
        mediaUrl: body.media_url || null,
      });
    }

    // 1. IDENTIFY TENANT — organization_id is REQUIRED (security boundary).
    if (!organization_id || typeof organization_id !== 'string') {
      return new Response(
        JSON.stringify({
          error: "organization_id is required in request body",
          code: "MISSING_ORGANIZATION_ID",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Validate phone before processing — malformed phone causes silent RAG failures downstream
    if (!from || typeof from !== 'string' || from.trim().length < 8) {
      console.warn('[agent-message] Invalid or missing phone number:', { from, organization_id });
      return new Response(
        JSON.stringify({ error: "Invalid phone number in 'from' field", code: "INVALID_PHONE" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 0.8. GATE DE ASSINATURA — org suspensa/cancelada/expirada sem override.
    // Antes de QUALQUER side-effect (lock, lead, conversa) e antes do plan gate:
    // o turno do Copilot é o gasto de IA mais caro do produto, e roda como
    // service_role, fora do alcance da RLS. Sem isto, org suspensa seguia
    // pensando e respondendo.
    // 200 skipped (não 4xx) pelo mesmo motivo do plan gate: o chamador é hop
    // interno e um 4xx viraria tempestade de retry/DLQ.
    if (await isOrgBlocked(supabase, organization_id)) {
      console.log('[agent-message] Assinatura bloqueada — turno descartado:', { organization_id });
      await logRuntime({
        organizationId: organization_id,
        module: "billing",
        action: "copilot_turno_bloqueado_assinatura",
        status: "skipped",
        payloadSnapshot: { channel },
      }).catch(() => {});
      return new Response(
        JSON.stringify({ skipped: true, reason: "subscription_blocked", organization_id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 0.85. PLAN GATE — org sem copilot no plano (addon turbo entra via
    // organization_features, coberto pela RPC). Roda ANTES de qualquer
    // side-effect (lock, lead, conversa). Denial = 200 skipped (não 403):
    // caller é hop interno (whatsapp-webhook/pg_net) — 4xx viraria retry/DLQ
    // storm pra org que simplesmente não tem a feature. Erro de resolução
    // propaga (500) — transiente, retry do caller é o comportamento certo.
    try {
      await assertPlanFeature(supabase, organization_id, "copilot");
    } catch (e) {
      if (e instanceof PlanFeatureDeniedError) {
        // EXCEÇÃO auto-create: materializar o lead MESMO sem a feature `copilot`
        // no plano. Auto-criar lead NÃO usa IA — sem esta exceção o plan gate
        // barra justamente as orgs-alvo do recurso (planos sem copilot, ex.
        // torque-2.0: Goletric Pinheiros / HGE Iluminação), que ligam a flag e
        // nunca viam o lead cair. getOrCreateLead é idempotente (dedup por
        // normalized_phone, trata corrida 23505) → seguro rodar antes do lock;
        // só logamos/contabilizamos quando REALMENTE cria. Flag OFF (default de
        // TODAS as orgs) = comportamento byte-a-byte anterior (plan_denied puro).
        const { data: planFlagRow, error: planFlagError } = await supabase
          .from("organizations")
          .select("auto_create_lead_on_inbound")
          .eq("id", organization_id)
          .maybeSingle();
        if (planFlagError) {
          console.warn('[agent-message] Falha ao ler auto_create_lead_on_inbound no plan gate (fail-safe OFF):', { organization_id, error: planFlagError.message });
        }
        if (planFlagRow?.auto_create_lead_on_inbound === true) {
          const normalizedPhone = normalizePhoneForSearch(from);
          const result = await getOrCreateLead(supabase, {
            organizationId: organization_id,
            phone: from,
            pushName: push_name,
            origin: "whatsapp",
          });
          if (result?.created) {
            console.log('[agent-message] Auto-created lead (plan denied, sem copilot):', { organization_id, phone: normalizedPhone });
            await logRuntime({
              organizationId: organization_id,
              module: "copilot",
              action: "auto_create_lead_on_inbound",
              status: "success",
              payloadSnapshot: { organization_id, phone: normalizedPhone, gate: "plan_denied" },
            });
          }
          return new Response(
            JSON.stringify({ skipped: true, reason: "lead_created_no_plan", organization_id }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        console.log('[agent-message] Plan gate — org sem copilot:', { organization_id, plan: e.planName });
        return new Response(
          JSON.stringify({
            skipped: true,
            reason: "plan_denied",
            feature: "copilot",
            plan: e.planName,
            organization_id,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw e;
    }

    // 0.9. DEDUP GATE — DB-level lock, cross-isolate safe (replaces in-memory inFlightMap)
    const { data: lockAcquired } = await supabase
      .rpc("acquire_copilot_lock", { p_phone: from, p_organization_id: organization_id });

    if (!lockAcquired) {
      console.log('[agent-message] Lock denied — already processing:', { from, organization_id });
      return new Response(
        JSON.stringify({ skipped: true, reason: "dedup_concurrent", from }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 0.96. AUTO-CREATE-LEAD FLAG (feature aditiva) — lida UMA vez, dentro da
    // região travada pelo lock. Se ON, os dois gates abaixo (sem agente ativo /
    // audience blocked) criam o lead antes de sair, em vez de só bailar. Se OFF
    // (default de TODAS as orgs), os gates se comportam byte-a-byte como hoje.
    // Fail-safe: qualquer erro de leitura → OFF (não cria lead), mas logamos
    // pra não virar no-op silencioso quando a coluna faltar num ambiente.
    // Ver migration 20270211000000_org_auto_create_lead_on_inbound.
    let autoCreateLead = false;
    {
      const { data: orgFlagRow, error: orgFlagError } = await supabase
        .from("organizations")
        .select("auto_create_lead_on_inbound")
        .eq("id", organization_id)
        .maybeSingle();
      if (orgFlagError) {
        console.warn('[agent-message] Falha ao ler auto_create_lead_on_inbound (fail-safe OFF):', { organization_id, error: orgFlagError.message });
      }
      autoCreateLead = orgFlagRow?.auto_create_lead_on_inbound === true;
    }

    // 0.97. TRIGGER lead_replied — ANTES dos gates de Copilot, de propósito.
    //
    // Este trigger é de AUTOMAÇÃO, não de IA: "o lead respondeu" é um fato do
    // inbound, independente de a org ter Copilot. Ele ficava lá embaixo (passo
    // 1.7, depois do AGENT ACTIVE GATE), então só 17 das 99 orgs conseguiam
    // alcançá-lo. Resultado medido em PROD 2026-08-11: ZERO workflows
    // `lead_replied` e ZERO execuções em toda a história. O gate tornava o
    // trigger inalcançável, não impopular.
    //
    // ⚠️ Isto alcança 60 das 99 orgs, não as 99 (medido em PROD 2026-08-12).
    // Das 82 que não chegavam aqui, 43 saíam no 0.95 e são o que esta mudança
    // destrava; as outras 39 morrem ANTES, no PLAN GATE do passo 0.85
    // (`plan_denied`, ou `lead_created_no_plan` quando a org tem
    // `auto_create_lead_on_inbound`), porque o plano delas não inclui a feature
    // `copilot` — inclusive orgs que TÊM `automations`. Subir o disparo acima
    // do 0.85 não é opção: passaria na frente do lock de dedup (0.9) e
    // perderíamos a garantia de disparo único. O caminho certo seria gatear o
    // 0.97 por `automations` em vez de herdar o veredito de `copilot`. Fora do
    // escopo desta fatia.
    //
    // Ordem importa: roda depois do lock de dedup (0.9), então mensagens
    // concorrentes do mesmo telefone não disparam duas vezes.
    //
    // Lookup SEM criação (`findLeadByPhoneOrEmail`, não `getOrCreateLead`):
    // telefone desconhecido não é "resposta", é primeiro contato — esse caso é
    // do `lead_created`. Mudança de comportamento consciente: o passo 1.7
    // ficava depois do `identifyTenant`, que CRIA o lead, então um primeiro
    // inbound de número novo disparava `lead_replied`. Sem base instalada,
    // ninguém regride.
    //
    // A guarda `hasActiveWorkflowsForTrigger` existe para não pagar um lookup
    // de lead por mensagem em toda a frota: sem workflow do tipo, sai em uma
    // query indexada.
    //
    // `source: "copilot"` é mantido: o origin guard do fireTrigger descarta
    // workflows que contenham nó de copilot, evitando laço IA↔automação. Efeito
    // colateral herdado (não introduzido aqui): um workflow com nó de Copilot
    // nunca dispara por `lead_replied`.
    //
    // Passa também na frente dos gates 1.0 (audiência) e 1.5 (IA desligada
    // para o lead), e isso é deliberado: aqueles gates governam se a IA
    // RESPONDE, não se o lead respondeu. Desligar a chavinha de IA de um
    // contato não deve calar uma automação que não usa IA — e a que usa já é
    // barrada pelo origin guard acima.
    if (await hasActiveWorkflowsForTrigger(supabase, organization_id, "lead_replied")) {
      const repliedLead = await findLeadByPhoneOrEmail(supabase, organization_id, from);
      if (repliedLead) {
        // Awaited, não fire-and-forget: os gates abaixo fazem early-return e o
        // isolate pode ser derrubado antes de uma promise solta terminar —
        // justamente no caso (org sem Copilot) que esta mudança veio destravar.
        await fireTrigger({
          supabase,
          organizationId: organization_id,
          triggerType: "lead_replied",
          leadId: repliedLead.id,
          // `instance_id` é o insumo do filtro por número de origem. Chega do
          // whatsapp-webhook (e do copilot-batch-processor); quando ausente, o
          // matcher reprova por fail-closed qualquer workflow que filtre por
          // número — nunca dispara achando que é "qualquer número".
          context: { trigger: "lead_replied", channel, message, instance_id },
          source: "copilot",
        }).catch((err) => {
          console.warn('[agent-message] fireTrigger lead_replied falhou:', err?.message ?? err);
        });
      }
    }

    // 0.95. AGENT ACTIVE GATE (early) — sem nenhum agente ativo na org,
    // não há motivo pra criar lead fantasma a partir de uma msg que ninguém
    // vai responder. Roda ANTES de getOrCreateLead pra evitar poluir o pipe
    // com contatos órfãos quando Copilot está totalmente desligado.
    // EXCEÇÃO: se auto_create_lead_on_inbound=ON, materializa o lead (funil
    // WhatsApp / etapa novo / sem dono) e mesmo assim sai (não há IA pra
    // responder). Ver decideBlockedInboundAction (gate-decision.ts).
    {
      const { data: activeAgentEarly } = await supabase
        .from("copilot_agents")
        .select("id")
        .eq("organization_id", organization_id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (!activeAgentEarly) {
        const decision = decideBlockedInboundAction("no_active_agents", autoCreateLead);
        if (decision.createLead) {
          const normalizedPhone = normalizePhoneForSearch(from);
          // getOrCreateLead é idempotente e faz o lookup por normalized_phone;
          // só logamos/contabilizamos como auto-criação quando REALMENTE criou
          // (telefone já conhecido devolve created=false, sem ruído no hot path).
          const result = await getOrCreateLead(supabase, {
            organizationId: organization_id,
            phone: from,
            pushName: push_name,
            origin: "whatsapp",
          });
          if (result?.created) {
            console.log('[agent-message] Auto-created lead (no active agents):', { organization_id, phone: normalizedPhone });
            await logRuntime({
              organizationId: organization_id,
              module: "copilot",
              action: "auto_create_lead_on_inbound",
              status: "success",
              payloadSnapshot: { organization_id, phone: normalizedPhone, gate: "no_active_agents" },
            });
          }
        } else {
          console.log('[agent-message] No active agents for org (early gate):', organization_id);
        }
        return new Response(
          JSON.stringify({
            skipped: true,
            reason: decision.reason,
            organization_id,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // 1.0. AUDIENCE GATE — bloqueia inbound de phone desconhecido quando
    // QUALQUER agente ativo da org tem attend_unknown_contacts=false.
    // Veto org-wide (fail-closed). Roda ANTES do getOrCreateLead pra nao
    // criar lead fantasma quando filtro esta on.
    // EXCEÇÃO: se auto_create_lead_on_inbound=ON, materializa o lead e sai.
    // A IA NÃO responde NESTE turno (early-return). Mas, como o lead passa a
    // existir, o audience-gate deixa de barrar os próximos inbounds do mesmo
    // número (short-circuit `existingLead` em audience-gate.ts) → o atendimento
    // segue o fluxo normal: trigger `lead_created` dispara a automação de início
    // e a IA dá handoff quando o lead responde. NÃO é "IA nunca responde".
    {
      const normalizedPhone = normalizePhoneForSearch(from);
      if (normalizedPhone) {
        const gate = await checkAudienceGate(supabase, organization_id, normalizedPhone);
        if (gate.blocked) {
          const decision = decideBlockedInboundAction("audience_blocked", autoCreateLead);
          let leadCreated = false;
          if (decision.createLead) {
            const result = await getOrCreateLead(supabase, {
              organizationId: organization_id,
              phone: from,
              pushName: push_name,
              origin: "whatsapp",
            });
            leadCreated = result?.created === true;
            if (leadCreated) {
              console.log('[agent-message] Auto-created lead (audience blocked):', { organization_id, phone: normalizedPhone });
            }
          }
          await logRuntime({
            organizationId: organization_id,
            module: "copilot",
            action: leadCreated ? "auto_create_lead_on_inbound" : "audience_gate_block",
            status: "success",
            payloadSnapshot: {
              phone: normalizedPhone,
              agent_id: gate.agentId,
              gate: "audience_blocked",
              reason: decision.reason,
            },
          });
          return new Response(
            JSON.stringify({
              skipped: true,
              reason: decision.reason,
              organization_id,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
    }

    const { lead, organizationId } = await identifyTenant(supabase, from, channel, organization_id, push_name);

    if (!lead || !organizationId) {
      return new Response(JSON.stringify({ error: "Lead not found or organization not identified" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 1.5. CHECK IF AI IS DISABLED FOR THIS LEAD (F5a 2026-04-26: canonical)
    // Lê phone_ai_preferences (fonte de verdade) com fallback leads.ai_disabled.
    // Antes lia só lead.ai_disabled (denormalizado) — drift se sync falhasse.
    const initialCancel = await isCopilotCanceled(supabase, organizationId, from);
    if (initialCancel.canceled) {
      // Reativação REATIVA: se o bloqueio veio do desligamento em massa do
      // sistema (bulk SQL, sem usuário), a mensagem do lead religa SÓ este
      // contato e o turno segue normalmente. Manual (Adriane) e pausa humana
      // continuam bloqueando. Nada é religado proativamente — só quando o lead
      // escreve. Ver reactivateSystemDisabledContact / systemDisabled.
      if (initialCancel.systemDisabled) {
        await reactivateSystemDisabledContact(supabase, organizationId, from, lead.id);
        console.log('[agent-message] Reativado contato (bulk sistema) no inbound:', lead.id);
        // não retorna — cai no fluxo normal e responde
      } else {
        console.log('[agent-message] AI disabled for lead:', lead.id, 'source:', initialCancel.source);
        return new Response(JSON.stringify({
          skipped: true,
          reason: "AI disabled for this lead",
          lead_id: lead.id,
          source: initialCancel.source,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // 1.55. HUMAN PAUSE GATE — coberto pelo initialCancel acima (1.5).
    // isCopilotCanceled é phone-keyed e lê phone_ai_preferences.human_paused_until,
    // então funciona mesmo em cold-start (lead/conversa ainda não existem) e é
    // re-checado per-chunk no envio escalonado. Quando source='human_pause' o
    // early-return em 1.5 já barra o turno. Gate dedicado removido (era
    // conversa-dependente → não armava em cold-start). Ver cancellation.ts.

    // 1.6. AGENT ACTIVE GATE — fresh DB check (bypasses 5min LRU cache)
    const { data: activeAgent } = await supabase
      .from("copilot_agents")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (!activeAgent) {
      console.log('[agent-message] No active agents for org:', organizationId);
      return new Response(JSON.stringify({
        skipped: true,
        reason: "no_active_agents",
        organization_id: organizationId,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 1.7. (movido) O trigger `lead_replied` agora dispara no passo 0.97, antes
    // dos gates de Copilot — ver o comentário lá para o porquê.

    // 2. ROUTE engine version (Trilha 3.B B3 feature flag)
    // Hoje v1==v2 funcionalmente (refactor B1 transparente). Flag preparado
    // pra A/B comparison futura quando v2 divergir.
    const { data: orgRow } = await supabase
      .from("organizations")
      .select("copilot_engine_version")
      .eq("id", organizationId)
      .maybeSingle();
    const engineVersion = (orgRow?.copilot_engine_version as string) ?? "v1";

    // 2.5 INITIALIZE AGENT ENGINE
    const engine = new AgentEngine(supabase, openRouter, organizationId);

    // 2.5 TYPING INDICATOR — item #10 — fire-and-forget, não bloqueia
    sendTypingIndicator(supabase, from, organizationId)
      .catch(e => console.warn('[agent-message] Typing indicator failed (non-fatal):', e));

    // 3. PROCESS MESSAGE (toda lógica está aqui)
    const response = await engine.processMessage(lead.id, message, incoming_message_type);

    // 3.1 CANCELLATION GATE pós-LLM (RC-cancel, 2026-04-26):
    // user pode ter desligado o switch DURANTE a chamada LLM (~5-30s).
    // Se cancelado, retornamos skipped e NÃO entregamos a resposta — caller
    // (sz-chat-webhook etc) não dispara sendSzChatResponse.
    const cancelCheck = await isCopilotCanceled(supabase, organizationId, from);
    if (cancelCheck.canceled) {
      console.log('[agent-message] Canceled mid-LLM — skipping delivery for lead:', lead.id);
      const evalMeta = (response as any)._eval_meta;

      // Decisão CTO 2026-04-26: reply cancelada NÃO entra no histórico
      // (não pode poluir memória do agente em turnos futuros).
      // Engine.processMessage já persistiu via updateConversationState — desfazemos.
      if (evalMeta?.conversationId && !evalMeta.conversationId.startsWith('temp_')) {
        try {
          const since = new Date(Date.now() - 60_000).toISOString();
          // Delete by message ID if available (reliable); fallback: last assistant message in window
          const deleteQuery = supabase
            .from('conversation_messages')
            .delete()
            .eq('conversation_id', evalMeta.conversationId)
            .eq('role', 'assistant')
            .gte('created_at', since);
          if (evalMeta.lastAssistantMessageId) {
            deleteQuery.eq('id', evalMeta.lastAssistantMessageId);
          }
          const { error: delErr } = await deleteQuery;
          if (delErr) {
            console.warn('[agent-message] Failed to delete canceled assistant message:', delErr.message);
          }
        } catch (e) {
          console.warn('[agent-message] Exception deleting canceled assistant message:', e);
        }
      }

      logCopilotCancellation({
        organizationId,
        gate: "post_llm",
        leadId: lead.id,
        conversationId: evalMeta?.conversationId,
        phone: from,
        source: cancelCheck.source,
      });
      return new Response(JSON.stringify({
        skipped: true,
        reason: "ai_disabled_during_processing",
        canceled_gate: "post_llm",
        lead_id: lead.id,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 3.5 Item #8: LLM-as-a-judge — avaliar qualidade da resposta (fire-and-forget)
    if (response.message && (response as any)._eval_meta) {
      const evalMeta = (response as any)._eval_meta;
      evaluateConversation({
        organizationId,
        leadId: lead.id,
        userMessage: message,
        agentResponse: response.message,
        conversationId: evalMeta.conversationId,
        agentId: evalMeta.agentId,
        turnCount: evalMeta.turnCount,
        systemPromptExcerpt: evalMeta.systemPromptExcerpt,
      }).catch(e => console.warn('[agent-message] Evaluation failed (non-fatal):', e));
    }

    // 4. TRACK USAGE EVENT (fire-and-forget) — inclui engine_version pra A/B telemetry
    trackEvent({
      organizationId,
      eventType: "message_sent",
      entityType: "lead",
      entityId: lead.id,
      metadata: { channel, action: response.action, hasMessage: !!response.message, engine_version: engineVersion },
    }).catch(() => {});

    // 5. LOG SUCCESS
    await logRuntime({
      organizationId,
      module: 'copilot',
      action: response.action || 'process_message',
      status: 'success',
      entityType: 'lead',
      entityId: lead.id,
      payloadSnapshot: { channel, action: response.action, hasMessage: !!response.message },
    });

    // 5.5. POST-LLM ABSORB LOOP — pick up messages that arrived during LLM processing
    try {
      const { iterations, messagesProcessed } = await absorbPendingMessages({
        supabase,
        engine,
        leadId: lead.id,
        from,
        organizationId,
      });
      if (iterations > 0) {
        console.log('[agent-message] Absorb loop:', { iterations, messagesProcessed });
      }
    } catch (absorbErr) {
      // Absorb loop failure is non-fatal — primary response already generated
      console.warn('[agent-message] Absorb loop failed (non-fatal):', absorbErr);
    }

    // 6. RELEASE LOCK — reduce blocking window from 60s to actual processing time
    supabase.from("copilot_processing_locks")
      .delete()
      .eq("phone", from)
      .eq("organization_id", organizationId)
      .then(({ error: relErr }) => {
        if (relErr) console.warn("[agent-message] Lock release failed (non-fatal):", relErr.message);
      });

    // 7. RETURN RESPONSE (strip internal _eval_meta before sending)
    const { _eval_meta: _unused, ...publicResponse } = response as any;
    return new Response(JSON.stringify(publicResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    // Best-effort lock release on error — variables may not be defined if error is early
    try {
      if (typeof from === "string" && typeof organization_id === "string") {
        await supabase.from("copilot_processing_locks")
          .delete()
          .eq("phone", from)
          .eq("organization_id", organization_id);
      }
    } catch { /* swallow */ }
    console.error('[agent-message] Error:', error);
    await logRuntime({
      module: 'copilot',
      action: 'process_message',
      status: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}));

/**
 * Item #10: Typing indicator — envia presença "composing" via Evolution API
 * antes do AgentEngine processar a mensagem, para o lead ver que está digitando.
 */
async function sendTypingIndicator(
  supabase: ReturnType<typeof createClient>,
  phone: string,
  organizationId: string
): Promise<void> {
  try {
    const { data: instance } = await supabase
      .from("whatsapp_instances")
      .select("*")
      .eq("organization_id", organizationId)
      // Meta isolation (cert Rule 2): typing indicator only for legacy senders.
      .in("provider", ["uazapi", "evolution"])
      .in("status", ["open", "connected"])
      .limit(1)
      .maybeSingle();

    if (!instance) return;

    const { getWhatsAppProvider } = await import(
      "../_shared/whatsapp-client.ts"
    );
    const { normalizeBrazilianPhone } = await import(
      "../_shared/whatsapp-dispatch.ts"
    );

    const normalizedPhone = normalizeBrazilianPhone(phone);
    if (!normalizedPhone) return;

    const provider = await getWhatsAppProvider(instance, supabase);
    await provider.setPresence(normalizedPhone, "composing");
  } catch {
    // best-effort — typing indicator is non-critical
  }
}

/**
 * Identifica tenant baseado no phone/session
 * Usa o serviço centralizado lead-service para busca/criação de leads
 */
async function identifyTenant(
  supabase: ReturnType<typeof createClient>,
  from: string,
  channel: string,
  providedOrgId?: string,
  pushName?: string
): Promise<{ lead: any; organizationId: string } | { lead: null; organizationId: null }> {
  const normalizedPhone = normalizePhoneForSearch(from);

  console.log('[agent-message] identifyTenant:', {
    from,
    normalizedPhone,
    providedOrgId,
    pushName
  });

  // Se organization_id foi fornecido, usar serviço centralizado
  if (providedOrgId) {
    const result = await getOrCreateLead(supabase, {
      organizationId: providedOrgId,
      phone: from,
      pushName,
      origin: 'whatsapp',
    });

    if (result) {
      // Buscar ai_disabled do lead (não vem do getOrCreateLead)
      const { data: leadExtra } = await supabase
        .from('leads')
        .select('ai_disabled')
        .eq('id', result.lead.id)
        .maybeSingle();

      const lead = { ...result.lead, ai_disabled: leadExtra?.ai_disabled ?? false };

      console.log('[agent-message] Lead resolved:', {
        leadId: lead.id,
        leadName: lead.name,
        created: result.created,
        source: result.source,
        ai_disabled: lead.ai_disabled,
      });
      return { lead, organizationId: lead.organization_id };
    }

    console.error('[agent-message] Failed to get or create lead');
    return { lead: null, organizationId: null };
  }

  // SECURITY: the legacy cross-tenant lookup (by phone, without
  // organization_id) was removed. It allowed a caller with service_role to
  // hit agent-message without an org_id and automatically bind to whatever
  // lead existed globally for that phone — a cross-tenant boundary leak.
  //
  // Every legitimate caller today (sz-chat-webhook, whatsapp-webhook,
  // evolution-webhook, internal scripts) MUST pass organization_id in the
  // body. Callers that do not are a bug and must be fixed at the source.
  console.error(
    '[agent-message] organization_id MISSING in request — rejecting. Caller must send organization_id.',
    { from, channel, normalizedPhone },
  );
  return { lead: null, organizationId: null };
}

/**
 * Item #8: LLM-as-a-judge — chama a edge function de avaliação em background.
 * Fire-and-forget: nunca bloqueia a resposta ao lead.
 */
async function evaluateConversation(params: {
  organizationId: string;
  leadId: string;
  userMessage: string;
  agentResponse: string;
  conversationId: string;
  agentId: string;
  turnCount: number;
  systemPromptExcerpt: string;
}): Promise<void> {
  // Apenas avaliar a cada 3 turnos para reduzir custo de API
  if (params.turnCount % 3 !== 0) return;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return;

  await fetch(
    `${supabaseUrl}/functions/v1/evaluate-agent-conversation`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(params),
    }
  );
}
