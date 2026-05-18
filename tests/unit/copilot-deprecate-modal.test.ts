/**
 * Tests for #233 — Deprecate AgentConfigModal
 *
 * Verifies:
 * 1. Copilot list page does NOT import AgentConfigModal
 * 2. CopilotPlayground has activate/deactivate + set-as-default capability
 * 3. AgentConfigModal file is deleted
 * 4. AgentTtsSettings file is deleted (modal-only dependency)
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "../..");

describe("Copilot modal deprecation (#233)", () => {
  // RED->GREEN 1: Copilot.tsx must NOT reference AgentConfigModal
  it("Copilot page does not import AgentConfigModal", () => {
    const content = readFileSync(resolve(ROOT, "src/pages/Copilot.tsx"), "utf-8");
    expect(content).not.toContain("AgentConfigModal");
    // Should not have configModalOpen state
    expect(content).not.toContain("configModalOpen");
    expect(content).not.toContain("selectedAgent");
  });

  it("Copilot page navigates to playground edit route on configure", () => {
    const content = readFileSync(resolve(ROOT, "src/pages/Copilot.tsx"), "utf-8");
    // Should navigate to /copilot/:id/editar
    expect(content).toContain("/editar");
  });

  // RED->GREEN 2: Playground has activate/deactivate + set-as-default
  it("CopilotPlayground imports toggle and setDefault hooks", () => {
    const content = readFileSync(
      resolve(ROOT, "src/components/copilot/playground/CopilotPlayground.tsx"),
      "utf-8",
    );
    expect(content).toContain("useToggleCopilotAgent");
    expect(content).toContain("useSetDefaultCopilotAgent");
  });

  it("CopilotPlayground renders activate/deactivate controls", () => {
    const content = readFileSync(
      resolve(ROOT, "src/components/copilot/playground/CopilotPlayground.tsx"),
      "utf-8",
    );
    // Should have Power icon for toggle or some activation UI
    expect(content).toMatch(/is_active|isActive|Ativar|Desativar/);
  });

  // Deletion checks
  it("AgentConfigModal file is deleted", () => {
    expect(
      existsSync(resolve(ROOT, "src/components/copilot/AgentConfigModal.tsx")),
    ).toBe(false);
  });

  it("AgentTtsSettings file is deleted (modal-only)", () => {
    expect(
      existsSync(resolve(ROOT, "src/components/copilot/AgentTtsSettings.tsx")),
    ).toBe(false);
  });

  // Shared components MUST survive
  it("BehaviorWindowsEditor is kept (shared by Playground)", () => {
    expect(
      existsSync(resolve(ROOT, "src/components/copilot/BehaviorWindowsEditor.tsx")),
    ).toBe(true);
  });

  it("AgentFollowupRulesTab is kept (reused in #236)", () => {
    expect(
      existsSync(resolve(ROOT, "src/components/copilot/AgentFollowupRulesTab.tsx")),
    ).toBe(true);
  });
});
