import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LeadCardFields } from "@/modules/leads/components/lead-card/LeadCardFields";
import { LeadCard } from "@/modules/leads/components/lead-card/LeadCard";
import { LeadCardAside } from "@/modules/leads/components/lead-card/LeadCardAside";
import { LEAD_EXEMPLO } from "@/modules/leads/components/lead-card/fixtures";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

describe("edições sucessivas do nome do lead", () => {
  it.each(["card", "coluna"])("não leva o nome salvo para outro lead na %s", async (surface) => {
    const save = vi.fn().mockResolvedValue(undefined);
    const lead = { ...LEAD_EXEMPLO, id: "lead-1", nome: "Ana", campos: [{
      titulo: "Perfil", campos: [{ chave: "name", rotulo: "Nome", valor: "Ana" }],
    }] };
    const Component = surface === "card" ? LeadCard : LeadCardAside;
    const { rerender } = render(<Component lead={lead} onSaveField={save} />);
    if (surface === "card") fireEvent.click(screen.getByRole("button", { name: /Dados/ }));
    fireEvent.click(screen.getByRole("button", { name: "Ana" }));
    const input = screen.getByDisplayValue("Ana");
    fireEvent.change(input, { target: { value: "Ana Silva" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Ana Silva" })).toBeInTheDocument());
    rerender(<Component lead={{ ...lead, id: "lead-2" }} onSaveField={save} />);
    if (surface === "card") fireEvent.click(screen.getByRole("button", { name: /Dados/ }));
    expect(screen.getByRole("button", { name: "Ana" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ana Silva" })).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("permite voltar ao nome original antes do refetch e continuar editando", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<LeadCardFields grupos={[{ titulo: "Perfil", campos: [
      { chave: "name", rotulo: "Nome", valor: "Ana" },
    ] }]} onSave={save} />);

    for (const [index, name] of ["Ana Silva", "Ana", "Ana Souza"].entries()) {
      fireEvent.click(screen.getByRole("button"));
      fireEvent.change(screen.getByRole("textbox"), { target: { value: name } });
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
      await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
      expect(save).toHaveBeenNthCalledWith(index + 1, "name", name);
    }
    expect(screen.getByRole("button")).toHaveTextContent("Ana Souza");
  });

  it("permite várias edições após receber o nome atualizado do servidor", async () => {
    const save = vi.fn();
    function Panel() {
      const [name, setName] = useState("Ana");
      return <LeadCardFields grupos={[{ titulo: "Perfil", campos: [
        { chave: "name", rotulo: "Nome", valor: name },
      ] }]} onSave={async (key, value) => { save(key, value); setName(value); }} />;
    }
    render(<Panel />);
    for (const [index, name] of ["Ana Silva", "Ana Souza", "Ana", "Ana Santos"].entries()) {
      fireEvent.click(screen.getByRole("button"));
      fireEvent.change(screen.getByRole("textbox"), { target: { value: name } });
      fireEvent.blur(screen.getByRole("textbox"));
      await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
      expect(save).toHaveBeenNthCalledWith(index + 1, "name", name);
      expect(screen.getByRole("button")).toHaveTextContent(name);
    }
  });
});
