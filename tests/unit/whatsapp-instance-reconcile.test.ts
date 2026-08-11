/**
 * Unit tests for reconciling the provider's instance list against our own
 * (#1478, PRD #1472).
 *
 * Why the classification matters more than the count
 * --------------------------------------------------
 * "Absent from our database" does NOT mean "garbage". Instances created straight
 * in the Uazapi panel — for testing, for investigation — are legitimately absent
 * from the CRM. A reconciliation that treats absence as a delete signal would
 * destroy exactly those, and a deleted instance does not come back: the pairing
 * dies and a human has to scan a QR again.
 *
 * What makes a strong criterion available TODAY: `createInstance` has stamped
 * `adminField01 = organization_id` and `adminField02 = whatsapp_instances.id`
 * since 2026-04-22, and every one of the 116 live instances was created after
 * that. So "carries our stamp AND absent from our database" is a real,
 * measurable statement of ownership — not a hope.
 *
 * This module only CLASSIFIES. Nothing here deletes.
 */

import { describe, it, expect } from "vitest";
import {
  reconcileInstances,
  type ProviderInstance,
  type LocalInstance,
} from "../../supabase/functions/_shared/whatsapp-instance-reconcile.ts";

const ORG = "6030520a-2ca7-477d-be89-55758e2cd808";

function provider(over: Partial<ProviderInstance> = {}): ProviderInstance {
  return {
    id: "prov-1",
    name: "instancia-1",
    status: "connected",
    adminField01: ORG,
    adminField02: "11111111-1111-4111-8111-111111111111",
    ...over,
  };
}

function local(over: Partial<LocalInstance> = {}): LocalInstance {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    instance_id: "prov-1",
    organization_id: ORG,
    instance_name: "instancia-1",
    ...over,
  };
}

describe("reconcileInstances — matching", () => {
  it("matches on our own stamp, which is the strongest link", () => {
    const r = reconcileInstances({
      providerInstances: [provider()],
      localInstances: [local()],
    });

    expect(r.matched).toBe(1);
    expect(r.confirmedOrphans).toHaveLength(0);
    expect(r.unstampedUnknown).toHaveLength(0);
    expect(r.phantoms).toHaveLength(0);
  });

  it("still matches when the provider id changed but our stamp did not", () => {
    // Re-created at the provider and rebound: the provider id moved, the stamp
    // is what survives.
    const r = reconcileInstances({
      providerInstances: [provider({ id: "prov-NEW" })],
      localInstances: [local({ instance_id: "prov-OLD" })],
    });

    expect(r.matched).toBe(1);
    expect(r.confirmedOrphans).toHaveLength(0);
  });

  it("falls back to the provider id when the stamp is missing", () => {
    const r = reconcileInstances({
      providerInstances: [provider({ adminField01: undefined, adminField02: undefined })],
      localInstances: [local()],
    });

    expect(r.matched).toBe(1);
  });
});

describe("reconcileInstances — confirmed orphans", () => {
  it("flags a stamped instance that no longer exists in our database", () => {
    const r = reconcileInstances({
      providerInstances: [provider({ id: "prov-9", adminField02: "99999999-9999-4999-8999-999999999999" })],
      localInstances: [],
    });

    expect(r.confirmedOrphans).toHaveLength(1);
    expect(r.confirmedOrphans[0]).toMatchObject({
      id: "prov-9",
      organizationId: ORG,
      reason: expect.stringMatching(/carimb/i),
    });
    expect(r.unstampedUnknown).toHaveLength(0);
  });

  it("does not confuse an orphan with an instance belonging to another row", () => {
    const r = reconcileInstances({
      providerInstances: [
        provider({ id: "prov-1", adminField02: "11111111-1111-4111-8111-111111111111" }),
        provider({ id: "prov-2", adminField02: "99999999-9999-4999-8999-999999999999" }),
      ],
      localInstances: [local({ id: "11111111-1111-4111-8111-111111111111" })],
    });

    expect(r.matched).toBe(1);
    expect(r.confirmedOrphans.map((o) => o.id)).toEqual(["prov-2"]);
  });
});

describe("reconcileInstances — never call an unstamped instance garbage", () => {
  it("classifies an unstamped, unknown instance as requiring a human decision", () => {
    const r = reconcileInstances({
      providerInstances: [
        provider({ id: "painel-1", name: "teste-do-cto", adminField01: undefined, adminField02: undefined }),
      ],
      localInstances: [],
    });

    expect(r.confirmedOrphans).toHaveLength(0);
    expect(r.unstampedUnknown).toHaveLength(1);
    expect(r.unstampedUnknown[0]).toMatchObject({
      id: "painel-1",
      name: "teste-do-cto",
      reason: expect.stringMatching(/fora do CRM|decis/i),
    });
  });

  it("treats free text in the stamp as no stamp at all — only a real uuid proves ownership", () => {
    const r = reconcileInstances({
      providerInstances: [provider({ adminField02: "algum-texto-livre" })],
      localInstances: [],
    });

    expect(r.confirmedOrphans).toHaveLength(0);
    expect(r.unstampedUnknown).toHaveLength(1);
  });
});

describe("reconcileInstances — phantoms", () => {
  it("flags a row we still have that the provider no longer knows about", () => {
    const r = reconcileInstances({
      providerInstances: [],
      localInstances: [local({ instance_name: "Prospeccao" })],
    });

    expect(r.phantoms).toHaveLength(1);
    expect(r.phantoms[0]).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      instanceName: "Prospeccao",
    });
  });
});

describe("reconcileInstances — degenerate input", () => {
  it("reports nothing rather than everything when the provider list is empty AND we have no rows", () => {
    const r = reconcileInstances({ providerInstances: [], localInstances: [] });

    expect(r).toMatchObject({
      matched: 0,
      confirmedOrphans: [],
      unstampedUnknown: [],
      phantoms: [],
    });
  });

  it("refuses to classify anything when the provider list is missing, instead of declaring every row a phantom", () => {
    // A failed/empty provider fetch must never be read as "the provider deleted
    // everything" — that would turn a transport error into 116 false phantoms.
    const r = reconcileInstances({
      providerInstances: null,
      localInstances: [local(), local({ id: "22222222-2222-4222-8222-222222222222", instance_id: "prov-2" })],
    });

    expect(r.inconclusive).toBe(true);
    expect(r.phantoms).toHaveLength(0);
    expect(r.confirmedOrphans).toHaveLength(0);
  });
});
