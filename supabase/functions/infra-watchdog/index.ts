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
 *   3. 2026-08-11 — seis tabelas de backup criadas à mão em produção ficaram
 *      legíveis por `anon`, uma delas com credencial viva de envio de WhatsApp.
 *      Terceira repetição da mesma classe. O INV-5 (migration `20270811120000`)
 *      passou a detectá-las — escrevendo em `runtime_logs`, a mesma tabela do
 *      caso 2. **Detectar não é alertar**, e é por isso que
 *      `checkExposedTables` mora aqui: sem consumidor, o detector seria mais
 *      uma feature construída e nunca ligada.
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

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { logRuntime } from "../_shared/logger.ts";
import { buildInv5AlertText, buildInv5PayloadFromRows } from "../_shared/inv5-alert.ts";
import { resolveSupportSender, sendSupportText } from "../_shared/support-channel.ts";

// Silêncio entre avisos do mesmo assunto. Um incidente de banco dura dezenas de
// minutos; avisar a cada 2 seria ruído, e ruído treina o time a ignorar.
const ALERT_COOLDOWN_MINUTES = 30;

// Quantas falhas seguidas de um canal de aviso antes de gritar. 3 descarta
// oscilação de rede e ainda pega uma credencial morta no mesmo dia.
const NOTIFY_FAILURE_STREAK = 3;

type Alert = {
  key: string;
  text: string;
  cooldownMinutes?: number;
  /** Detalhe que acompanha o rastro em `runtime_logs` quando o aviso sai. */
  logPayload?: Record<string, unknown>;
};

/**
 * Um assunto só volta a alertar depois do silêncio. O carimbo mora em
 * `cron_config` porque a função é stateless e roda em instância nova a cada
 * disparo.
 */
async function shouldAlert(
  supabase: SupabaseClient,
  key: string,
  cooldownMinutes: number = ALERT_COOLDOWN_MINUTES,
): Promise<boolean> {
  const configKey = `watchdog_last_alert_${key}`;
  const { data } = await supabase
    .from("cron_config")
    .select("value")
    .eq("key", configKey)
    .maybeSingle();

  if (data?.value) {
    const last = Date.parse(data.value);
    if (Number.isFinite(last) && Date.now() - last < cooldownMinutes * 60_000) {
      return false;
    }
  }

  await supabase
    .from("cron_config")
    .upsert({ key: configKey, value: new Date().toISOString() }, { onConflict: "key" });
  return true;
}

