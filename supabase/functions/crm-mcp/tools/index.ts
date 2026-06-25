/**
 * The customer tool surface (DESIGN §6). A curated POSITIVE allowlist — this array is the
 * only place tools enter the crm-mcp bundle. Ops tools (db.read_sql, rls.check_access,
 * schema.audit_*, cron.toggle, lead.restore, copilot.*) are NOT imported here, so they are
 * not even in the build; the runtime `toolFilter` (readonly && customerExposed) is the
 * second, fail-closed barrier (DESIGN §6.1).
 *
 * C2 ships the single tracer tool. C3 adds the rest of the read pack.
 */
import type { ToolDef } from "../../_shared/mcp/types.ts";
import { customerLeadGetTool } from "./lead.ts";

export const CUSTOMER_TOOLS: ToolDef[] = [
  customerLeadGetTool,
];
