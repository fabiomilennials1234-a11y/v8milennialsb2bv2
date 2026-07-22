/**
 * Linked-device label an Instance presents to WhatsApp.
 *
 * WhatsApp shows this string in the account's "Linked devices" list, and it is
 * part of what the platform sees when a number pairs. Until now we never sent
 * it, so every Instance of every Organization reached WhatsApp under the
 * provider's default label — from the platform's side, all our tenants looked
 * like the same device. This is one of the few correlation signals we control
 * without changing infrastructure (issue #1167).
 *
 * The label is derived from the Organization id rather than its name: the name
 * is tenant data and does not belong on a surface we do not own, and it can
 * change while the label must not. The product name is kept in the clear so the
 * owner recognises the device when auditing their linked sessions.
 */

/**
 * Shown before the per-tenant discriminator. Human-facing on purpose — this is
 * what the Organization's own user reads in the WhatsApp device list.
 */
const PRODUCT_LABEL = "Torque CRM";

/**
 * FNV-1a (32-bit), base36. Not cryptographic and does not need to be: the goal
 * is a short, stable, non-reversible discriminator, not a secret. `Math.imul`
 * keeps the multiply in 32-bit territory across runtimes.
 */
function shortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0").slice(-7);
}

/**
 * Builds the device label for an Organization.
 *
 * Returns `undefined` when no label can be derived, and callers must omit the
 * field in that case rather than substituting a constant: falling back to a
 * shared literal would recreate the very collision this exists to break, and
 * provisioning an Instance must never fail over a cosmetic label.
 */
export function deriveDeviceName(
  organizationId: string | null | undefined,
): string | undefined {
  const id = organizationId?.trim();
  if (!id) return undefined;
  return `${PRODUCT_LABEL} ${shortHash(id)}`;
}
