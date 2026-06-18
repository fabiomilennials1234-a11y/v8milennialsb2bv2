// deno-lint-ignore-file no-explicit-any
/**
 * meta-cloud-window — the 24h customer-service window guard, Meta-ONLY.
 *
 * WHY (CERTIFICATION Rule 6): Meta blocks free-form WhatsApp messages outside
 * the 24h window opened by the contact's last inbound message — only pre-approved
 * TEMPLATES may reopen it. This guard lives ONLY on the Meta send path
 * (MetaCloudProvider.sendText / sendMedia). It must NEVER touch the shared
 * dispatch path: the Uazapi free-form send stays byte-identical, with no window
 * check and no template coercion.
 *
 * The window state is derived from `whatsapp_messages` — the SAME live-chat table
 * Cloud inbound writes to (direction='incoming', the real wamid as message_id).
 * We read the most recent incoming row for (instance_id, phone_number) and treat
 * the window as OPEN iff that row exists AND is younger than 24h.
 *
 * FAIL-SAFE: no recent incoming row → CLOSED (never silently "open" a window we
 * can't prove). This also guards against a schema rename silently re-opening it.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface SessionWindow {
  /** true iff there is an incoming message within the last 24h. */
  open: boolean;
  /** ISO timestamp of the last inbound, or null when none exists. */
  lastInboundAt: string | null;
}

/**
 * Resolves whether the 24h free-form window is open for a (instance, phone).
 *
 * Reads the single most-recent `direction='incoming'` row for the pair, ordered
 * by `timestamp` desc. Pure I/O — no side effects, no throw on the happy path; a
 * query error degrades to CLOSED (fail-safe: never claim a window is open on
 * uncertainty).
 *
 * @param now injectable clock for deterministic tests (defaults to Date.now()).
 */
export async function isSessionOpen(
  supabaseAdmin: any,
  instanceId: string,
  phoneNumber: string,
  now: number = Date.now(),
): Promise<SessionWindow> {
  const { data, error } = await supabaseAdmin
    .from("whatsapp_messages")
    .select("timestamp")
    .eq("instance_id", instanceId)
    .eq("phone_number", phoneNumber)
    .eq("direction", "incoming")
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data || !data.timestamp) {
    return { open: false, lastInboundAt: null };
  }

  const lastInboundAt = String(data.timestamp);
  const lastMs = new Date(lastInboundAt).getTime();
  if (Number.isNaN(lastMs)) {
    return { open: false, lastInboundAt: null };
  }

  return { open: now - lastMs < WINDOW_MS, lastInboundAt };
}
