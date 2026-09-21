import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getWhatsAppProvider } from "../whatsapp-client.ts";

/** Bounded, read-only provider probes. A missing message is never permission to resend. */
export async function reconcileWorkflowButtonSends(supabase: SupabaseClient): Promise<{ errors: number }> {
  const claimed = await supabase.rpc("claim_workflow_button_send_checks", { p_limit: 5 });
  if (claimed.error) return { errors: 1 };
  const outcomes = await Promise.all((claimed.data ?? []).map(async (question: {
    id: string; organization_id: string; instance_id: string; phone: string;
  }) => {
    try {
      const instance = await supabase.from("whatsapp_instances").select("*")
        .eq("id", question.instance_id).eq("organization_id", question.organization_id).maybeSingle();
      if (instance.error || !instance.data) throw new Error("question_instance_unavailable");
      const limit = await supabase.rpc("check_rate_limit", {
        p_key: `workflow-button-check:${question.organization_id}:${question.instance_id}`, p_max_requests: 5, p_window_seconds: 60,
      });
      const allowance = Array.isArray(limit.data) ? limit.data[0] : limit.data;
      if (limit.error || allowance?.allowed !== true) throw new Error("question_check_rate_limited");
      const provider = await getWhatsAppProvider(instance.data, supabase);
      if (provider.provider !== "uazapi" || !provider.findTrackedMenu) throw new Error("question_check_provider_unavailable");
      const found = await provider.findTrackedMenu({ number: question.phone, trackId: question.id, trackSource: "workflow-question-buttons" });
      if (found.state === "accepted") {
        const accepted = await supabase.rpc("accept_workflow_button_question", {
          p_id: question.id, p_organization_id: question.organization_id,
          p_message_id: found.whatsappMessageId, p_accepted_at: found.acceptedAt,
        });
        if (accepted.error) throw new Error("question_acceptance_persistence_failed");
      } else if (found.state === "failed") {
        const failed = await supabase.rpc("fail_workflow_button_question", {
          p_id: question.id, p_organization_id: question.organization_id, p_reason: "provider_rejected",
          p_message_id: found.whatsappMessageId, p_accepted_at: found.acceptedAt,
        });
        if (failed.error) throw new Error("question_failure_persistence_failed");
      }
      const recorded = await supabase.from("workflow_button_questions").update({ last_send_check: found.state })
        .eq("id", question.id).eq("organization_id", question.organization_id);
      if (recorded.error) throw new Error("question_check_persistence_failed");
      return 0;
    } catch {
      await supabase.from("workflow_button_questions").update({ last_send_check: "unavailable" })
        .eq("id", question.id).eq("organization_id", question.organization_id);
      // Recovery failures stay explicit, with the same uncertain occurrence and no send.
      return 1;
    }
  }));
  return { errors: outcomes.reduce((sum: number, value: number) => sum + value, 0) };
}
