/**
 * instances-to-numbers — pure mapper from WhatsApp instances to wizard numbers (#908).
 *
 * The Velocidade step works on `DisparoNumber`s (id / label / cap / selected /
 * isNew). This turns the org's real `whatsapp_instances` into that shape: only
 * connected lines are eligible, the first is pre-selected, and a freshly
 * connected line (created inside NEW_NUMBER_WINDOW_DAYS) is flagged `isNew` so
 * the Velocidade slider auto-clamps it below the recommended cap. Pure + clock-
 * free (now passed in) so the mapping is unit-tested without React.
 */
import type { DisparoNumber } from "./wizard-machine";
import { effectiveCap, CAP_RECOMMENDED } from "./speed-safety";

/** Provider statuses that count as "connected" (Uazapi `open`, generic `connected`). */
const CONNECTED_STATUSES = new Set(["open", "connected"]);

/** A line created within this window is treated as new (bans easiest). */
export const NEW_NUMBER_WINDOW_DAYS = 14;
const NEW_NUMBER_WINDOW_MS = NEW_NUMBER_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** Minimal instance shape the mapper needs — a structural subset of the table row. */
export interface InstanceLike {
  id: string;
  instance_name?: string | null;
  phone_number?: string | null;
  status?: string | null;
  created_at?: string | null;
}

export function isConnectedInstance(i: InstanceLike): boolean {
  return CONNECTED_STATUSES.has((i.status ?? "").toLowerCase());
}

export function instancesToNumbers(
  instances: InstanceLike[],
  nowMs: number,
  defaultCap: number = CAP_RECOMMENDED,
): DisparoNumber[] {
  const connected = instances.filter(isConnectedInstance);
  return connected.map((i, idx) => {
    const createdMs = i.created_at ? new Date(i.created_at).getTime() : NaN;
    const isNew =
      Number.isFinite(createdMs) && nowMs - createdMs < NEW_NUMBER_WINDOW_MS;
    return {
      id: i.id,
      label: (i.instance_name || i.phone_number || `Número ${idx + 1}`).trim(),
      cap: effectiveCap(defaultCap, isNew),
      // First connected line is on by default; the operator tunes the rest.
      selected: idx === 0,
      isNew,
    };
  });
}
