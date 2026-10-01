import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizePhoneForSearch } from "../lead-service.ts";

/** The current handoff may send one acknowledgement; manual changes always win. */
export async function canDeliverHandoffAck(db: SupabaseClient, orgId: string, phone: string, receipt: unknown): Promise<boolean> {
  if (!receipt || typeof receipt !== "object") return false;
  const r = receipt as Record<string, unknown>;
  if (typeof r.conversation_id !== "string" || typeof r.paused_at !== "string") return false;
  const pausedAt = Date.parse(r.paused_at);
  if (!Number.isFinite(pausedAt) || Date.now() - pausedAt > 120_000 || pausedAt > Date.now() + 5_000) return false;
  const normalized = normalizePhoneForSearch(phone);
  if (!normalized) return false;
  const conv = await db.from("conversations").select("lead_id,state").eq("id", r.conversation_id).eq("organization_id", orgId).maybeSingle();
  if (conv.error || conv.data?.state !== "WAITING_HUMAN") return false;
  const lead = await db.from("leads").select("ai_disabled,ai_disabled_at").eq("id", conv.data.lead_id).eq("organization_id", orgId).eq("normalized_phone", normalized).maybeSingle();
  if (lead.error || !lead.data?.ai_disabled || Date.parse(lead.data.ai_disabled_at) !== pausedAt) return false;
  const pref = await db.from("phone_ai_preferences").select("ai_disabled,set_at,human_paused_until").eq("organization_id", orgId).eq("normalized_phone", normalized).maybeSingle();
  if (pref.error) return false;
  if (pref.data && (!pref.data.ai_disabled || Date.parse(pref.data.set_at) !== pausedAt || Date.parse(pref.data.human_paused_until) > Date.now())) return false;
  return true;
}
