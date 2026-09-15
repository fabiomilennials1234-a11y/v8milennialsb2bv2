import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BlastPlanCard } from "../../src/modules/campaigns/components/BlastPlanCard";
import type { BlastPlan } from "../../src/modules/campaigns/hooks/useBlastPlans";

const state = vi.hoisted(() => ({ progress: { total: 1, sent: 0, failed: 1, skipped: 0, pending: 0 } }));
vi.mock("@/modules/campaigns/hooks/useBlastPlans", () => ({
  useBlastPlanProgress: () => ({ data: state.progress }),
  useBlastPlanControl: () => ({ isPending: false }),
  useUpdateBlastPlan: () => ({ isPending: false }),
}));

const plan = { id: "incident", status: "completed", total_recipients: 1,
  lots_total: 1, lots_released: 1, message: "Test", release_time: "09:00",
  created_at: "2026-09-15T18:56:10Z" } as BlastPlan;

describe("completed blast card", () => {
  it("renders the real all-failed incident as a failure, not a success", () => {
    state.progress = { total: 1, sent: 0, failed: 1, skipped: 0, pending: 0 };
    const html = renderToStaticMarkup(<BlastPlanCard plan={plan} />);
    expect(html).toContain("Disparo com falha");
    expect(html).toContain("1 falhas");
    expect(html).not.toContain("Concluído");
  });
  it("shows queue acceptance without claiming sending before failure sync", () => {
    state.progress = { total: 1, sent: 1, failed: 0, skipped: 0, pending: 0 };
    const html = renderToStaticMarkup(<BlastPlanCard plan={plan} />);
    expect(html).toContain("Lotes liberados");
    expect(html).toContain("aceitos para envio");
    expect(html).not.toContain("bg-success");
  });
});
