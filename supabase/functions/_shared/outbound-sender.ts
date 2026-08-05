// deno-lint-ignore-file no-explicit-any
/**
 * Shared logic for sending outbound messages via the WhatsApp adapter.
 * Used by outbound-trigger (immediate) and process-outbound-dispatches (scheduled).
 *
 * Provider-agnostic: resolves Evolution or Uazapi via whatsapp-client adapter.
 *
 * Supports:
 * - Text message (firstMessageTemplate, humanized + smart split)
 * - Audio voice note (pre-recorded, random from pool) via copilot_agent_audios
 * - Configurable order: text_first or audio_first
 */

import { humanizeMessage } from "./message-humanizer.ts";
import { sendAudioViaProvider } from "./audio-sender.ts";
import { upsertPipeEntry } from "./pipeline-adapter.ts";
import { smartSplitMessage } from "./natural-messaging.ts";
import {
  resolveDispatchContext,
  DispatchResolutionError,
} from "./whatsapp-dispatch.ts";
import type { WhatsAppProvider } from "./whatsapp-client.ts";
import { assertRecipientReachableWithProvider } from "./action-handlers/whatsapp-helpers.ts";
import { isCopilotCanceled, logCopilotCancellation } from "./copilot/cancellation.ts";
import { governSend, isSkippedSend } from "./send-governor/gate.ts";

const AUDIO_DELAY_MS = 8000;

interface DispatchRow {
  id: string;
  lead_id: string;
  organization_id: string;
  agent_id: string;
  message_content: string;
  lead?: { phone?: string; name?: string };
  agent?: { whatsapp_instance_id?: string; outbound_config?: OutboundConfig; is_active?: boolean };
}

interface OutboundConfig {
  audioEnabled?: boolean;
  audioSendOrder?: "text_first" | "audio_first";
  [key: string]: unknown;
}

interface AudioRecord {
  id: string;
  public_url: string;
  name: string;
}

