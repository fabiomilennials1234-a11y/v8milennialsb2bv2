import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import {
  resolveStrictInstanceForCaller,
  StrictWriteResolutionError,
} from "../_shared/instance-write-guard.ts";
import {
  sendTextViaInstance,
  sendMediaViaInstance,
  sendAudioViaInstance,
  type SendResultSimple,
} from "../_shared/whatsapp-dispatch.ts";
import { sleepJitter, maxBatchForBudget } from "../_shared/anti-ban-jitter.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
// Anti-ban Onda 0 QW3: 3–8s jitter between sends. Batch shrinks to fit the
// budget (worst per item ≈ 8s jitter + ~4s send/notify); overlap with the
// 1-min tick is safe (per-row 'sending' lock), and unfetched rows stay
// 'scheduled' for the next tick (was 20).
const TICK_BUDGET_MS = 120_000;
const WORST_PER_MESSAGE_MS = 12_000;
const BATCH_SIZE = maxBatchForBudget(TICK_BUDGET_MS, WORST_PER_MESSAGE_MS); // = 10

/** Um envio realizado — vira exatamente uma linha em `whatsapp_messages`. */
interface Delivery {
  messageType: string;
  content: string | null;
  mediaUrl: string | null;
  result: SendResultSimple;
}

/**
 * SZ.Chat não é provider WhatsApp: o envio sai por edge function e não devolve
 * id de mensagem. Traduzir a resposta para o mesmo Result dos senders WA deixa
 * o chamador tratar sucesso e falha de um jeito só — antes o retorno era
 * descartado e uma recusa do SZ.Chat virava "enviada".
 */
async function sendTextViaSzChat(
  supabase: any,
  msg: any,
  phoneNumber: string,
): Promise<SendResultSimple> {
  const { data, error } = await supabase.functions.invoke("sz-chat-send", {
    body: {
      action: "send_message",
      organization_id: msg.organization_id,
      phone_number: phoneNumber,
      message: msg.message_content,
    },
  });

  if (error) return { success: false, error: error.message ?? String(error) };
  if (data?.success === false) {
    return { success: false, error: data.error ?? "sz-chat send failed" };
  }
  return { success: true };
}

