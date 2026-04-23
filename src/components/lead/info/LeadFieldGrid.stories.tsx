import type { Meta, StoryObj } from "@storybook/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { LeadFieldGrid } from "./LeadFieldGrid";
import type { CustomField } from "@/hooks/useLeadCustomFields";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockCustomFields: CustomField[] = [
  {
    id: "cf-001",
    organization_id: "org-001",
    field_name: "Faturamento Anual",
    field_type: "number",
    field_options: null,
    is_required: false,
    display_order: 1,
    created_at: new Date().toISOString(),
  },
  {
    id: "cf-002",
    organization_id: "org-001",
    field_name: "Segmento de Atuação",
    field_type: "select",
    field_options: ["Distribuição", "Varejo", "Indústria", "Serviços"],
    is_required: false,
    display_order: 2,
    created_at: new Date().toISOString(),
  },
  {
    id: "cf-003",
    organization_id: "org-001",
    field_name: "Cliente Ativo",
    field_type: "boolean",
    field_options: null,
    is_required: false,
    display_order: 3,
    created_at: new Date().toISOString(),
  },
];

const mockLead = {
  name: "João Silva",
  company: "Distribuidora Silva & Cia",
  email: "joao@silva.com.br",
  phone: "+55 11 99999-1001",
  segment: "Distribuição",
  interest: "Plano Profissional",
};

// ─── Decorator: injeta dados via QueryClient ───────────────────────────────────

function withLeadFieldData(fields: CustomField[]) {
  return function FieldDataDecorator(Story: React.ComponentType) {
    const qc = useQueryClient();
    useEffect(() => {
      // Injeta campos customizados (org mockada sem organization_id real)
      qc.setQueryData(["lead-custom-fields", undefined], fields);
      qc.setQueryData(["lead-custom-field-values", "lead-story-001"], []);
    }, [qc]);
    return <Story />;
  };
}

const meta: Meta<typeof LeadFieldGrid> = {
  title: "Lead/LeadFieldGrid",
  component: LeadFieldGrid,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  argTypes: {
    onLeadUpdate: { action: "onLeadUpdate" },
  },
  args: {
    leadId: "lead-story-001",
    lead: mockLead,
    onLeadUpdate: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const SomentePadroes: Story = {
  decorators: [withLeadFieldData([])],
};

export const ComCamposCustomizados: Story = {
  decorators: [withLeadFieldData(mockCustomFields)],
};

export const LeadVazio: Story = {
  decorators: [withLeadFieldData([])],
  args: {
    lead: {},
  },
};
