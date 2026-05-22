/**
 * Canonical permission action definitions.
 *
 * SINGLE SOURCE OF TRUTH for the ACTION_TO_FEATURE map.
 * Client copy at src/shared/permission-actions.ts MUST be identical.
 * CI validates hash equality.
 *
 * Zero framework imports — pure types + const.
 */

export type AppAction =
  | "import_leads"
  | "create_lead"
  | "delete_lead"
  | "export_leads"
  | "view_lead"
  | "move_pipe_record"
  | "trigger_campaign"
  | "create_campaign"
  | "edit_campaign"
  | "delete_campaign"
  | "edit_workflow"
  | "create_workflow"
  | "send_message"
  | "manage_team"
  | "manage_copilot"
  | "reassign_lead"
  | "remove_lead_from_pipe";

export type FeatureKey =
  | "leads.import"
  | "leads.create"
  | "leads.delete"
  | "leads.export"
  | "leads.view"
  | "pipeline.move_cards"
  | "campaigns.send_messages"
  | "campaigns.create"
  | "campaigns.edit"
  | "campaigns.delete"
  | "workflows.edit"
  | "workflows.create"
  | "whatsapp.send_messages"
  | "team.view"
  | "copilot.create"
  | "leads.reassign"
  | "leads.remove_from_pipe";

export const ACTION_TO_FEATURE: Record<AppAction, FeatureKey> = {
  import_leads: "leads.import",
  create_lead: "leads.create",
  delete_lead: "leads.delete",
  export_leads: "leads.export",
  view_lead: "leads.view",
  move_pipe_record: "pipeline.move_cards",
  trigger_campaign: "campaigns.send_messages",
  create_campaign: "campaigns.create",
  edit_campaign: "campaigns.edit",
  delete_campaign: "campaigns.delete",
  edit_workflow: "workflows.edit",
  create_workflow: "workflows.create",
  send_message: "whatsapp.send_messages",
  manage_team: "team.view",
  manage_copilot: "copilot.create",
  reassign_lead: "leads.reassign",
  remove_lead_from_pipe: "leads.remove_from_pipe",
};

export interface ResolveContext {
  isMaster: boolean;
  role: string | null | undefined;
  featurePermissions: Record<string, boolean>;
}

export interface PermissionResult {
  allowed: boolean;
  reason: string;
}

export function resolvePermission(
  action: AppAction,
  ctx: ResolveContext,
): PermissionResult {
  if (ctx.isMaster) return { allowed: true, reason: "master" };
  if (ctx.role === "admin") return { allowed: true, reason: "admin" };

  const featureKey = ACTION_TO_FEATURE[action];
  if (!featureKey) return { allowed: false, reason: `unknown_action:${action}` };

  const allowed = ctx.featurePermissions[featureKey] === true;
  return {
    allowed,
    reason: allowed ? `feature:${featureKey}` : `denied:${featureKey}`,
  };
}
