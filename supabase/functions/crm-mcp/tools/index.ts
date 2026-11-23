/**
 * The customer tool surface (DESIGN §6). A curated POSITIVE allowlist — this array is the
 * only place tools enter the crm-mcp bundle. Ops tools (db.read_sql, rls.check_access,
 * schema.audit_*, cron.toggle, lead.restore, copilot.*) are NOT imported here, so they are
 * not even in the build; the runtime `toolFilter` (readonly && customerExposed) is the
 * second, fail-closed barrier (DESIGN §6.1).
 */
import type { ToolDef } from "../../_shared/mcp/types.ts";
import { customerConversationGetTool } from "./conversation.ts";
import { customerLeadGetTool, customerLeadListTool } from "./lead.ts";
import { customerPipelineListTool, customerStageListTool } from "./pipeline.ts";
import { customerWhatsappStatusTool } from "./whatsapp.ts";

export const CUSTOMER_TOOLS: ToolDef[] = [
  customerLeadGetTool,
  customerLeadListTool,
  customerPipelineListTool,
  customerStageListTool,
  customerConversationGetTool,
  customerWhatsappStatusTool,
];
