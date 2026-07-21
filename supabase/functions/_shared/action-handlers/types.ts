import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface ActionInput {
  supabase: SupabaseClient;
  organizationId: string;
  leadId: string | null;
  conversationId: string | null;
  params: Record<string, unknown>;
  /** Workflow execution context — carries variables from upstream nodes. */
  executionContext?: Record<string, unknown>;
}

export interface ActionResult {
  success: boolean;
  message?: string;
  error?: string;
  data?: Record<string, unknown>;
  retryable?: boolean;
  /**
   * Send Governor defer signal. When set, the send did NOT happen and the workflow
   * executor must reschedule this node at `deferUntil` (ISO) WITHOUT advancing the
   * graph, counting a retry, or failing. Always a future instant (> now + 60s).
   */
  deferUntil?: string;
}

export type ActionHandler = (input: ActionInput) => Promise<ActionResult>;
