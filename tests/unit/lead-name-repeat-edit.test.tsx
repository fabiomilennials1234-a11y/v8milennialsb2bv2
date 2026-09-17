import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LeadCardFields } from "@/modules/leads/components/lead-card/LeadCardFields";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

describe("edições sucessivas do nome do lead", () => {
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
