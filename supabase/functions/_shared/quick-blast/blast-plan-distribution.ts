/**
 * blast-plan-distribution — integration glue between the pure planBlast core and
 * the frozen Blast Plan recipient rows (ADR-0015, #901).
 *
 * planBlast (blast-planner.ts) decides, per day, HOW MANY recipients each number
 * sends. This module turns that count plan into a concrete per-recipient
 * assignment: walking the ordered audience, it stamps every lead with the day
 * (lot_index) and the WhatsApp number (instance_id) that will send it. The result
 * is what blast-plan.ts freezes into blast_plan_recipients.
 *
 * It also resolves the per-leva send window from the (optional) wizard payload,
 * falling back to the documented default (08:00–20:00, Mon–Sat).
 *
 * Pure, no IO, no clock dependence — the day arithmetic lives in planBlast. The
 * count contract of planBlast (Σ perNumber over all lots === totalRecipients) is
 * what makes the single forward cursor cover the whole audience exactly once.
 */
import type { BlastLead } from "./recipients.ts";
import type { BlastPlanResult } from "./blast-planner.ts";
import type { QuietWindow } from "./quiet-hours.ts";

export interface RecipientAssignment {
  lead: BlastLead;
  /** 0-based day the lead is sent on. */
  lotIndex: number;
  /** WhatsApp number (whatsapp_instances.id) that sends this lead. */
  instanceId: string;
}

/**
 * Map an ordered audience onto a planBlast result. For each day, for each
 * number's share, take the next `count` leads in order and stamp them with that
 * (day, number). Because planBlast guarantees Σ shares === totalRecipients (when
 * the result was computed for this exact audience), the cursor consumes the whole
 * audience; any tail left over (only possible when dailyCapacity is 0, i.e. no
 * usable numbers) is returned unassigned and the caller is expected to have
 * rejected that case upstream.
 */
export function assignRecipientsToNumbers(
  leads: BlastLead[],
  planResult: BlastPlanResult,
): RecipientAssignment[] {
  const out: RecipientAssignment[] = [];
  let cursor = 0;
  for (let day = 0; day < planResult.lots.length; day++) {
    const lot = planResult.lots[day];
    for (const share of lot.perNumber) {
      for (let k = 0; k < share.count && cursor < leads.length; k++) {
        out.push({ lead: leads[cursor], lotIndex: day, instanceId: share.id });
        cursor++;
      }
    }
  }
  return out;
}

// ── Send window resolution ───────────────────────────────────────────────────

/** Default blast window: 08:00–20:00, Mon–Sat (matches quiet-hours + the twin). */
export const DEFAULT_BLAST_WINDOW: QuietWindow = {
  days: [1, 2, 3, 4, 5, 6],
  fromMinutes: 8 * 60,
  toMinutes: 20 * 60,
};

export interface RawWindowInput {
  days?: number[] | null;
  fromMinutes?: number | null;
  toMinutes?: number | null;
}

/**
 * Resolve a QuietWindow from an optional, untrusted payload. Fail-safe: any
 * missing / malformed part falls back to the default, and an inverted or empty
 * range (to <= from) collapses to the default times. Weekdays are filtered to the
 * valid 0..6 range; an empty day set falls back to Mon–Sat.
 */
export function resolveBlastWindow(raw?: RawWindowInput | null): QuietWindow {
  if (!raw) return DEFAULT_BLAST_WINDOW;

  const days =
    Array.isArray(raw.days) && raw.days.length > 0
      ? raw.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      : DEFAULT_BLAST_WINDOW.days;

  const fromMinutes =
    typeof raw.fromMinutes === "number" && Number.isFinite(raw.fromMinutes) && raw.fromMinutes >= 0
      ? Math.floor(raw.fromMinutes)
      : DEFAULT_BLAST_WINDOW.fromMinutes;
  const toMinutes =
    typeof raw.toMinutes === "number" && Number.isFinite(raw.toMinutes) && raw.toMinutes <= 1440
      ? Math.floor(raw.toMinutes)
      : DEFAULT_BLAST_WINDOW.toMinutes;

  const validDays = days.length > 0 ? days : DEFAULT_BLAST_WINDOW.days;
  if (toMinutes <= fromMinutes) {
    return {
      days: validDays,
      fromMinutes: DEFAULT_BLAST_WINDOW.fromMinutes,
      toMinutes: DEFAULT_BLAST_WINDOW.toMinutes,
    };
  }
  return { days: validDays, fromMinutes, toMinutes };
}
