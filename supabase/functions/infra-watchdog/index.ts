/**
 * infra-watchdog — vigia o que ninguém estava vigiando.
 *
 * Nasceu de dois incidentes que só foram descobertos por acaso:
 *
 *   1. 2026-08-06 — o pool de conexões do Postgres esgotou e o produto ficou 42
 *      minutos sem gravar mensagem de WhatsApp. Ninguém foi avisado; o CTO
 *      percebeu ao abrir o painel por outro motivo.
 *   2. 2026-07-14 a 2026-08-06 — o token da instância de suporte foi revogado e
 *      o aviso de Chamado novo passou a tomar 401 da Uazapi. 35 chamados
 *      entraram sem que ninguém fosse notificado, por 23 dias. O único vestígio
 *      era uma linha de erro em `runtime_logs`, que ninguém lê.
 *
 * O segundo caso ensina a regra de ouro deste arquivo: **um alerta que depende
 * do canal que ele vigia não é alerta.** Por isso o watchdog usa secrets
 * próprias (`WATCHDOG_UAZAPI_TOKEN` / `WATCHDOG_WHATSAPP_JID`), com as do
 * suporte apenas como reserva. Se as duas apontarem para a mesma credencial, o
 * watchdog perde a capacidade de avisar justamente quando ela quebra — e ele diz
 * isso em voz alta em `runtime_logs`.
 *
 * Disparado por pg_cron a cada 2 minutos. Auth: x-cron-secret.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { logRuntime } from "../_shared/logger.ts";

// Silêncio entre avisos do mesmo assunto. Um incidente de banco dura dezenas de
// minutos; avisar a cada 2 seria ruído, e ruído treina o time a ignorar.
const ALERT_COOLDOWN_MINUTES = 30;

// Quantas falhas seguidas de um canal de aviso antes de gritar. 3 descarta
// oscilação de rede e ainda pega uma credencial morta no mesmo dia.
const NOTIFY_FAILURE_STREAK = 3;

type Alert = { key: string; text: string };

/**
 * Um assunto só volta a alertar depois do silêncio. O carimbo mora em
 * `cron_config` porque a função é stateless e roda em instância nova a cada
 * disparo.
 */
async function shouldAlert(supabase: any, key: string): Promise<boolean> {
  const configKey = `watchdog_last_alert_${key}`;
  const { data } = await supabase
    .from("cron_config")
    .select("value")
    .eq("key", configKey)
    .maybeSingle();

  if (data?.value) {
    const last = Date.parse(data.value);
    if (Number.isFinite(last) && Date.now() - last < ALERT_COOLDOWN_MINUTES * 60_000) {
      return false;
    }
  }

  await supabase
    .from("cron_config")
    .upsert({ key: configKey, value: new Date().toISOString() }, { onConflict: "key" });
  return true;
}

/** Pressão do pool acima do teto configurado. */
async function checkDbPressure(supabase: any): Promise<Alert | null> {
  const { data, error } = await supabase.rpc("db_connection_pressure");
  if (error || !data) return null;

  const { data: cfg } = await supabase
    .from("cron_config")
    .select("value")
    .eq("key", "db_pressure_alert_pct")
    .maybeSingle();
  const threshold = Number(cfg?.value) || 75;

  const pct = Number(data.pct);
  if (!Number.isFinite(pct) || pct < threshold) return null;

  return {
    key: "db_pressure",
    text:
      `🔴 *Banco sob pressão*\n\n` +
      `Conexões: *${data.used}/${data.max}* (${pct}%)\n` +
      `Ativas: ${data.active} · Ociosas em transação: ${data.idle_in_tx}\n\n` +
      `Acima de ${threshold}% o produto começa a recusar conexão — foi assim que ` +
      `o sistema caiu em 06/08.\n\n` +
      `Suspeito nº 1: importação de histórico de WhatsApp em curso.\n` +
      `Ver: history_sync_jobs onde status = 'running'.`,
  };
}

/**
 * O aviso de Chamado novo está entregando?
 *
 * Vigia `runtime_logs` porque a edge function de suporte devolve 200 mesmo
 * quando a Uazapi recusa — decisão correta (evita o trigger repetir), mas que
 * deixa todo monitor de status HTTP verde durante a falha.
 */
