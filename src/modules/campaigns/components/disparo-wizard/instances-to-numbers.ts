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

/**
 * Providers whose numbers may be blasted in bulk from this wizard.
 *
 * ALLOWLIST, never a denylist: a provider added later is excluded until someone
 * decides it belongs here. The official channels (`meta_cloud` today,
 * `notificame` next) are template-gated and window-gated by Meta — free-text
 * mass send simply does not exist for them, so a line of theirs appearing as a
 * selectable "número" is a bug that only surfaces as rejected sends at blast
 * time. Mirrors the same allowlist in `_shared/whatsapp-dispatch.ts`.
 *
 * A row with no `provider` is treated as ineligible (fail-closed). Production
 * always has it — `useWhatsAppInstances` selects `*` — so this only bites
 * hand-built fixtures, which is where we want the noise.
 */
const BLASTABLE_PROVIDERS = new Set(["uazapi", "evolution"]);

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
  provider?: string | null;
}

/** True only for a provider that supports free-text bulk send. See BLASTABLE_PROVIDERS. */
export function isBlastableInstance(i: InstanceLike): boolean {
  return BLASTABLE_PROVIDERS.has((i.provider ?? "").toLowerCase());
}

export function isConnectedInstance(i: InstanceLike): boolean {
  return CONNECTED_STATUSES.has((i.status ?? "").toLowerCase());
}

export function instancesToNumbers(
  instances: InstanceLike[],
  nowMs: number,
  defaultCap: number = CAP_RECOMMENDED,
): DisparoNumber[] {
  const eligible = instances.filter(
    (i) => isConnectedInstance(i) && isBlastableInstance(i),
  );
  return eligible.map((i, idx) => {
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
