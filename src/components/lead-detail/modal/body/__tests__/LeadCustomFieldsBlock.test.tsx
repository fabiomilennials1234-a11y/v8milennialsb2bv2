import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LeadCustomFieldsBlock } from "../LeadCustomFieldsBlock";

// ─── Mocks ──────────────────────────────────────────────────────────

interface MockField {
  id: string;
  organization_id: string;
  field_name: string;
  field_type: "text" | "number" | "date" | "select" | "boolean";
  field_options: string[] | null;
  is_required: boolean;
  display_order: number;
  created_at: string;
}

const fieldsState = vi.hoisted(() => ({
  list: [] as Array<{
    id: string;
    organization_id: string;
    field_name: string;
    field_type: "text" | "number" | "date" | "select" | "boolean";
    field_options: string[] | null;
    is_required: boolean;
    display_order: number;
    created_at: string;
  }>,
  values: [] as Array<{
    id: string;
    lead_id: string;
    field_id: string;
    value: string | null;
    created_at: string;
    updated_at: string;
    field: MockField;
  }>,
}));

const saveSpy = vi.fn().mockResolvedValue({});

vi.mock("@/hooks/useLeadCustomFields", () => ({
  useLeadCustomFields: () => ({ data: fieldsState.list, isLoading: false }),
  useLeadCustomFieldValues: () => ({ data: fieldsState.values, isLoading: false }),
  useSaveCustomFieldValue: () => ({ mutateAsync: saveSpy, isPending: false }),
}));

vi.mock("@/hooks/useLogLeadAction", () => ({
  useLogLeadAction: () => vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const baseProps = { leadId: "lead-1" };

function mkField(
  id: string,
  name: string,
  type: MockField["field_type"] = "text",
  options: string[] | null = null,
): MockField {
  return {
    id,
    organization_id: "org-1",
    field_name: name,
    field_type: type,
    field_options: options,
    is_required: false,
    display_order: parseInt(id.split("-")[1] ?? "0", 10),
    created_at: "2026-05-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  fieldsState.list = [];
  fieldsState.values = [];
  saveSpy.mockClear();
  vi.useRealTimers();
});

describe("LeadCustomFieldsBlock", () => {
  describe("state: org has no custom fields", () => {
    it("renders nothing (hidden)", () => {
      const { container } = renderWithQuery(
        <LeadCustomFieldsBlock {...baseProps} editable={true} />,
      );
      expect(container.innerHTML).toBe("");
    });
  });

  describe("state: 3 custom fields configured", () => {
    beforeEach(() => {
      fieldsState.list = [
        mkField("f-1", "CNPJ"),
        mkField("f-2", "Segmento", "select", ["A", "B"]),
        mkField("f-3", "Ticket médio histórico", "number"),
      ];
    });

    it("renders header + all 3 fields with no overflow toggle", () => {
      renderWithQuery(<LeadCustomFieldsBlock {...baseProps} editable={true} />);
      expect(screen.getByText(/campos personalizados/i)).toBeInTheDocument();
      expect(screen.getByText("CNPJ")).toBeInTheDocument();
      expect(screen.getByText("Segmento")).toBeInTheDocument();
      expect(screen.getByText("Ticket médio histórico")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /mostrar tudo/i })).not.toBeInTheDocument();
    });
  });

  describe("state: 10 custom fields configured (overflow)", () => {
    beforeEach(() => {
      fieldsState.list = Array.from({ length: 10 }, (_, i) =>
        mkField(`f-${i + 1}`, `Campo ${i + 1}`),
      );
    });

    it("shows 5 visible fields + 'Mostrar tudo' toggle", () => {
      renderWithQuery(<LeadCustomFieldsBlock {...baseProps} editable={true} />);
      expect(screen.getByText("Campo 1")).toBeInTheDocument();
      expect(screen.getByText("Campo 5")).toBeInTheDocument();
      expect(screen.queryByText("Campo 6")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /mostrar tudo/i })).toBeInTheDocument();
    });

    it("expands to all fields when 'Mostrar tudo' is clicked", () => {
      renderWithQuery(<LeadCustomFieldsBlock {...baseProps} editable={true} />);
      fireEvent.click(screen.getByRole("button", { name: /mostrar tudo/i }));
      expect(screen.getByText("Campo 10")).toBeInTheDocument();
      // Toggle now reads "Mostrar menos"
      expect(screen.getByRole("button", { name: /mostrar menos/i })).toBeInTheDocument();
    });
  });

  describe("state: editable text field auto-save", () => {
    beforeEach(() => {
      fieldsState.list = [mkField("f-1", "CNPJ")];
    });

    it("fires useSaveCustomFieldValue after debounce when text input changes", async () => {
      renderWithQuery(<LeadCustomFieldsBlock {...baseProps} editable={true} />);
      const input = screen.getByLabelText(/cnpj/i);
      fireEvent.change(input, { target: { value: "00.000.000/0001-00" } });
      // Real timers — debounce is 1500ms, give ourselves a 3s waitFor budget.
      await waitFor(
        () => {
          expect(saveSpy).toHaveBeenCalledWith({
            leadId: "lead-1",
            fieldId: "f-1",
            value: "00.000.000/0001-00",
          });
        },
        { timeout: 3000 },
      );
    });
  });

  describe("state: locked (read-only)", () => {
    beforeEach(() => {
      fieldsState.list = [
        mkField("f-1", "CNPJ"),
        mkField("f-2", "Segmento", "select", ["A", "B"]),
      ];
      fieldsState.values = [
        {
          id: "v-1",
          lead_id: "lead-1",
          field_id: "f-1",
          value: "12.345.678/0001-99",
          created_at: "2026-05-10T00:00:00.000Z",
          updated_at: "2026-05-10T00:00:00.000Z",
          field: fieldsState.list[0],
        },
      ];
    });

    it("renders values as read-only text — no editable inputs", () => {
      renderWithQuery(<LeadCustomFieldsBlock {...baseProps} editable={false} />);
      expect(screen.getByText("12.345.678/0001-99")).toBeInTheDocument();
      // No <input> nor <textarea> for fields
      expect(screen.queryByLabelText(/cnpj/i)).not.toBeInTheDocument();
    });
  });
});
