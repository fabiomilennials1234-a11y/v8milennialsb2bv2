// @vitest-environment node
/**
 * Unit tests for deriveDeviceName — the linked-device label an Instance
 * presents to WhatsApp.
 *
 * Pure function: no mocks, no network, no DB.
 */

import { describe, it, expect } from "vitest";

const { deriveDeviceName } = await import(
  "../../supabase/functions/_shared/whatsapp-device-name.ts"
);

const ORG_A = "6030520a-2ca7-477d-be89-55758e2cd808";
const ORG_B = "11111111-2222-3333-4444-555555555555";

describe("deriveDeviceName", () => {
  it("produces a name for an organization", () => {
    expect(deriveDeviceName(ORG_A)).toBeTypeOf("string");
    expect(deriveDeviceName(ORG_A)!.length).toBeGreaterThan(0);
  });

  it("is stable — the same organization always gets the same name", () => {
    expect(deriveDeviceName(ORG_A)).toBe(deriveDeviceName(ORG_A));
  });

  it("distinguishes organizations", () => {
    expect(deriveDeviceName(ORG_A)).not.toBe(deriveDeviceName(ORG_B));
  });

  it("stays distinct across many organizations", () => {
    // Guards against a hash so weak that real tenant counts collide. The whole
    // point of the field is that two orgs do not look like the same device.
    const names = new Set(
      Array.from({ length: 2_000 }, (_, i) =>
        deriveDeviceName(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`)
      )
    );
    expect(names.size).toBe(2_000);
  });

  it("carries the product name so the owner recognises the linked device", () => {
    expect(deriveDeviceName(ORG_A)).toContain("Torque");
  });

  it("does not leak the organization id", () => {
    const name = deriveDeviceName(ORG_A)!;
    expect(name).not.toContain(ORG_A);
    // Nor the first segment, which is enough to identify the tenant.
    expect(name).not.toContain(ORG_A.split("-")[0]);
  });

  it("returns undefined when the organization is missing, so the caller omits the field", () => {
    // Graceful degradation: creating an Instance must not fail because the
    // label could not be derived. Omitting it restores the previous behaviour.
    expect(deriveDeviceName(undefined)).toBeUndefined();
    expect(deriveDeviceName(null)).toBeUndefined();
    expect(deriveDeviceName("")).toBeUndefined();
    expect(deriveDeviceName("   ")).toBeUndefined();
  });
});
