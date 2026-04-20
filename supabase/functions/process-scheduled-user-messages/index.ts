import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const BATCH_SIZE = 20;

Deno.serve(async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const cronSecret = req.headers.get("x-cron-secret");
  if (!CRON_SECRET || cronSecret !== CRON_SECRET) {
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

    for (const msg of messages) {
      const { error: lockErr } = await supabase
        .from("scheduled_user_messages")
        .update({ status: "sending" })
        .eq("id", msg.id)
        .eq("status", "scheduled");

      if (lockErr) { failed++; continue; }

      try {
        let instanceName: string | null = null;
        let isSzChat = false;

        if (msg.whatsapp_instance_id) {
          const { data: inst } = await supabase
            .from("whatsapp_instances")
            .select("instance_name, metadata")
            .eq("id", msg.whatsapp_instance_id)
            .single();
          instanceName = inst?.instance_name ?? null;
          isSzChat = inst?.metadata?.provider === "szchat";
        }

        if (!instanceName) {
          const { data: defaultInst } = await supabase
            .from("whatsapp_instances")
            .select("instance_name, metadata")
            .eq("organization_id", msg.organization_id)
            .eq("status", "connected")
            .limit(1)
            .single();
          instanceName = defaultInst?.instance_name ?? null;
          isSzChat = defaultInst?.metadata?.provider === "szchat";
        }

        if (!instanceName) {
          throw new Error("Nenhuma instancia WhatsApp disponivel");
        }

        const formattedNumber = msg.phone_number.replace(/\D/g, "");

        if (msg.message_content) {
          if (isSzChat) {
            await supabase.functions.invoke("sz-chat-send", {
              body: {
                action: "send_message",
                organization_id: msg.organization_id,
                phone_number: formattedNumber,
                message: msg.message_content,
              },
            });
          } else {
            await supabase.functions.invoke("evolution-api-proxy", {
              body: {
                endpoint: `/message/sendText/${instanceName}`,
                method: "POST",
                body: { number: formattedNumber, text: msg.message_content },
              },
            });
          }
        }

        if (msg.media_url && msg.media_type) {
          const mediaEndpoint = msg.media_type === "audio"
            ? `/message/sendWhatsAppAudio/${instanceName}`
            : `/message/sendMedia/${instanceName}`;

          await supabase.functions.invoke("evolution-api-proxy", {
            body: {
              endpoint: mediaEndpoint,
              method: "POST",
              body: {
                number: formattedNumber,
                media: msg.media_url,
                mediatype: msg.media_type,
                fileName: msg.media_filename || undefined,
                caption: msg.media_type !== "audio" ? msg.message_content : undefined,
              },
            },
          });
        }

        await supabase
          .from("scheduled_user_messages")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", msg.id);

        const messageId = `sched_${msg.id}_${Date.now()}`;
        await supabase.from("whatsapp_messages").upsert({
          organization_id: msg.organization_id,
          instance_id: msg.whatsapp_instance_id,
          message_id: messageId,
          remote_jid: `${formattedNumber}@s.whatsapp.net`,
          phone_number: msg.phone_number,
          direction: "outgoing",
          message_type: msg.media_type || "text",
          content: msg.message_content,
          media_url: msg.media_url,
          status: "sent",
          lead_id: msg.lead_id,
          timestamp: new Date().toISOString(),
        }, { onConflict: "message_id,instance_id", ignoreDuplicates: false });

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
});
