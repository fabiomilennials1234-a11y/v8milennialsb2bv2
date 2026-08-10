/**
 * Reconciles the Uazapi instance list against our own (#1478, PRD #1472).
 *
 * The point of this module is the CLASSIFICATION, not the count.
 *
 * "Absent from our database" does not mean "garbage". Instances created straight
 * in the Uazapi panel — for testing, for investigation — are legitimately absent
 * from the CRM. A reconciliation that read absence as a delete signal would
 * destroy exactly those, and a deleted instance does not come back: the pairing
 * dies and a human has to scan a QR again.
 *
 * What makes a strong ownership criterion available today: `createInstance` has
 * stamped `adminField01 = organization_id` and `adminField02 =
 * whatsapp_instances.id` since 2026-04-22, and every one of the 116 live
 * instances was created after that date. So "carries our stamp AND absent from
 * our database" is a measurable statement of ownership rather than a hope.
 *
 * This module never deletes and never writes. It classifies, and a human decides.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ProviderInstance {
  /** Provider-side instance id. */
  id: string;
  name?: string;
  status?: string;
  /** Our organization_id, stamped at creation. */
  adminField01?: string;
  /** Our whatsapp_instances.id, stamped at creation. */
  adminField02?: string;
  created?: string;
  lastDisconnectReason?: string;
}

export interface LocalInstance {
  id: string;
  instance_id: string | null;
  organization_id: string;
  instance_name: string;
}

export interface ConfirmedOrphan {
  id: string;
  name?: string;
  status?: string;
  organizationId?: string;
  ourInstanceId?: string;
  created?: string;
  reason: string;
}

export interface UnstampedUnknown {
  id: string;
  name?: string;
  status?: string;
  created?: string;
  reason: string;
}

export interface Phantom {
  id: string;
  instanceName: string;
  organizationId: string;
  providerInstanceId: string | null;
  reason: string;
}

export interface ReconcileReport {
  matched: number;
  /** Ours by stamp, gone from our database — safe to judge as abandoned. */
  confirmedOrphans: ConfirmedOrphan[];
  /** No stamp and unknown to us — probably created outside the CRM. Human call. */
  unstampedUnknown: UnstampedUnknown[];
  /** We still have the row; the provider does not know the instance. */
  phantoms: Phantom[];
  /** True when the provider list was unusable, so nothing was classified. */
  inconclusive: boolean;
}

function stampedInstanceId(p: ProviderInstance): string | null {
  const v = (p.adminField02 ?? "").trim();
  return UUID_RE.test(v) ? v.toLowerCase() : null;
}

/**
 * Classify both directions between the provider's list and ours.
 *
 * A missing provider list yields `inconclusive: true` and NOTHING classified — a
 * failed fetch must never be read as "the provider deleted everything", which
 * would turn a transport error into a report of 116 false phantoms.
 */
export function reconcileInstances(input: {
  providerInstances: ProviderInstance[] | null | undefined;
  localInstances: LocalInstance[] | null | undefined;
}): ReconcileReport {
  const empty: ReconcileReport = {
    matched: 0,
    confirmedOrphans: [],
    unstampedUnknown: [],
    phantoms: [],
    inconclusive: false,
  };

  if (input.providerInstances == null) {
    return { ...empty, inconclusive: true };
  }

  const locals = input.localInstances ?? [];
  const byOurId = new Map(locals.map((l) => [l.id.toLowerCase(), l]));
  const byProviderId = new Map(
    locals
      .filter((l) => l.instance_id)
      .map((l) => [String(l.instance_id).toLowerCase(), l])
  );

  const matchedLocalIds = new Set<string>();
  const confirmedOrphans: ConfirmedOrphan[] = [];
  const unstampedUnknown: UnstampedUnknown[] = [];

  for (const p of input.providerInstances) {
    const stamp = stampedInstanceId(p);

    // Strongest link first: our own stamp survives a provider-side re-create.
    const local =
      (stamp ? byOurId.get(stamp) : undefined) ??
      byProviderId.get(String(p.id).toLowerCase());

    if (local) {
      matchedLocalIds.add(local.id.toLowerCase());
      continue;
    }

    if (stamp) {
      confirmedOrphans.push({
        id: p.id,
        name: p.name,
        status: p.status,
        organizationId: p.adminField01,
        ourInstanceId: stamp,
        created: p.created,
        reason:
          "carimbada como nossa (adminField02) e ausente do banco do CRM — órfã confirmada",
      });
      continue;
    }

    unstampedUnknown.push({
      id: p.id,
      name: p.name,
      status: p.status,
      created: p.created,
      reason:
        "sem carimbo e desconhecida do CRM — provavelmente criada fora do CRM; decisão humana",
    });
  }

  const phantoms: Phantom[] = locals
    .filter((l) => !matchedLocalIds.has(l.id.toLowerCase()))
    .map((l) => ({
      id: l.id,
      instanceName: l.instance_name,
      organizationId: l.organization_id,
      providerInstanceId: l.instance_id,
      reason: "existe no CRM e ausente da lista do provider",
    }));

  return {
    matched: matchedLocalIds.size,
    confirmedOrphans,
    unstampedUnknown,
    phantoms,
    inconclusive: false,
  };
}
