// @vitest-environment node
/**
 * stage-role-review — lógica pura da tela master de revisão won/lost (#991).
 *
 * Invariante de dinheiro (ADR-0017 §1): o payload de update só carrega
 * `stage_role` quando a ação humana é approve/correct — dismiss jamais aplica
 * role; toda ação limpa a pendência e carimba a trilha de auditoria.
 */

import { describe, it, expect } from "vitest";
import {
  buildReviewUpdate,
  groupSuggestionsByOrg,
  type StageRoleSuggestionRow,
} from "@/modules/identity/master/lib/stage-role-review";

const row = (over: Partial<StageRoleSuggestionRow>): StageRoleSuggestionRow => ({
  id: "s1",
  organization_id: "org-a",
  pipeline_type: "propostas",
  stage_key: "fechado",
  name: "Fechado",
  color: "#22c55e",
  stage_role: "open",
  suggested_stage_role: "won",
  stage_role_suggested_at: "2026-07-07T12:00:00Z",
  stage_role_suggestion_source: "deterministic",
  organization: { name: "Org A" },
  pipeline: null,
  funil_label: null,
  ...over,
});

describe("groupSuggestionsByOrg", () => {
  it("groups by org, sorts orgs alphabetically and stages by pipe+name", () => {
    const groups = groupSuggestionsByOrg([
      row({ id: "1", organization_id: "org-b", organization: { name: "Zeta" } }),
      row({ id: "2", organization_id: "org-a", organization: { name: "Alfa" }, pipeline_type: "whatsapp", name: "B" }),
      row({ id: "3", organization_id: "org-a", organization: { name: "Alfa" }, pipeline_type: "propostas", name: "A" }),
    ]);
    expect(groups.map((g) => g.orgName)).toEqual(["Alfa", "Zeta"]);
    expect(groups[0].suggestions.map((s) => s.id)).toEqual(["3", "2"]);
  });

  it("falls back to a placeholder when the org embed is missing", () => {
    const groups = groupSuggestionsByOrg([row({ organization: null })]);
    expect(groups[0].orgName).toBe("Organização sem nome");
  });

  it("empty queue → empty groups", () => {
    expect(groupSuggestionsByOrg([])).toEqual([]);
  });
});

describe("buildReviewUpdate — confirmação humana obrigatória", () => {
  const base = {
    suggestedRole: "won" as const,
    reviewerId: "master-1",
    nowIso: "2026-07-07T15:00:00Z",
  };

  it("approve aplica exatamente o role sugerido e limpa a pendência", () => {
    expect(buildReviewUpdate({ ...base, action: "approve" })).toEqual({
      stage_role: "won",
      suggested_stage_role: null,
      stage_role_reviewed_at: "2026-07-07T15:00:00Z",
      stage_role_reviewed_by: "master-1",
    });
  });

  it("correct aplica o role escolhido pelo master (não o sugerido)", () => {
    expect(
      buildReviewUpdate({ ...base, action: "correct", correctedRole: "meeting_held" }),
    ).toEqual({
      stage_role: "meeting_held",
      suggested_stage_role: null,
      stage_role_reviewed_at: "2026-07-07T15:00:00Z",
      stage_role_reviewed_by: "master-1",
    });
  });

  it("correct sem role explícito lança — nunca aplica por omissão", () => {
    expect(() => buildReviewUpdate({ ...base, action: "correct" })).toThrow();
  });

  it("dismiss NÃO carrega stage_role — won/lost jamais aplicado sem confirmação", () => {
    const update = buildReviewUpdate({ ...base, action: "dismiss" });
    expect("stage_role" in update).toBe(false);
    expect(update.suggested_stage_role).toBeNull();
    expect(update.stage_role_reviewed_at).toBe("2026-07-07T15:00:00Z");
    expect(update.stage_role_reviewed_by).toBe("master-1");
  });
});
