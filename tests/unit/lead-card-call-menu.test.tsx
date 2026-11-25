import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { LeadCard } from "@/modules/leads/components/leads/LeadCard";
import { LeadCallActionProvider } from "@/shared/components/LeadCallActionSlot";

vi.mock("@/modules/communication/components/chat/AbrirConversaButton", () => ({
  AbrirConversaButton: () => null,
}));
vi.mock("@/modules/communication/components/chat/AbrirConversaMenuItem", () => ({
  AbrirConversaMenuItem: () => null,
}));
vi.mock("@/modules/communication/components/chat/ScheduleMessageModal", () => ({
  ScheduleMessageModal: () => null,
}));
vi.mock("@/modules/engagement", () => ({ CreateMeetingDialog: () => null }));
vi.mock("@/modules/leads/components/etiquetas/LeadEtiquetasPopover", () => ({
  LeadEtiquetasPopover: () => null,
}));
vi.mock("@/modules/leads/components/leads/card/LeadCardQualificationPopover", () => ({
  LeadCardQualificationPopover: () => null,
}));
vi.mock("@/modules/leads/components/leads/card/LeadCardChecklistPopover", () => ({
  LeadCardChecklistPopover: () => null,
}));

describe("menu + do negócio", () => {
  it.each(["lead-42", undefined])("usa o lead vinculado %s como destino da ligação", async (leadId) => {
    const user = userEvent.setup();
    const renderCall = vi.fn(() => <DropdownMenuItem>Ligar</DropdownMenuItem>);
    render(
      <LeadCallActionProvider value={renderCall}>
        <LeadCard
          density="compact"
          variant="custom"
          lead={{ id: "card-81", leadId, name: "Contato de teste", phone: "5511984721130" }}
        />
      </LeadCallActionProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Opções de Contato de teste" }));
    if (leadId) {
      expect(renderCall).toHaveBeenCalledWith({ id: leadId, nome: "Contato de teste", variant: "menu-item" });
      expect(screen.getByRole("menuitem", { name: "Ligar" })).not.toHaveAttribute("href");
    } else {
      expect(renderCall).not.toHaveBeenCalled();
      expect(screen.queryByRole("menuitem", { name: "Ligar" })).not.toBeInTheDocument();
    }
  });
});
