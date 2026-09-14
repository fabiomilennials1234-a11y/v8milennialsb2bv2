import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/leads/components/etiquetas/LeadEtiquetasPopover", () => ({
  LeadEtiquetasPopover: () => null,
}));

import { LeadListRowV2 } from "@/modules/leads/components/leads/LeadListRowV2";

type Props = React.ComponentProps<typeof LeadListRowV2>;

const lead = {
  id: "lead-1",
  name: "Café do Centro",
  company: "Café do Centro Ltda.",
  email: "contato@cafedocentro.test",
  phone: "48999999999",
  origin: "outro",
  created_at: "2026-09-14T12:00:00.000Z",
  lead_tags: [],
} as Props["lead"];

function renderRow() {
  const onOpen = vi.fn();
  render(
    <LeadListRowV2
      lead={lead}
      selected={false}
      onToggleSelect={vi.fn()}
      onOpen={onOpen}
      createdLabel="14/09/2026"
      originLabel="Outros"
      originClassName="text-muted-foreground"
      actions={<button type="button">Ações de Café do Centro</button>}
    />,
  );
  return { onOpen };
}

describe("LeadListRowV2 — menu de ações", () => {
  it("mantém o menu na última coluna da linha", () => {
    renderRow();

    expect(screen.getByRole("button", { name: "Ações de Café do Centro" })).toBeInTheDocument();
  });

  it("abrir o menu não abre também o painel do lead", () => {
    const { onOpen } = renderRow();

    fireEvent.click(screen.getByRole("button", { name: "Ações de Café do Centro" }));

    expect(onOpen).not.toHaveBeenCalled();
  });
});
