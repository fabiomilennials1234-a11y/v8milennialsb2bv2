import type { ActionInput, ActionResult } from "./types.ts";

export async function assignResponsible(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params } = input;
  let assigneeId = params.assigneeId as string;
  const assignMode = (params.assignMode as string) || "specific";

  if (assignMode === "round_robin") {
    const { data: members } = await supabase
      .from("team_members")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("is_active", true);

    if (members && members.length > 0) {
      const counts = await Promise.all(
        members.map(async (m: { id: string }) => {
          const { count } = await supabase
            .from("leads")
            .select("*", { count: "exact", head: true })
            .eq("responsible_id", m.id)
            .eq("organization_id", organizationId);
          return { id: m.id, count: count ?? 0 };
        }),
      );
      counts.sort((a, b) => a.count - b.count);
      assigneeId = counts[0].id;
    }
  }

  if (!assigneeId) return { success: false, error: "No team member to assign" };

  await supabase.from("leads").update({
    sdr_id: assigneeId,
    closer_id: assigneeId,
    responsible_id: assigneeId,
    pre_sale_responsible_id: assigneeId,
    sale_responsible_id: assigneeId,
  }).eq("id", leadId);

  return { success: true, message: "Responsavel atribuido", data: { assigneeId } };
}

async function handleAssign(input: ActionInput, role: "sdr" | "closer"): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params } = input;
  let assigneeId = params.assigneeId as string;
  const assignMode = (params.assignMode as string) || "specific";
  const field = role === "sdr" ? "sdr_id" : "closer_id";
  const newField = role === "sdr" ? "pre_sale_responsible_id" : "sale_responsible_id";

  if (assignMode === "round_robin") {
    const campaignId = params.campaignId as string | undefined;
    const pipeType = params.pipeType as string | undefined;

    if (campaignId) {
      const rpcName = role === "closer" ? "get_next_campaign_closer" : "get_next_campaign_sdr";
      const { data: nextId } = await supabase.rpc(rpcName, { p_campaign_id: campaignId });
      if (nextId) assigneeId = nextId;
    } else if (pipeType) {
      const { data: nextId } = await supabase.rpc("get_next_pipe_sdr", {
        p_pipe_type: pipeType,
        p_organization_id: organizationId,
      });
      if (nextId) assigneeId = nextId;
    } else {
      const targetMetric = role === "sdr" ? "meetings" : "sales";
      const { data: members } = await supabase
        .from("team_members")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .eq("metric_type", targetMetric);

      if (members && members.length > 0) {
        const counts = await Promise.all(
          members.map(async (m: { id: string }) => {
            const { count } = await supabase
              .from("leads")
              .select("*", { count: "exact", head: true })
              .eq("responsible_id", m.id)
              .eq("organization_id", organizationId);
            return { id: m.id, count: count ?? 0 };
          }),
        );
        counts.sort((a, b) => a.count - b.count);
        assigneeId = counts[0].id;
      }
    }
  }

  if (!assigneeId) return { success: false, error: `No ${role} to assign` };

  await supabase.from("leads").update({
    [field]: assigneeId,
    [newField]: assigneeId,
    responsible_id: assigneeId,
  }).eq("id", leadId);

  return { success: true, message: "Responsavel atribuido", data: { assigneeId, role } };
}

export async function assignSdr(input: ActionInput): Promise<ActionResult> {
  return handleAssign(input, "sdr");
}

export async function assignCloser(input: ActionInput): Promise<ActionResult> {
  return handleAssign(input, "closer");
}

export async function notifyTeamMember(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params } = input;
  const memberId = params.notifyMemberId as string;
  if (!memberId) return { success: false, error: "No team member configured" };

  const message = (params.notifyMessage as string) || "";

  const { data: member } = await supabase
    .from("team_members")
    .select("user_id, name")
    .eq("id", memberId)
    .maybeSingle();

  if (!member?.user_id) return { success: false, error: "Team member not found" };

  await supabase.from("notifications").insert({
    organization_id: organizationId,
    user_id: member.user_id,
    type: "workflow_notification",
    title: "Notificacao de Workflow",
    description: message || "Acao de workflow executada",
    lead_id: leadId,
    link: "/pipe-whatsapp",
  });

  return { success: true, message: `Notification sent to ${member.name || memberId}` };
}
