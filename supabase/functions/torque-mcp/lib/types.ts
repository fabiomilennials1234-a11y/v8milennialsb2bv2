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
  /** RLS-scoped Supabase client authenticated as the ops-master (JWT, RLS ON). */
  db: unknown;
  /** service_role client — only for tools with requiresServiceRole. */
  serviceDb?: unknown;
}

export interface ToolDef {
  name: string;
  description: string;
  readonly: boolean;
  requiresServiceRole?: boolean;
  inputSchema: JsonSchema;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult> | ToolResult;
}
