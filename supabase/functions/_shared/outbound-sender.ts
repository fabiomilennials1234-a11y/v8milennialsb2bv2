/**
 * Shared logic for sending outbound messages via Evolution API
 * Used by outbound-trigger (immediate) and process-outbound-dispatches (scheduled)
 */

interface DispatchRow {
  id: string;
  lead_id: string;
  organization_id: string;
  message_content: string;
  lead?: { phone?: string; name?: string };
  agent?: { whatsapp_instance_id?: string };
}

/**
 * Sends a single outbound dispatch via WhatsApp Evolution API
 */
// deno-lint-ignore no-explicit-any
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
        agent:copilot_agents(whatsapp_instance_id)
      `)
      .eq("id", dispatchId)
      .single();

    if (fetchError || !dispatch) {
      console.error("[outbound-sender] Dispatch not found:", fetchError);
      return { success: false, error: "Dispatch not found" };
    }

    const row = dispatch as unknown as DispatchRow;
    if (!row.lead?.phone) {
      console.error("[outbound-sender] Lead has no phone");
      await supabase
        .from("outbound_dispatch_log")
        .update({ status: "failed", error_message: "Lead has no phone" })
        .eq("id", dispatchId);
      return { success: false, error: "Lead has no phone" };
    }

    let instanceName: string | null = null;
    if (row.agent?.whatsapp_instance_id) {
      const { data: instance } = await supabase
        .from("whatsapp_instances")
        .select("instance_name")
        .eq("id", row.agent.whatsapp_instance_id)
        .single();
      instanceName = instance?.instance_name ?? null;
    }
    if (!instanceName) {
      const { data: instance } = await supabase
        .from("whatsapp_instances")
        .select("instance_name")
        .eq("organization_id", organizationId)
        .eq("status", "open")
        .limit(1)
        .maybeSingle();
      instanceName = instance?.instance_name ?? null;
    }
    if (!instanceName) {
      console.error("[outbound-sender] No WhatsApp instance found");
      await supabase
        .from("outbound_dispatch_log")
        .update({ status: "failed", error_message: "No WhatsApp instance available" })
        .eq("id", dispatchId);
      return { success: false, error: "No WhatsApp instance available" };
    }

    const evolutionUrl = Deno.env.get("EVOLUTION_API_URL");
    const evolutionKey = Deno.env.get("EVOLUTION_API_KEY");
    if (!evolutionUrl || !evolutionKey) {
      console.error("[outbound-sender] Evolution API not configured");
      await supabase
        .from("outbound_dispatch_log")
        .update({ status: "failed", error_message: "Evolution API not configured" })
        .eq("id", dispatchId);
      return { success: false, error: "Evolution API not configured" };
    }

    let phone = String(row.lead.phone).replace(/\D/g, "");
    if (!phone.startsWith("55")) phone = "55" + phone;

    const sendResponse = await fetch(`${evolutionUrl}/message/sendText/${instanceName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: evolutionKey,
      },
      body: JSON.stringify({
        number: phone,
        text: row.message_content,
      }),
    });

    if (!sendResponse.ok) {
      const errorText = await sendResponse.text();
      console.error("[outbound-sender] Failed to send:", errorText);
      await supabase
        .from("outbound_dispatch_log")
        .update({ status: "failed", error_message: errorText })
        .eq("id", dispatchId);
      return { success: false, error: errorText };
    }

    const sendResult = await sendResponse.json();
    const messageId = sendResult?.key?.id;

    await supabase
      .from("outbound_dispatch_log")
      .update({
        status: "sent",
        message_id: messageId,
        sent_at: new Date().toISOString(),
      })
      .eq("id", dispatchId);

    await supabase.from("leads").update({ pipe_whatsapp: "abordado" }).eq("id", row.lead_id);

    const { data: existingPipe } = await supabase
      .from("pipe_whatsapp")
      .select("id")
      .eq("lead_id", row.lead_id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (existingPipe) {
      await supabase.from("pipe_whatsapp").update({ status: "abordado" }).eq("id", existingPipe.id);
    } else {
      await supabase.from("pipe_whatsapp").insert({
        lead_id: row.lead_id,
        organization_id: organizationId,
        status: "abordado",
      });
    }

    await supabase.from("whatsapp_messages").insert({
      organization_id: organizationId,
      instance_name: instanceName,
      remote_jid: phone + "@s.whatsapp.net",
      from_me: true,
      message_type: "conversation",
      content: row.message_content,
      timestamp: new Date().toISOString(),
      status: "sent",
    });

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
