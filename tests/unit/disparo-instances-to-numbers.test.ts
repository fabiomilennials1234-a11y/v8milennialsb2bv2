/**
 * instances-to-numbers — pure mapper from WhatsApp instances to wizard numbers (#908).
 *
 * Covers connected-only filtering, label fallback, the first-selected rule, and
 * the new-number clamp (a line created inside the window is flagged + capped).
 */
import { describe, it, expect } from "vitest";
import {
  instancesToNumbers,
  isConnectedInstance,
  NEW_NUMBER_WINDOW_DAYS,
  type InstanceLike,
} from "@/modules/campaigns/components/disparo-wizard/instances-to-numbers";
import { NEW_NUMBER_CAP, CAP_RECOMMENDED } from "@/modules/campaigns/components/disparo-wizard/speed-safety";

const NOW = Date.parse("2026-06-25T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString();

describe("isConnectedInstance", () => {
  it("accepts open / connected (case-insensitive), rejects the rest", () => {
    expect(isConnectedInstance({ id: "1", status: "open" })).toBe(true);
    expect(isConnectedInstance({ id: "2", status: "CONNECTED" })).toBe(true);
    expect(isConnectedInstance({ id: "3", status: "disconnected" })).toBe(false);
    expect(isConnectedInstance({ id: "4", status: null })).toBe(false);
  });
});

describe("instancesToNumbers", () => {
  it("keeps only connected lines and selects the first", () => {
    const instances: InstanceLike[] = [
      { id: "a", instance_name: "Comercial", status: "open", created_at: daysAgo(90) },
      { id: "b", instance_name: "Desligado", status: "disconnected", created_at: daysAgo(90) },
      { id: "c", instance_name: "Suporte", status: "connected", created_at: daysAgo(90) },
    ];
    const nums = instancesToNumbers(instances, NOW);
    expect(nums.map((n) => n.id)).toEqual(["a", "c"]);
    expect(nums[0].selected).toBe(true);
    expect(nums[1].selected).toBe(false);
    expect(nums[0].cap).toBe(CAP_RECOMMENDED);
    expect(nums[0].isNew).toBe(false);
  });

  it("flags + clamps a freshly connected line", () => {
    const instances: InstanceLike[] = [
      { id: "new", instance_name: "Recém", status: "open", created_at: daysAgo(NEW_NUMBER_WINDOW_DAYS - 1) },
    ];
    const [n] = instancesToNumbers(instances, NOW);
    expect(n.isNew).toBe(true);
    expect(n.cap).toBe(NEW_NUMBER_CAP);
  });

  it("falls back to phone then a positional label", () => {
    const instances: InstanceLike[] = [
      { id: "a", instance_name: null, phone_number: "5511999", status: "open" },
      { id: "b", instance_name: "", phone_number: null, status: "open" },
    ];
    const nums = instancesToNumbers(instances, NOW);
    expect(nums[0].label).toBe("5511999");
    expect(nums[1].label).toBe("Número 2");
  });

  it("treats a line with no created_at as not new", () => {
    const [n] = instancesToNumbers([{ id: "a", status: "open" }], NOW);
    expect(n.isNew).toBe(false);
  });
});
