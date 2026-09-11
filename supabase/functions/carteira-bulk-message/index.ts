import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import {
  resolveInstance,
  sendTextViaInstance,
  normalizeBrazilianPhone,
} from "../_shared/whatsapp-dispatch.ts";
import { getTimeBasedVariables } from "../_shared/time-variables.ts";
import { persistOutboundMessage } from "../_shared/action-handlers/whatsapp-helpers.ts";
import { sleepJitter } from "../_shared/anti-ban-jitter.ts";

// Anti-ban Onda 0 QW3: espaçamento 3–8s entre envios do lote. Este endpoint é
// SÍNCRONO (o admin espera a resposta HTTP), então o jitter tem um budget de
// wall clock: estourou o budget, o loop CONTINUA ENVIANDO sem espaçamento —
// degrada a proteção, nunca derruba a request nem perde um cliente do lote.
const JITTER_BUDGET_MS = 90_000;
import { getActiveGestorForOrg, gestorRuntimeActor } from "../_shared/gestor-auth.ts";
import { logRuntime } from "../_shared/logger.ts";
import { personalizationFirstName } from "../_shared/lead-name.ts";

interface BulkMessageRequest {
  organization_id: string;
  client_ids: string[];
  message_template: string;
}

interface ClientData {
  id: string;
  name: string | null;
  company: string | null;
  segment: string | null;
  avg_ticket: number | null;
  days_since_last_order: number | null;
  health_score: number | null;
  reorder_cycle_days: number | null;
  lifetime_value: number | null;
  lead_id: string | null;
  lead: { phone: string | null; name: string | null; email: string | null } | null;
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function resolveVariables(template: string, client: ClientData): string {
  const timeVars = getTimeBasedVariables();
  const firstName = personalizationFirstName(client.name ?? client.lead?.name);

  const vars: Record<string, string> = {
    nome: client.name ?? client.lead?.name ?? "",
    primeiro_nome: firstName,
    empresa: client.company ?? "",
    segmento: client.segment ?? "",
    ticket_medio: client.avg_ticket != null ? formatBRL(client.avg_ticket) : "—",
    dias_sem_pedido: client.days_since_last_order?.toString() ?? "—",
    health_score: client.health_score?.toString() ?? "—",
    ciclo: client.reorder_cycle_days?.toString() ?? "—",
    ltv: client.lifetime_value != null ? formatBRL(client.lifetime_value) : "—",
    email: client.lead?.email ?? "",
    saudacao: timeVars.saudacao,
    data: timeVars.data,
    hora: timeVars.hora,
  };

  return template.replace(/\{(\w+)\}/g, (match, key) => vars[key] ?? match);
}

Deno.serve(
  withErrorBoundary("carteira-bulk-message", async (req: Request) => {
    const corsHeaders = getCorsHeaders(req.headers.get("origin"));

    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: withSecurityHeaders(corsHeaders) });
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" }) },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { authorization: authHeader } },
    });

    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" }) },
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    const body: BulkMessageRequest = await req.json();
    const { organization_id, client_ids, message_template } = body;

    if (!organization_id || !client_ids?.length || !message_template?.trim()) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" }) },
      );
    }

    const { data: member } = await supabaseAdmin
      .from("team_members")
      .select("id, role")
      .eq("user_id", user.id)
      .eq("organization_id", organization_id)
      .maybeSingle();

    // ADR-0021 §7: `gestores.id` real quando o ator é um Gestor (não team_member
    // da org). Resolve o id — não só um booleano — para atribuir a escrita
    // cross-org ao ator real na trilha forense.
    let gestorId: string | undefined;
    if (!member) {
      // Gestor de Portfólio (scoped master — ADR-0021 §6): ator fora de
      // team_members com escrita operacional full na org vinculada. Disparo de
      // mensagem em massa da carteira = operação → liberado.
      const gestorCtx = await getActiveGestorForOrg(supabaseAdmin, user.id, organization_id);
      if (!gestorCtx) {
        return new Response(
          JSON.stringify({ error: "Not a member of this organization" }),
          { status: 403, headers: withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" }) },
        );
      }
      gestorId = gestorCtx.gestorId;
    }

    const { data: clients } = await supabaseAdmin
      .from("upsell_clients")
      .select("id, name, company, segment, avg_ticket, days_since_last_order, health_score, reorder_cycle_days, lifetime_value, lead_id, lead:leads(phone, name, email)")
      .eq("organization_id", organization_id)
      .in("id", client_ids);

    if (!clients?.length) {
      return new Response(
        JSON.stringify({ error: "No clients found", results: [] }),
        { status: 200, headers: withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" }) },
      );
    }

    const instance = await resolveInstance(supabaseAdmin, organization_id, {
      requireConnected: false,
    });

    if (!instance) {
      return new Response(
        JSON.stringify({ error: "No WhatsApp instance configured" }),
        { status: 400, headers: withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" }) },
      );
    }

    const results: Array<{ client_id: string; name: string; success: boolean; error?: string }> = [];
    const loopStartedAt = Date.now();
    let dispatched = 0;

    for (const client of clients as ClientData[]) {
      const phone = client.lead?.phone;
      const normalized = normalizeBrazilianPhone(phone);

      if (!normalized) {
        results.push({ client_id: client.id, name: client.name ?? "—", success: false, error: "Sem telefone" });
        continue;
      }

      // Anti-ban jitter (Onda 0 QW3): entre envios reais, nunca antes do
      // primeiro, e só enquanto couber no budget (request síncrona).
      if (dispatched > 0 && Date.now() - loopStartedAt < JITTER_BUDGET_MS) {
        await sleepJitter();
      }
      dispatched++;

      const resolvedMessage = resolveVariables(message_template, client);

      const sendResult = await sendTextViaInstance(
        supabaseAdmin,
        instance,
        normalized,
        resolvedMessage,
        { trackSource: "carteira_bulk" },
      );

      results.push({
        client_id: client.id,
        name: client.name ?? "—",
        success: sendResult.success,
        error: sendResult.error,
      });

      // `channel_messages` (abaixo) alimenta a timeline do lead; NÃO alimenta o
      // chat, que lê `whatsapp_messages`. Sem esta linha o disparo da carteira
      // some da conversa e, pior, o eco `fromMe` volta rotulado `manual` — e o
      // `trg_human_pause_on_manual_send` pausa o Copilot de CADA cliente do lote.
      // Só no sucesso: sem entrega não há id de provider com que casar o eco.
      if (sendResult.success) {
        // `as never`: esta função fixa `supabase-js@2.49.4` no import e o helper
        // importa `@2`. São a MESMA classe em runtime, mas os genéricos de
        // `SupabaseClient` mudaram de aridade entre as versões, então o
        // structural check falha em `supabaseUrl` (protected). Alinhar a versão
        // aqui trocaria um erro de tipo por uma troca de versão em runtime, que
        // é o risco maior. O cast é local e não afrouxa a assinatura do helper
        // para os outros dez chamadores.
        await persistOutboundMessage(supabaseAdmin as never, {
          organizationId: organization_id,
          instanceId: instance.id,
          providerMessageId: sendResult.messageId,
          phone: normalized,
          messageType: "conversation",
          content: resolvedMessage,
          leadId: client.lead_id,
          sentSource: "workflow",
          fallbackIdPrefix: "carteira",
        });
      }

      if (client.lead_id) {
        await supabaseAdmin.from("channel_messages").insert({
          organization_id,
          lead_id: client.lead_id,
          direction: "outbound",
          channel: "whatsapp",
          content: resolvedMessage,
          // Gestor não tem team_member (member null) → atribui ao ator real
          // (user.id), coerente com a atribuição forense do ADR-0021 §7.
          sender_name: member?.id ?? user.id,
          metadata: { source: "carteira_bulk", client_id: client.id },
        }).then(() => {});
      }
    }

    const sent = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    // ADR-0021 §7: disparo em massa é escrita de gestor DENTRO de dados de um
    // cliente. Registra a trilha forense atribuída ao ator REAL (gestor_id +
    // triggered_by = user.id real), respondendo "quem disparou?" com o gestor,
    // nunca um membro genérico. Só quando gestor — membro comum não polui o log
    // com colunas de atribuição de gestor (ver logger.ts / migration 20270211000003).
    if (gestorId) {
      await logRuntime({
        ...gestorRuntimeActor(user.id, gestorId),
        organizationId: organization_id,
        module: "carteira",
        action: "carteira_bulk_message",
        status: failed > 0 && sent === 0 ? "error" : "success",
        entityType: "organization",
        entityId: organization_id,
        payloadSnapshot: { sent, failed, total: results.length },
      });
    }

    return new Response(
      JSON.stringify({ sent, failed, total: results.length, results }),
      { status: 200, headers: withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" }) },
    );
  }),
);