Deno.serve(withErrorBoundary("process-scheduled-user-messages", async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const cronSecret = req.headers.get("x-cron-secret");
  if (!CRON_SECRET || !cronSecret || !timingSafeCompare(cronSecret, CRON_SECRET)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const now = new Date().toISOString();

    const { data: messages, error: fetchError } = await supabase
      .from("scheduled_user_messages")
      .select("*, lead:leads(name)")
      .eq("status", "scheduled")
      .lte("scheduled_at", now)
      .order("scheduled_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchError) {
      console.error("[scheduled-user-messages] Fetch error:", fetchError);
      return new Response(
        JSON.stringify({ error: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!messages?.length) {
      return new Response(JSON.stringify({ processed: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    let failed = 0;
    // Anti-ban jitter (Onda 0 QW3): conta só envios REAIS — lock-miss não
    // dorme, e nunca antes do primeiro.
    let dispatched = 0;

    const runStartedAt = Date.now();

    for (const msg of messages) {
      // Wall-clock guard: jitter can stretch a batch past the 1-min tick; stop
      // early and let the next tick drain the tail (rows stay 'scheduled').
      if (Date.now() - runStartedAt > TICK_BUDGET_MS) break;

      // Per-row lock as a real compare-and-swap: PostgREST returns success
      // even when 0 rows match (another overlapping tick already took it), so
      // the affected row must be checked — not just the error. Lock-miss is
      // NOT a failure: the other tick owns the row.
      const { data: locked, error: lockErr } = await supabase
        .from("scheduled_user_messages")
        .update({ status: "sending" })
        .eq("id", msg.id)
        .eq("status", "scheduled")
        .select("id");

      if (lockErr) { failed++; continue; }
      if (!locked?.length) continue;

      try {
        // Resolve instance — may be SZ.Chat (handled separately) or WA provider.
        //
        // Etapa B: quando flag user_write_instance_strict ON e msg.lead_id
        // presente, força resolução pelo vínculo do responsável. SZ.Chat
        // continua sendo decidido após a row ser carregada.
        let instance: any = null;
        let isSzChat = false;

        if (msg.lead_id) {
          try {
            const strict = await resolveStrictInstanceForCaller(
              supabase,
              msg.organization_id,
              msg.lead_id,
            );
            if (strict) {
              instance = strict;
              isSzChat = (strict as any).metadata?.provider === "szchat";
            }
          } catch (err) {
            if (err instanceof StrictWriteResolutionError) {
              console.warn(
                "[scheduled-user-messages] strict_write_fallback lead=%s code=%s — using legacy instance resolution",
                msg.lead_id, err.errorCode,
              );
            } else {
              throw err;
            }
          }
        }

        if (!instance && msg.whatsapp_instance_id) {
          const { data: inst } = await supabase
            .from("whatsapp_instances")
            .select("*")
            .eq("id", msg.whatsapp_instance_id)
            .single();
          instance = inst;
          isSzChat = inst?.metadata?.provider === "szchat";
        }

        if (!instance) {
          const { data: defaultInst } = await supabase
            .from("whatsapp_instances")
            .select("*")
            .eq("organization_id", msg.organization_id)
            // Meta isolation (cert Rule 2): never auto-pick a Meta number for a legacy send.
            .in("provider", ["uazapi", "evolution"])
            .in("status", ["connected", "open"])
            .limit(1)
            .single();
          instance = defaultInst;
          isSzChat = defaultInst?.metadata?.provider === "szchat";
        }

        if (!instance) {
          throw new Error("Nenhuma instancia WhatsApp disponivel");
        }

        const formattedNumber = msg.phone_number.replace(/\D/g, "");

        // Anti-ban jitter (Onda 0 QW3) — espaça envios do mesmo tick. Conteúdo
        // é humano (agendado no chat), mas a ENTREGA é automação em lote: sem
        // espaçamento, 10 mensagens às 09:00 saem coladas do mesmo número.
        if (dispatched > 0) await sleepJitter();
        dispatched++;

        // Texto e mídia saem como DUAS mensagens no WhatsApp, cada uma com o seu
        // id no provider. Coletar os dois resultados aqui, em vez de descartá-los,
        // é o que permite gravar o que de fato saiu — e só o que saiu.
        const sendOpts = { trackSource: "scheduled-user-message", trackId: msg.id };
        const deliveries: Delivery[] = [];

        if (msg.message_content) {
          deliveries.push({
            messageType: "text",
            content: msg.message_content,
            mediaUrl: null,
            result: isSzChat
              ? await sendTextViaSzChat(supabase, msg, formattedNumber)
              : await sendTextViaInstance(
                  supabase,
                  instance,
                  formattedNumber,
                  msg.message_content,
                  sendOpts,
                ),
          });
        }

        if (msg.media_url && msg.media_type) {
          deliveries.push({
            messageType: msg.media_type,
            content: msg.message_content || null,
            mediaUrl: msg.media_url,
            result:
              msg.media_type === "audio"
                ? await sendAudioViaInstance(
                    supabase,
                    instance,
                    formattedNumber,
                    msg.media_url,
                    sendOpts,
                  )
                : await sendMediaViaInstance(
                    supabase,
                    instance,
                    formattedNumber,
                    {
                      type: msg.media_type as "image" | "video" | "document",
                      file: msg.media_url,
                      filename: msg.media_filename || undefined,
                      caption: msg.message_content || undefined,
                    },
                    sendOpts,
                  ),
          });
        }

        // Sem texto e sem mídia não houve envio nenhum: marcar 'sent' registraria
        // uma entrega que nunca existiu.
        if (deliveries.length === 0) {
          throw new Error("Mensagem agendada sem conteúdo para enviar");
        }

        const failures = deliveries.filter((d) => !d.result.success);
        const succeeded = deliveries.filter((d) => d.result.success);
        const failureDetail = failures
          .map((f) => f.result.error ?? "envio falhou")
          .join("; ");

        // Os senders devolvem Result, não exceção. Sem esta checagem a falha
        // (número inválido, provider fora, skip do governor) virava status
        // 'sent' e o vendedor achava que a mensagem tinha saído.
        if (succeeded.length === 0) {
          throw new Error(failureDetail);
        }

        await supabase
          .from("scheduled_user_messages")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            // Parcial (texto saiu, mídia não): reenviar duplicaria o que já
            // chegou, então a falha fica registrada na linha em vez de virar
            // retry.
            ...(failures.length > 0 && { error_message: failureDetail }),
          })
          .eq("id", msg.id);

        for (const delivery of succeeded) {
          await supabase.from("whatsapp_messages").upsert({
            organization_id: msg.organization_id,
            // A instância RESOLVIDA acima, não `msg.whatsapp_instance_id`: a
            // coluna da fila é nula na maioria das linhas (quem agenda pelo chat
            // não escolhe chip), e gravar nulo fazia a mensagem nascer órfã —
            // invisível no chat, que filtra por instance_id, e fora do UNIQUE
            // (message_id, instance_id), que não dedupa contra NULL.
            instance_id: instance.id,
            // O id do provider é o MESMO que volta no eco fromMe, então o eco
            // colide no UNIQUE e não cria uma segunda linha. O sintético só
            // entra quando não há id do provider (SZ.Chat) — determinístico por
            // envio, para um reenvio da mesma linha não duplicar.
            message_id:
              delivery.result.messageId || `sched_${msg.id}_${delivery.messageType}`,
            remote_jid: `${formattedNumber}@s.whatsapp.net`,
            phone_number: msg.phone_number,
            direction: "outgoing",
            message_type: delivery.messageType,
            content: delivery.content,
            media_url: delivery.mediaUrl,
            status: "sent",
            // Explícito, não herdado do DEFAULT: é este par que o
            // trg_human_pause_on_manual_send lê para pausar o copiloto. Aqui
            // pausar é o certo — quem escreveu foi o vendedor —, mas por decisão,
            // não por acidente.
            sent_source: "manual",
            sent_by_ai: false,
            lead_id: msg.lead_id,
            timestamp: new Date().toISOString(),
          }, { onConflict: "message_id,instance_id", ignoreDuplicates: false });
        }

        const { data: member } = await supabase
          .from("team_members")
          .select("user_id")
          .eq("id", msg.created_by)
          .single();

        if (member?.user_id) {
          await supabase.from("notifications").insert({
            organization_id: msg.organization_id,
            user_id: member.user_id,
            type: "scheduled_message_sent",
            title: "Mensagem agendada enviada",
            description: `Mensagem para ${msg.lead?.name || "lead"} enviada com sucesso`,
            lead_id: msg.lead_id,
          });
        }

        sent++;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const newRetry = (msg.retry_count || 0) + 1;

        if (newRetry < 3) {
          const retryAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
          await supabase
            .from("scheduled_user_messages")
            .update({ status: "scheduled", retry_count: newRetry, scheduled_at: retryAt })
            .eq("id", msg.id);
        } else {
          await supabase
            .from("scheduled_user_messages")
            .update({ status: "failed", error_message: errorMessage, retry_count: newRetry })
            .eq("id", msg.id);

          const { data: member } = await supabase
            .from("team_members")
            .select("user_id")
            .eq("id", msg.created_by)
            .single();

          if (member?.user_id) {
            await supabase.from("notifications").insert({
              organization_id: msg.organization_id,
              user_id: member.user_id,
              type: "scheduled_message_failed",
              title: "Falha no envio agendado",
              description: `Nao foi possivel enviar para ${msg.lead?.name || "lead"}: ${errorMessage}`,
              lead_id: msg.lead_id,
            });
          }
        }

        failed++;
      }
    }

    await logRuntime({
      module: "scheduled_user_messages",
      action: "process_batch",
      status: "success",
      payloadSnapshot: { processed: messages.length, sent, failed },
    });

    return new Response(
      JSON.stringify({ processed: messages.length, sent, failed }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[scheduled-user-messages] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
}));
