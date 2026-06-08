import { render, screen, fireEvent } from "@testing-library/react";
import { VariableInserter } from "../VariableInserter";

// Mutable holders so each test can set what the org "has".
const holder: { tags: unknown[]; fields: unknown[] } = { tags: [], fields: [] };

// The picker pulls the org's real Tags and Custom Fields from the leads module.
vi.mock("@/modules/leads", () => ({
  useTags: () => ({ data: holder.tags }),
  useLeadCustomFields: () => ({ data: holder.fields }),
}));

beforeEach(() => {
  holder.tags = [{ id: "t1", name: "AÇAIZINHO", color: "#6366f1" }];
  holder.fields = [{ id: "f1", field_name: "Qual o tipo do seu negócio?", field_type: "text" }];
});

describe("VariableInserter — dynamic categories", () => {
  it("inserts {{tag.<name>}} when an org Tag chip is clicked", () => {
    const onInsert = vi.fn();
    render(<VariableInserter onInsert={onInsert} />);

    fireEvent.click(screen.getByText("Tags"));
    fireEvent.click(screen.getByText("AÇAIZINHO"));

    expect(onInsert).toHaveBeenCalledWith("{{tag.AÇAIZINHO}}");
  });

  it("inserts {{custom.<field_name>}} when a Custom Field chip is clicked", () => {
    const onInsert = vi.fn();
    render(<VariableInserter onInsert={onInsert} />);

    fireEvent.click(screen.getByText("Campos Personalizados"));
    fireEvent.click(screen.getByText("Qual o tipo do seu negócio?"));

    expect(onInsert).toHaveBeenCalledWith("{{custom.Qual o tipo do seu negócio?}}");
  });

  it("omits the Tags category when the org has no tags", () => {
    holder.tags = [];
    render(<VariableInserter onInsert={vi.fn()} />);

    expect(screen.queryByText("Tags")).not.toBeInTheDocument();
    // Custom Fields category still present (independent).
    expect(screen.getByText("Campos Personalizados")).toBeInTheDocument();
  });
});
