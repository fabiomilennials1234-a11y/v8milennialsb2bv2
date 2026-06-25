/**
 * ActionPanel — unified "Enviar Mensagem" node (ADR-0012).
 *
 * Verifies external behavior: selecting the unified action renders a Message
 * Type selector, the Texto sub-panel, and the Semi-automático toggle.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/modules/communication/hooks/useWhatsAppInstances", () => ({
  useWhatsAppInstances: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/modules/campaigns/hooks/useCampaignTemplates", () => ({
  useCampaignTemplatesByType: () => ({ data: [], isLoading: false, isError: false }),
}));

// VariableInserter pulls tags/custom-fields/current-member hooks — stub it; not
// under test here.
vi.mock("@/modules/workflows/components/VariableInserter", () => ({
  VariableInserter: () => null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => ({}) } },
}));

import { ActionPanel } from "@/modules/workflows/components/sidebar-panels/ActionPanel";
import type { ActionNodeData } from "@/types/workflow";

function baseData(overrides: Partial<ActionNodeData> = {}): ActionNodeData {
  return {
    type: "action",
    actionType: "send_whatsapp_message",
    label: "Enviar Mensagem",
    messageType: "texto",
    ...overrides,
  } as ActionNodeData;
}

function renderPanel(data: ActionNodeData, onUpdate = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ActionPanel data={data} onUpdate={onUpdate} />
    </QueryClientProvider>,
  );
}

describe("ActionPanel — unified message node", () => {
  it("renders the Message Type selector for the unified node", () => {
    renderPanel(baseData());
    expect(screen.getByText("Tipo de mensagem")).toBeInTheDocument();
  });

  it("renders the Texto sub-panel (mode selector) when messageType is texto", () => {
    renderPanel(baseData({ messageType: "texto" }));
    // WhatsAppTextPanel exposes the 3-way mode selector
    expect(screen.getByText("Escrever")).toBeInTheDocument();
  });

  it("renders the Semi-automático toggle", () => {
    renderPanel(baseData());
    expect(screen.getByText("Semi-automático")).toBeInTheDocument();
  });

  it("offers a 'Gerar com IA' text mode for the unified node", () => {
    renderPanel(baseData({ messageType: "texto" }));
    expect(screen.getByText("Gerar com IA")).toBeInTheDocument();
  });

  it("shows the AI prompt field when texto mode is 'ai'", () => {
    renderPanel(baseData({ messageType: "texto", templateMode: "ai", aiPrompt: "x" }));
    expect(screen.getByText("Prompt para a IA")).toBeInTheDocument();
    expect(screen.getByText("Salvar resultado em variável")).toBeInTheDocument();
  });
});
