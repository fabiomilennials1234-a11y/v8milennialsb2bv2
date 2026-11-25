/**
 * The customer tool surface (DESIGN §6). A curated POSITIVE allowlist — this array is the
 * only place tools enter the crm-mcp bundle. Ops tools (db.read_sql, rls.check_access,
 * schema.audit_*, cron.toggle, lead.restore, copilot.*) are NOT imported here, so they are
 * not even in the build; the runtime `toolFilter` (readonly && customerExposed) is the
 * second, fail-closed barrier (DESIGN §6.1).
 */
import type { ToolDef } from "../../_shared/mcp/types.ts";
import {
  customerAutomationActivateTool,
  customerAutomationDeactivateTool,
  customerAutomationDraftTool,
  customerAutomationGetTool,
  customerAutomationListTool,
} from "./automation.ts";
import {
  customerAudiencePreviewTool,
  customerBroadcastCancelTool,
  customerBroadcastConfirmTool,
  customerBroadcastPlanTool,
  customerBroadcastStatusTool,
  customerBroadcastTestTool,
} from "./broadcast.ts";
import { customerConversationGetTool } from "./conversation.ts";
import {
  customerDealMoveConfirmTool,
  customerDealMovePlanTool,
  customerDealMoveUndoTool,
  customerFunnelOverviewTool,
  customerFunnelReviewTool,
} from "./funnel.ts";
import { customerLeadGetTool, customerLeadListTool, customerLeadTimelineTool } from "./lead.ts";
import {
  customerFollowupCompleteTool,
  customerFollowupCreateTool,
  customerLeadTagConfirmTool,
  customerLeadTagPlanTool,
  customerNoteAddTool,
} from "./lead-write.ts";
import { customerMessageConfirmTool, customerMessagePlanTool } from "./message.ts";
import { customerDealOutcomeConfirmTool, customerDealOutcomePlanTool } from "./outcome.ts";
import { customerMetricsCatalogTool, customerMetricsQueryTool } from "./metrics.ts";
import { customerPipelineListTool, customerStageListTool } from "./pipeline.ts";
import { customerTeamListTool } from "./team.ts";
import { customerWhatsappStatusTool } from "./whatsapp.ts";
import {
  customerAgendaListTool,
  customerFollowupListTool,
  customerInboxAwaitingReplyTool,
} from "./work.ts";

export const CUSTOMER_TOOLS: ToolDef[] = [
  customerLeadGetTool,
  customerLeadListTool,
  customerLeadTimelineTool,
  customerTeamListTool,
  customerFollowupListTool,
  customerAgendaListTool,
  customerInboxAwaitingReplyTool,
  customerPipelineListTool,
  customerStageListTool,
  customerConversationGetTool,
  customerWhatsappStatusTool,
  customerMetricsCatalogTool,
  customerMetricsQueryTool,
  customerFunnelOverviewTool,
  customerFunnelReviewTool,
  customerDealMovePlanTool,
  customerDealMoveConfirmTool,
  customerDealMoveUndoTool,
  customerDealOutcomePlanTool,
  customerDealOutcomeConfirmTool,
  customerNoteAddTool,
  customerFollowupCreateTool,
  customerFollowupCompleteTool,
  customerLeadTagPlanTool,
  customerLeadTagConfirmTool,
  customerMessagePlanTool,
  customerMessageConfirmTool,
  customerAudiencePreviewTool,
  customerBroadcastStatusTool,
  customerBroadcastPlanTool,
  customerBroadcastTestTool,
  customerBroadcastConfirmTool,
  customerBroadcastCancelTool,
  customerAutomationListTool,
  customerAutomationGetTool,
  customerAutomationDraftTool,
  customerAutomationActivateTool,
  customerAutomationDeactivateTool,
];

/**
 * Fail-closed positive allowlist, per request: a customer tool is visible when it is
 * customerExposed AND either read-only, or a write tool whose declared scope this token holds.
 * A write tool without a declared scope is never visible.
 */
export function customerToolFilter(scopes: string[]) {
  return (t: ToolDef) =>
    t.customerExposed === true &&
    (t.readonly === true ||
      (typeof t.requiredScope === "string" && scopes.includes(t.requiredScope)));
}
