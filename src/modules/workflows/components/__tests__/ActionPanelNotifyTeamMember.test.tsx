import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NotifyTeamMemberConfig } from "../sidebar-panels/NotifyTeamMemberConfig";
import type { ActionNodeData } from "@/types/workflow";
vi.mock("@/modules/identity", () => ({ useTeamMember: () => ({ data: { id: "ana", phone: null } }), useTeamMembers: () => ({ data: [
  { id: "ana", name: "Ana", is_active: true, phone: null },
  { id: "inactive", name: "Inativo", is_active: false },
] }) }));
vi.mock("../sidebar-panels/InstanceRoutingSelector", () => ({
  InstanceRoutingSelector: ({ fixedOnly }: { fixedOnly: boolean }) => <div>{fixedOnly ? "Número de saída fixo" : "Roteamento automático"}</div>,
}));
afterEach(cleanup);
beforeAll(() => { Element.prototype.scrollIntoView = vi.fn(); });
const base: ActionNodeData = { type: "action", label: "Avisar", actionType: "notify_team_member" };
describe("NotifyTeamMemberConfig", () => {
  it("selects an active member and saves its id and name", async () => {
    const update = vi.fn();
    render(<NotifyTeamMemberConfig data={base} onUpdate={update} />);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Membro da equipe" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "Ana" }));
    expect(update).toHaveBeenCalledWith({ notifyMemberId: "ana", notifyMemberName: "Ana" });
    expect(screen.queryByRole("option", { name: "Inativo" })).not.toBeInTheDocument();
    expect(screen.queryByText("Número de saída fixo")).not.toBeInTheDocument();
  });
  it("shows a missing phone warning and sender selection for WhatsApp", () => {
    render(<NotifyTeamMemberConfig data={{ ...base, notifyMemberId: "ana", notifyChannel: "both" }} onUpdate={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Cadastre o telefone WhatsApp");
    expect(screen.getByText("Número de saída fixo")).toBeInTheDocument();
  });
});