async function checkSupportNotifyHealth(supabase: any): Promise<Alert | null> {
  const { data } = await supabase
    .from("runtime_logs")
    .select("status, error_message, created_at")
    .eq("module", "support")
    .eq("action", "notify_staff")
    .order("created_at", { ascending: false })
    .limit(NOTIFY_FAILURE_STREAK);

  if (!data || data.length < NOTIFY_FAILURE_STREAK) return null;
  if (!data.every((r: any) => r.status === "error")) return null;

  const detail = String(data[0].error_message ?? "").slice(0, 160);
  return {
    key: "support_notify",
    text:
      `🔴 *Aviso de Chamado não está entregando*\n\n` +
      `As últimas ${NOTIFY_FAILURE_STREAK} tentativas falharam.\n` +
      `Erro: ${detail}\n\n` +
      `Chamado de cliente está entrando sem ninguém ser avisado.\n` +
      `Se for 401, o token da instância de suporte foi revogado — ` +
      `renovar SUPPORT_UAZAPI_TOKEN.`,
  };
}

/** Importação de histórico rodando fora da janela noturna, ou grande demais. */
async function checkRunawayBackfill(supabase: any): Promise<Alert | null> {
  const { data } = await supabase
    .from("history_sync_jobs")
    .select("id, organization_id, scope, total_fetched, chats_completed, total_chats")
    .eq("status", "running");

  if (!data || data.length === 0) return null;

  const heavy = data.filter((j: any) => Number(j.total_fetched) > 20_000);
  if (heavy.length === 0) return null;

  const linhas = heavy
    .map((j: any) =>
      `• ${j.scope} — ${j.total_fetched} msgs, ${j.chats_completed ?? 0}/${j.total_chats ?? "?"} conversas`)
    .join("\n");

  return {
    key: "runaway_backfill",
    text:
      `🟡 *Importação de histórico volumosa em curso*\n\n${linhas}\n\n` +
      `O freio de pressão está ativo, então isto não deve derrubar nada — ` +
      `é aviso, não emergência.\n` +
      `Para parar: status = 'cancelled' no job.`,
  };
}

async function sendWhatsApp(text: string): Promise<{ ok: boolean; detail?: string }> {
  // Secrets próprias primeiro. O fallback para as do suporte existe para o
  // watchdog nascer funcionando antes de alguém provisionar as dele — mas com
  // ele o watchdog fica cego para a falha do próprio canal de suporte, que é
  // exatamente um dos casos que ele deveria pegar.
  const token = Deno.env.get("WATCHDOG_UAZAPI_TOKEN") ?? Deno.env.get("SUPPORT_UAZAPI_TOKEN");
  const jid = Deno.env.get("WATCHDOG_WHATSAPP_JID") ?? Deno.env.get("SUPPORT_WHATSAPP_GROUP_JID");
  const baseUrl = Deno.env.get("UAZAPI_BASE_URL");

  if (!token || !jid || !baseUrl) return { ok: false, detail: "secrets ausentes" };

  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/send/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ number: jid, text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      return { ok: false, detail: `uazapi ${resp.status}: ${detail.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

Deno.serve(
  withErrorBoundary("infra-watchdog", async (req: Request): Promise<Response> => {
    const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    const cronSecret = Deno.env.get("CRON_SECRET");
    if (!cronSecret) return json({ error: "Server misconfiguration" }, 500);
    const headerSecret = req.headers.get("x-cron-secret");
    if (!headerSecret || !timingSafeCompare(headerSecret, cronSecret)) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server misconfiguration" }, 500);
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Uma sonda quebrada não pode calar as outras.
    const results = await Promise.allSettled([
      checkDbPressure(supabase),
      checkSupportNotifyHealth(supabase),
      checkRunawayBackfill(supabase),
    ]);

    const alerts = results
      .filter((r): r is PromiseFulfilledResult<Alert | null> => r.status === "fulfilled")
      .map(r => r.value)
      .filter((a): a is Alert => a !== null);

    const sent: string[] = [];
    const suppressed: string[] = [];
    const failed: string[] = [];

    for (const alert of alerts) {
      if (!(await shouldAlert(supabase, alert.key))) {
        suppressed.push(alert.key);
        continue;
      }

      const res = await sendWhatsApp(alert.text);
      if (res.ok) {
        sent.push(alert.key);
        await logRuntime({
          module: "job_monitor",
          action: "watchdog_alert",
          status: "success",
          payloadSnapshot: { alert: alert.key },
        });
      } else {
        failed.push(alert.key);
        // O alerta não saiu. Este log é o último recurso — se o WhatsApp do
        // watchdog também estiver fora, é aqui que fica o rastro.
        await logRuntime({
          module: "job_monitor",
          action: "watchdog_alert",
          status: "error",
          errorMessage: `${alert.key}: ${res.detail ?? "envio falhou"}`,
          payloadSnapshot: { alert: alert.key, message_preview: alert.text.slice(0, 200) },
        });
      }
    }

    return json({ ok: true, checked: 3, sent, suppressed, failed });
  })
);
