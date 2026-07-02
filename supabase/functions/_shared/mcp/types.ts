// --- JSON-RPC 2.0 ---
export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId; // absent → notification (no response)
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcError {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

// --- MCP tool ---
export interface JsonSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/** Runtime deps injected into every tool handler (filled by the request pipeline). */
export interface ToolContext {
  /**
   * RLS-scoped Supabase client. In torque-mcp it is authenticated as the ops-master
   * (cross-org via master-ghost); in crm-mcp it is the per-PAT end-user (one org, the
   * user's own RLS visibility). Either way: RLS ON, never service_role.
   */
  db: unknown;
  /** service_role client — only for tools with requiresServiceRole (never set in crm-mcp). */
  serviceDb?: unknown;
  /**
   * Caller's organization, when the principal is a single tenant user (crm-mcp). Carried
   * here — NOT in the minted JWT (see crm-mcp DESIGN §4.4, H3b) — so customer tool handlers
   * can apply an explicit `.eq("organization_id", orgId)` defense-in-depth filter on top of
   * RLS. Undefined for torque-mcp (master is cross-org).
   */
  orgId?: string;
  /** Caller's user id, when the principal is a single tenant user (crm-mcp). */
  userId?: string;
  /** Granted PAT scopes (crm-mcp); intersect with RLS, never additive. */
  scopes?: string[];
}

export interface ToolDef {
  name: string;
  description: string;
  readonly: boolean;
  requiresServiceRole?: boolean;
  /**
   * Opt-in (default false = fail-closed): only tools explicitly marked may surface on the
   * customer-facing crm-mcp endpoint. A readonly tool is NOT customer-exposed by default —
   * "can it mutate?" and "should this caller see it?" are different questions
   * (crm-mcp DESIGN §6.1). torque-mcp ignores this field.
   */
  customerExposed?: boolean;
  inputSchema: JsonSchema;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult> | ToolResult;
}
