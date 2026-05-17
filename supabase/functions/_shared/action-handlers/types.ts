import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface ActionInput {
  supabase: SupabaseClient;
  organizationId: string;
  leadId: string | null;
  conversationId: string | null;
  params: Record<string, unknown>;
}

export interface ActionResult {
  success: boolean;
  message?: string;
  error?: string;
  data?: Record<string, unknown>;
  retryable?: boolean;
}

export type ActionHandler = (input: ActionInput) => Promise<ActionResult>;
