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
  customerFunnelReviewTool,
} from "./funnel.ts";
import { customerLeadGetTool, customerLeadListTool } from "./lead.ts";
import { customerMetricsCatalogTool, customerMetricsQueryTool } from "./metrics.ts";
import { customerPipelineListTool, customerStageListTool } from "./pipeline.ts";
import { customerWhatsappStatusTool } from "./whatsapp.ts";

export const CUSTOMER_TOOLS: ToolDef[] = [
  customerLeadGetTool,
  customerLeadListTool,
  customerPipelineListTool,
  customerStageListTool,
  customerConversationGetTool,
  customerWhatsappStatusTool,
  customerMetricsCatalogTool,
  customerMetricsQueryTool,
  customerFunnelReviewTool,
  customerDealMovePlanTool,
  customerDealMoveConfirmTool,
  customerDealMoveUndoTool,
  customerAudiencePreviewTool,
  customerBroadcastStatusTool,
  customerBroadcastPlanTool,
  customerBroadcastTestTool,
  customerBroadcastConfirmTool,
  customerBroadcastCancelTool,
  customerAutomationListTool,
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
