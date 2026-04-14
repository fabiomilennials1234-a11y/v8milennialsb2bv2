import { describe, it, expect } from "vitest";
import { STEP_TIPS } from "../../src/lib/copilot/step-tips";

describe("STEP_TIPS", () => {
  it("has at least 15 step tips", () => {
    expect(Object.keys(STEP_TIPS).length).toBeGreaterThanOrEqual(15);
  });

  it("every tip has title and body", () => {
    Object.entries(STEP_TIPS).forEach(([key, tip]) => {
      expect(tip.title, `${key} missing title`).toBeTruthy();
      expect(tip.body, `${key} missing body`).toBeTruthy();
      expect(tip.title.length, `${key} title too short`).toBeGreaterThan(5);
      expect(tip.body.length, `${key} body too short`).toBeGreaterThan(20);
    });
  });

  it("includes critical wizard steps", () => {
    const requiredSteps = [
      "name",
      "personality",
      "faqs",
      "businessContext",
      "conversationStyle",
      "qualification",
      "examples",
      "customInstructions",
    ];
    requiredSteps.forEach((step) => {
      expect(STEP_TIPS[step], `Missing tip for step: ${step}`).toBeDefined();
    });
  });

  it("businessContext tip mentions impact on prompt", () => {
    expect(STEP_TIPS.businessContext.body).toContain("prompt");
  });

  it("examples tip recommends 3 examples", () => {
    expect(STEP_TIPS.examples.body).toContain("3");
  });
});
