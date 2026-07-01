import { describe, it, expect } from "vitest";
import { computeFeatureUnlockPlan, type ActivePlan } from "@/modules/platform/lib/feature-unlock";

const PLANS: ActivePlan[] = [
  { name: "torque-1.0", display_name: "Torque Base", position: 10, features: { leads: true, funnels: true, chat: false, copilot: false } },
  { name: "torque-2.0", display_name: "Torque Automation", position: 20, features: { leads: true, funnels: true, chat: true, whatsapp_bulk: true, copilot: false } },
  { name: "torque-v8", display_name: "Torque Copilot", position: 30, features: { leads: true, funnels: true, chat: true, whatsapp_bulk: true, copilot: true, oraculo: true } },
];

describe("computeFeatureUnlockPlan", () => {
  it("maps a feature to the cheapest active plan that offers it", () => {
    const map = computeFeatureUnlockPlan(PLANS);
    expect(map.leads).toEqual({ name: "torque-1.0", display_name: "Torque Base" });
    expect(map.chat).toEqual({ name: "torque-2.0", display_name: "Torque Automation" });
    expect(map.copilot).toEqual({ name: "torque-v8", display_name: "Torque Copilot" });
  });

  it("ignores features that no plan offers (returns undefined)", () => {
    const map = computeFeatureUnlockPlan(PLANS);
    expect(map.oraculo).toEqual({ name: "torque-v8", display_name: "Torque Copilot" });
    expect(map.white_label).toBeUndefined();
  });

  it("returns an empty map for no plans", () => {
    expect(computeFeatureUnlockPlan([])).toEqual({});
  });

  it("treats only strict boolean true as offered", () => {
    const map = computeFeatureUnlockPlan([
      { name: "p", display_name: "P", position: 1, features: { x: "yes" as unknown as boolean, y: true } },
    ]);
    expect(map.x).toBeUndefined();
    expect(map.y).toEqual({ name: "p", display_name: "P" });
  });
});
