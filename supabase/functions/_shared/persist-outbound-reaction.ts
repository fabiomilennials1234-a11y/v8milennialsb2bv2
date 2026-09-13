import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** The connected account has one reaction; never replace the contact's reactions. */
export function replaceOwnReaction(existing: unknown, emoji: string) {
  const rows = Array.isArray(existing) ? existing.filter((row) =>
    row && typeof row === "object" && row.from !== "me"
  ) : [];
  return emoji ? [...rows, { emoji, from: "me", count: 1 }] : rows;
}

/** Persist after provider acceptance. CAS preserves concurrent inbound updates. */
export async function persistOutboundReaction(
  db: SupabaseClient,
  scope: { organizationId: string; instanceId: string; messageId: string },
  emoji: string,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: row, error } = await db.from("whatsapp_messages")
      .select("id,reactions").eq("organization_id", scope.organizationId)
      .eq("instance_id", scope.instanceId).eq("message_id", scope.messageId).maybeSingle();
    if (error || !row) throw new Error("Reaction target unavailable");
    let update = db.from("whatsapp_messages")
      .update({ reactions: replaceOwnReaction(row.reactions, emoji) })
      .eq("id", row.id).eq("organization_id", scope.organizationId)
      .eq("instance_id", scope.instanceId);
    update = row.reactions === null
      ? update.is("reactions", null)
      : update.eq("reactions", JSON.stringify(row.reactions));
    const { data: changed, error: writeError } = await update.select("id");
    if (writeError) throw new Error("Reaction persistence failed");
    if (changed?.length) return;
  }
  throw new Error("Reaction update contention");
}