export async function sendOutboundDispatch(
  supabase: any,
  dispatchId: string,
  organizationId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: dispatch, error: fetchError } = await supabase
      .from("outbound_dispatch_log")
      .select(`
        *,
        lead:leads(phone, name),
        agent:copilot_agents(whatsapp_instance_id, outbound_config, is_active)
      `)
      .eq("id", dispatchId)
      .single();

    if (fetchError || !dispatch) {
      console.error("[outbound-sender] Dispatch not found:", fetchError);
      return { success: false, error: "Dispatch not found" };
    }

    const row = dispatch as unknown as DispatchRow;

    if (row.agent && !row.agent.is_active) {
      console.log("[outbound-sender] Agent disabled — skipping dispatch:", dispatchId);
      await supabase
        .from("outbound_dispatch_log")
        .update({ status: "skipped", error_message: "Agent disabled at send time" })
        .eq("id", dispatchId);
      return { success: false, error: "Agent disabled" };
    }

    // Resolve provider + instance + phone via unified dispatch helper.
    // lead_id é propagado sempre — se a flag user_write_instance_strict
    // estiver ON na org, força vínculo via responsible_user_id; OFF mantém
    // precedência legada (agent.whatsapp_instance_id → primeira da org).
    let ctx;
    try {
      ctx = await resolveDispatchContext(supabase, {
        organization_id: organizationId,
        phone: row.lead?.phone,
        preferred_instance_id: row.agent?.whatsapp_instance_id ?? null,
        lead_id: row.lead_id,
      });
    } catch (e) {
      const err = e as DispatchResolutionError;
      await supabase
        .from("outbound_dispatch_log")
        .update({ status: "failed", error_message: err.message })
        .eq("id", dispatchId);
      return { success: false, error: err.message };
    }

    const { provider, instance, normalizedPhone: phone } = ctx;

    // Pre-flight: copilot prospectador first-contact often targets unverified
    // Meta-Ads numbers. Skip (non-retryably) when the recipient is not on
    // WhatsApp — avoids the opaque Uazapi 500 + retry storm.
    const reach = await assertRecipientReachableWithProvider(supabase, provider, phone, organizationId);
    if (!reach.reachable) {
      await supabase
        .from("outbound_dispatch_log")
        .update({ status: "skipped", error_message: reach.reason })
        .eq("id", dispatchId);
      return { success: false, error: reach.reason };
    }

    // Humanize
    const humanizedContent = await humanizeMessage(row.message_content);

    // Resolve audio config
    const outboundConfig = row.agent?.outbound_config;
    const audioEnabled = outboundConfig?.audioEnabled === true;
    const audioSendOrder = outboundConfig?.audioSendOrder || "text_first";

    let chosenAudio: AudioRecord | null = null;
    if (audioEnabled && row.agent_id) {
      const { data: audios } = await supabase
        .from("copilot_agent_audios")
        .select("id, public_url, name")
        .eq("agent_id", row.agent_id)
        .eq("is_active", true);

      if (audios && audios.length > 0) {
        chosenAudio = audios[Math.floor(Math.random() * audios.length)] as AudioRecord;
      }
    }

    // ---------------------------------------------------------------
    // Text send (with smart split + typing indicator per chunk)
    // RC-cancel 2026-04-26: per-chunk cancellation gate.
    // ---------------------------------------------------------------
    const sendText = async (): Promise<{ ok: boolean; messageId?: string; canceled?: boolean; chunksSent?: number; chunksTotal?: number; error?: string }> => {
      const { chunks, delays } = await smartSplitMessage(humanizedContent, {
        enabled: true,
        intensity: "natural",
      });

      let firstMessageId: string | undefined;
      let chunksSent = 0;
      // #1156 — id do DISPATCH (estável entre retries): retry da MESMA dispatch reusa
      // o idk → hit=2 → barAt=2 → idempotente. Nonce por-chamada reenviaria no retry.
      const dedupNonce = dispatchId;
      for (let i = 0; i < chunks.length; i++) {
        try {
          await provider.setPresence(phone, "composing");
        } catch {
          /* best-effort */
        }

        if (delays[i] > 0) {
          await new Promise((r) => setTimeout(r, delays[i]));
        }

        const cancelCheck = await isCopilotCanceled(supabase, organizationId, phone);
        if (cancelCheck.canceled) {
          console.log("[outbound-sender] Copilot canceled mid-flight; aborting after", chunksSent, "of", chunks.length, "chunk(s)");
          logCopilotCancellation({
            organizationId,
            gate: "outbound_chunks",
            leadId: row.lead_id,
            phone,
            chunksSent,
            chunksTotal: chunks.length,
            source: cancelCheck.source,
          });
          return { ok: chunksSent > 0, messageId: firstMessageId, canceled: true, chunksSent, chunksTotal: chunks.length };
        }

        try {
          // Send Governor (copilot turn, category 'automation'). SHADOW/off:
          // governSend always runs doSend and returns the provider result
          // byte-for-byte, so the shape below is unchanged. Only a future
          // enforce mode returns a SkippedSend (branch below, dormant in PR-0).
          const governed = await governSend(
            supabase,
            {
              orgId: organizationId,
              instanceId: instance.id,
              category: "automation",
              recipientPhone: phone,
              trackSource: "copilot-outbound",
              content: chunks[i],
              // idk só multi-chunk: chunks distintos da MESMA reply não colidem.
              // Single-chunk sem idk → dedup por conteúdo (pega loop). #1156.
              idempotencyKey: chunks.length > 1 ? `ob:${dedupNonce}:${i}` : undefined,
            },
            () =>
              provider.sendText({
                number: phone,
                text: chunks[i],
                trackSource: "copilot-outbound",
                trackId: dispatchId,
              }),
          );
          // Skip = enforce block/defer OU dedup conversacional (#1156, alcançável
          // já em shadow/off com a flag ON). Para o loop de chunks e reporta parcial.
          if (isSkippedSend(governed)) {
            return {
              ok: chunksSent > 0,
              messageId: firstMessageId,
              chunksSent,
              chunksTotal: chunks.length,
              error: `governor_${governed.action}`,
            };
          }
          const res = governed;
          if (i === 0) firstMessageId = res.message_id;
          chunksSent++;
        } catch (err) {
          return { ok: false, error: (err as Error).message };
        }
      }

      return { ok: true, messageId: firstMessageId, chunksSent, chunksTotal: chunks.length };
    };

    // ---------------------------------------------------------------
    // Audio send (voice note PTT via adapter)
    // ---------------------------------------------------------------
    const sendAudio = async (): Promise<{ ok: boolean; messageId?: string; error?: string }> => {
      if (!chosenAudio) return { ok: false, error: "No audio available" };
      const result = await sendAudioViaProvider(
        provider as WhatsAppProvider,
        phone,
        chosenAudio.public_url,
        { trackSource: "copilot-outbound-audio", trackId: dispatchId }
      );
      return { ok: result.success, messageId: result.messageId, error: result.error };
    };

    // ---------------------------------------------------------------
    // Execute in configured order
    // ---------------------------------------------------------------
    // Derivado de `sendText` em vez de recopiado: a anotação à mão parou no
    // formato de antes do RC-cancel (2026-04-26), que acrescentou `canceled`,
    // `chunksSent` e `chunksTotal`. As três leituras logo abaixo — inclusive a
    // que decide marcar o dispatch como `canceled` — eram erro de tipo contra um
    // formato que já não existia. `Awaited<ReturnType<…>>` não volta a defasar.
    let textResult: Awaited<ReturnType<typeof sendText>>;
    let audioResult: { ok: boolean; messageId?: string; error?: string } | null = null;

    if (chosenAudio && audioSendOrder === "audio_first") {
      audioResult = await sendAudio();
      textResult = await sendText();
    } else if (chosenAudio) {
      textResult = await sendText();
      if (textResult.ok) {
        // Background — don't block dispatch loop. A bare setTimeout dies
        // silently when the Supabase Edge isolate recycles right after the
        // caller's HTTP response (same failure mode as whatsapp-webhook RC
        // 2026-06-24); EdgeRuntime.waitUntil keeps the isolate alive until
        // the deferred audio goes out. Falls back to a floating promise
        // outside Supabase Edge (local dev / tests).
        const audioPromise = new Promise<void>((resolve) =>
          setTimeout(resolve, AUDIO_DELAY_MS)
        )
          .then(() => sendAudio())
          .then(() => undefined)
          .catch((e) => {
            console.warn("[outbound-sender] Background audio send failed:", e);
          });
        const edgeRuntime = (globalThis as {
          EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void };
        }).EdgeRuntime;
        if (typeof edgeRuntime?.waitUntil === "function") {
          edgeRuntime.waitUntil(audioPromise);
        } else {
          void audioPromise;
        }
      }
    } else {
      textResult = await sendText();
    }

    if (!textResult.ok) {
      console.error("[outbound-sender] Failed to send text:", textResult.error);
      await supabase
        .from("outbound_dispatch_log")
        .update({ status: "failed", error_message: textResult.error })
        .eq("id", dispatchId);
      return { success: false, error: textResult.error };
    }

    // RC-cancel: marca dispatch como canceled se cancelou mid-flight (chunks_sent > 0
    // mas não completou). textResult.ok=true quando pelo menos 1 chunk saiu antes.
    if (textResult.canceled) {
      await supabase
        .from("outbound_dispatch_log")
        .update({
          status: "canceled",
          message_id: textResult.messageId ?? null,
          sent_at: new Date().toISOString(),
          trigger_reason: {
            ...(dispatch.trigger_reason || {}),
            canceled_mid_send: true,
            chunks_sent: textResult.chunksSent,
            chunks_total: textResult.chunksTotal,
          },
        })
        .eq("id", dispatchId);
      return { success: true };
    }

    // Update dispatch log
    const triggerReason = dispatch.trigger_reason || {};
    if (chosenAudio && audioResult?.ok) {
      triggerReason.audioSent = true;
      triggerReason.audioId = chosenAudio.id;
      triggerReason.audioName = chosenAudio.name;
    }

    await supabase
      .from("outbound_dispatch_log")
      .update({
        status: "sent",
        message_id: textResult.messageId,
        sent_at: new Date().toISOString(),
        trigger_reason: triggerReason,
      })
      .eq("id", dispatchId);

    // Pipe auto-move: novo_lead → abordado.
    // SCRUM-202: o espelho `leads.pipe_whatsapp` saiu — o upsert abaixo escreve
    // `pipeline_entries` em depth 1 e o gatilho de sync grava a coluna.
    await upsertPipeEntry(supabase, {
      leadId: row.lead_id,
      orgId: organizationId,
      slug: "whatsapp",
      stageKey: "abordado",
    });

    // Register text message in whatsapp_messages history.
    // message_id = real provider id so webhook echo UPSERT matches this row
    // instead of creating a duplicate. sent_by_ai:true → Copilot badge in chat.
    const outboundTextMessageId = textResult.messageId || `cp_${crypto.randomUUID()}`;
    await supabase.from("whatsapp_messages").upsert({
      organization_id: organizationId,
      instance_id: instance.id,
      message_id: outboundTextMessageId,
      remote_jid: phone + "@s.whatsapp.net",
      phone_number: phone,
      direction: "outgoing",
      message_type: "conversation",
      content: humanizedContent,
      timestamp: new Date().toISOString(),
      status: "sent",
      sent_by_ai: true,
      sent_source: "workflow",
    }, { onConflict: "message_id,instance_id", ignoreDuplicates: false });

    if (chosenAudio && audioResult?.ok) {
      const outboundAudioMessageId = audioResult.messageId || `cp_${crypto.randomUUID()}`;
      await supabase.from("whatsapp_messages").upsert({
        organization_id: organizationId,
        instance_id: instance.id,
        message_id: outboundAudioMessageId,
        remote_jid: phone + "@s.whatsapp.net",
        phone_number: phone,
        direction: "outgoing",
        message_type: "audio",
        content: "[Áudio]",
        media_url: chosenAudio.public_url,
        timestamp: new Date().toISOString(),
        status: "sent",
        sent_by_ai: true,
        sent_source: "workflow",
      }, { onConflict: "message_id,instance_id", ignoreDuplicates: false });
    }

    return { success: true };
  } catch (error) {
    console.error("[outbound-sender] Error:", error);
    await supabase
      .from("outbound_dispatch_log")
      .update({ status: "failed", error_message: String(error) })
      .eq("id", dispatchId);
    return { success: false, error: String(error) };
  }
}