/** Pressão do pool acima do teto configurado. */
async function checkDbPressure(supabase: SupabaseClient): Promise<Alert | null> {
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
async function checkSupportNotifyHealth(supabase: SupabaseClient): Promise<Alert | null> {
  const { data } = await supabase
    .from("runtime_logs")
    .select("status, error_message, created_at")
    .eq("module", "support")
    .eq("action", "notify_staff")
    .order("created_at", { ascending: false })
    .limit(NOTIFY_FAILURE_STREAK);

  if (!data || data.length < NOTIFY_FAILURE_STREAK) return null;
  if (!data.every((r: { status: string | null }) => r.status === "error")) return null;

  const detail = String(data[0].error_message ?? "").slice(0, 160);
  return {
    key: "support_notify",
    text:
      `🔴 *Aviso de Chamado não está entregando*\n\n` +
      `As últimas ${NOTIFY_FAILURE_STREAK} tentativas falharam.\n` +
      `Erro: ${detail}\n\n` +
      `Chamado de cliente está entrando sem ninguém ser avisado.\n\n` +
      `A credencial vem da instância conectada apontada em cron_config ` +
      `(support_sender_org_id / support_sender_instance_id). 401 = token da ` +
      `instância revogado; 503 "session is not reconnectable" = a linha ` +
      `deslogou e precisa ser repareada no Uazapi.`,
  };
}

// Escrita de backfill, somada por org, acima da qual vale avisar. O incidente
// sustentou ~500/min por 7 minutos (3.500 linhas) antes do colapso; 1.500 em 5
// minutos (300/min) pega o mesmo padrão bem antes de doer.
const BACKFILL_BURST_ROWS = 1_500;
const BACKFILL_BURST_MINUTES = 5;

/**
 * Backfill escrevendo rápido demais.
 *
 * A primeira versão disto media `total_fetched` de jobs em `running` — e a
 * produção mostrou o erro em minutos: os jobs antigos da fila entram em
 * `running` por instantes a cada tick do worker, e qualquer um deles com
 * histórico acumulado grande disparava o alerta. Zero job rodando de fato,
 * alerta mesmo assim, ~48 vezes por dia.
 *
 * O que interessa não é quanto um job já baixou algum dia — é quanto está sendo
 * escrito AGORA. `history_sync_write_budget` guarda exatamente isso, por org e
 * por minuto, e é alimentada pelo próprio worker a cada lote.
 */
async function checkRunawayBackfill(supabase: SupabaseClient): Promise<Alert | null> {
  const desde = new Date(Date.now() - BACKFILL_BURST_MINUTES * 60_000).toISOString();

  const { data } = await supabase
    .from("history_sync_write_budget")
    .select("organization_id, rows_written")
    .gte("minute_bucket", desde);

  if (!data || data.length === 0) return null;

  const porOrg = new Map<string, number>();
  for (const linha of data) {
    const atual = porOrg.get(linha.organization_id) ?? 0;
    porOrg.set(linha.organization_id, atual + Number(linha.rows_written ?? 0));
  }

  const quentes = [...porOrg.entries()].filter(([, linhas]) => linhas >= BACKFILL_BURST_ROWS);
  if (quentes.length === 0) return null;

  const nomes = new Map<string, string>();
  const { data: orgs } = await supabase
    .from("organizations")
    .select("id, name")
    .in("id", quentes.map(([id]) => id));
  for (const o of orgs ?? []) nomes.set(o.id, o.name);

  const linhas = quentes
    .map(([orgId, total]) =>
      `• ${nomes.get(orgId) ?? orgId}: ${total} linhas em ${BACKFILL_BURST_MINUTES} min`)
    .join("\n");

  return {
    key: "runaway_backfill",
    text:
      `🟡 *Importação de histórico escrevendo rápido*\n\n${linhas}\n\n` +
      `O freio de pressão e a cota por organização estão ativos, então isto não ` +
      `deve derrubar nada — é aviso, não emergência.\n` +
      `Para parar: status = 'cancelled' no job.`,
  };
}

// Cooldown PRÓPRIO desta sonda: 24h, não os 30 minutos do resto do arquivo.
//
// `shouldAlert` é cooldown DESLIZANTE — regrava o carimbo toda vez que libera.
// Com 30 minutos e um watchdog que roda a cada 2, uma exposição que dure o dia
// inteiro dispara ~48 avisos, e nenhuma escolha de chave conserta isso: o que
// manda é a relação entre o cooldown e a duração do problema. (Uma versão
// anterior usava chave por linha de log achando que resolvia. Não resolvia: a
// varredura era diária, então a chave ficava constante por 24h — exatamente o
// mesmo resultado da chave fixa.)
//
// Lendo o estado ao vivo, este cooldown passa a ser o ÚNICO freio, e por isso
// fica mais importante, não menos. 24h é a cadência certa: consertar exposição
// exige mão humana no banco, então um lembrete por dia enquanto durar é
// lembrete; de meia em meia hora é ruído, e ruído treina o time a ignorar o
// canal — a lição que o cabeçalho deste arquivo existe para registrar.
const INV5_ALERT_COOLDOWN_MINUTES = 24 * 60;

/**
 * Alguma tabela de `public` está legível por `anon`/`authenticated` sem RLS?
 *
 * Este bloco é a razão de o INV-5 existir de verdade. A migration
 * `20270811120000` criou o detector e agendou uma varredura diária que escreve
 * em `runtime_logs` — e `runtime_logs` é exatamente a tabela que o cabeçalho
 * deste arquivo documenta como **não lida**. Detectar não é alertar.
 *
 * LÊ O ESTADO AO VIVO, a cada 2 minutos. Não parte da linha de log, e a razão é
 * o enunciado da fatia: o defeito original não foi "exposição existiu", foi
 * "exposição durou semanas sem ninguém saber". Uma sonda contra latência que
 * embutisse 18h de latência estrutural estaria discutindo o problema errado.
 *
 * E há um caso que só o estado ao vivo enxerga: exposição que nasce às 10:00 e
 * é removida às 16:00 não aparece em varredura NENHUMA — some sem deixar
 * registro, e é exatamente a forma que a intervenção manual em produção tem.
 *
 * A varredura diária continua viva e não muda: ela é o LEDGER, a série
 * temporal de quando o banco esteve exposto. Quem alerta e quem historia são
 * papéis distintos, e separá-los não troca auditoria por velocidade — o rastro
 * do próprio alerta vai no `runtime_logs` que o laço abaixo escreve quando o
 * aviso sai, com as tabelas no payload, que é o que torna a exposição efêmera
 * recuperável depois.
 *
 * FALSO POSITIVO DE JANELA, declarado: uma sequência de migrations que cria a
 * tabela numa e liga a RLS em OUTRA deixa uma fresta em que esta sonda acusa.
 * Dentro de uma transação não aparece; entre migrations, aparece. Com o
 * cooldown de 24h isso custa no máximo um aviso — e o aviso está CERTO, a
 * tabela esteve mesmo exposta. Não é ruído a corrigir; é o invariante
 * funcionando.
 */
async function checkExposedTables(supabase: any): Promise<Alert | null> {
  const { data: linhas, error } = await supabase.rpc("inv_public_tables_readable_by_anon");
  if (error) return null;

  const payload = buildInv5PayloadFromRows(linhas ?? []);

  // Silêncio é o estado normal, e fica sem resposta de propósito: nenhum "tudo
  // ok" diário. Canal que fala todo dia treina o time a ignorá-lo, que foi
  // exatamente como o aviso de suporte morreu 23 dias sem ninguém ver.
  if (payload.total === 0) return null;

  return {
    key: "inv5_exposed",
    cooldownMinutes: INV5_ALERT_COOLDOWN_MINUTES,
    text: buildInv5AlertText(payload, new Date().toISOString()),
    // O detalhe viaja com o alerta para o `runtime_logs` do laço: sem ele, a
    // exposição efêmera — a que nenhuma varredura diária vê — deixaria como
    // único rastro a palavra "inv5_exposed", sem dizer QUAL tabela.
    logPayload: { total: payload.total, violacoes: payload.violacoes },
  };
}

/**
 * Por onde o aviso sai.
 *
 * Secrets PRÓPRIAS primeiro (`WATCHDOG_UAZAPI_TOKEN` / `WATCHDOG_WHATSAPP_JID`).
 * Sem elas, cai no canal de suporte — resolvido do banco, não mais da secret
 * estática que morreu em 14/07 e de novo em 02/09.
 *
 * A queda de 02/09 provou o custo desse fallback: as três tentativas do alerta
 * `support_notify` saíram pela mesma instância morta que o alerta denunciava, e
 * as três tomaram o mesmo 503. O vigia virou cúmplice, exatamente como o
 * cabeçalho deste arquivo previa. Enquanto as secrets próprias não existirem, o
 * `selfBlind` abaixo carimba isso no `runtime_logs` — o remédio é um segundo
 * número, e o rastro é o que impede a lacuna de sumir de vista de novo.
 */
async function resolveChannel(
  supabase: SupabaseClient,
): Promise<
  | { ok: true; send: (text: string) => Promise<{ ok: boolean; detail?: string }>; selfBlind: boolean }
  | { ok: false; detail: string }
> {
  const ownToken = Deno.env.get("WATCHDOG_UAZAPI_TOKEN");
  const ownJid = Deno.env.get("WATCHDOG_WHATSAPP_JID");
  const baseUrl = Deno.env.get("UAZAPI_BASE_URL");

  if (ownToken && ownJid && baseUrl) {
    const sender = {
      token: ownToken,
      baseUrl,
      groupJid: ownJid,
      source: "env" as const,
    };
    return { ok: true, send: (text: string) => sendSupportText(sender, text), selfBlind: false };
  }

  const resolved = await resolveSupportSender(supabase, (k) => Deno.env.get(k));
  if (!resolved.ok) return { ok: false, detail: resolved.reason };

  return {
    ok: true,
    send: (text: string) => sendSupportText(resolved.sender, text),
    selfBlind: true,
  };
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
      checkExposedTables(supabase),
    ]);

    const alerts = results
      .filter((r): r is PromiseFulfilledResult<Alert | null> => r.status === "fulfilled")
      .map(r => r.value)
      .filter((a): a is Alert => a !== null);

    const sent: string[] = [];
    const suppressed: string[] = [];
    const failed: string[] = [];

    const channel = await resolveChannel(supabase);

    for (const alert of alerts) {
      if (!(await shouldAlert(supabase, alert.key, alert.cooldownMinutes))) {
        suppressed.push(alert.key);
        continue;
      }

      const res = channel.ok
        ? await channel.send(alert.text)
        : { ok: false, detail: channel.detail };
      if (res.ok) {
        sent.push(alert.key);
        await logRuntime({
          module: "job_monitor",
          action: "watchdog_alert",
          status: "success",
          // `self_blind` vai no caminho de SUCESSO também, e não só no de erro:
          // sem ele, um aviso entregue não diz por qual canal saiu, e o dia em
          // que as secrets próprias forem provisionadas fica indistinguível do
          // dia em que alguém as apagar sem querer.
          payloadSnapshot: {
            alert: alert.key,
            self_blind: channel.ok ? channel.selfBlind : null,
            ...(alert.logPayload ?? {}),
          },
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
          // O detalhe entra AQUI também, e aqui ele vale ainda mais que no
          // caminho de sucesso: se o envio falhou, ninguém recebeu o texto, e
          // esta linha é o ÚNICO registro do que foi encontrado. Sem ela sobrava
          // o `message_preview` de 200 chars, que carrega algumas tabelas por
          // acidente e não por desenho.
          payloadSnapshot: {
            alert: alert.key,
            message_preview: alert.text.slice(0, 200),
            // `true` quando o watchdog está usando o canal de suporte por não ter
            // o próprio: se o alerta que falhou for o `support_notify`, esta
            // linha é a explicação de por que ninguém foi avisado.
            self_blind: channel.ok ? channel.selfBlind : null,
            ...(alert.logPayload ?? {}),
          },
        });
      }
    }

    return json({ ok: true, checked: 4, sent, suppressed, failed });
  })
);
