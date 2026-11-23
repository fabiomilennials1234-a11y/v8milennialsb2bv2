import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FiltroPeriodoDeCriacao } from "./FiltroPeriodoDeCriacao";

const SP = "America/Sao_Paulo";

describe("FiltroPeriodoDeCriacao", () => {
  it("sem período, o botão diz que qualquer data vale", () => {
    render(<FiltroPeriodoDeCriacao timeZone={SP} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^período de chegada/i })).toHaveTextContent("qualquer data");
    expect(screen.queryByRole("button", { name: /remover período/i })).toBeNull();
  });

  it("atalho aplica o período e fecha", async () => {
    const onChange = vi.fn();
    render(<FiltroPeriodoDeCriacao timeZone={SP} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /^período de chegada/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Este mês" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const periodo = onChange.mock.calls[0][0];
    expect(periodo.from).toMatch(/T0[2-3]:00:00\.000Z$/); // meia-noite do dia 1 em SP
    expect(new Date(periodo.from) < new Date(periodo.to)).toBe(true);
  });

  it("mostra o período ativo e permite remover", async () => {
    const onChange = vi.fn();
    render(
      <FiltroPeriodoDeCriacao
        from="2026-11-01T03:00:00.000Z"
        to="2026-11-20T02:59:59.999Z"
        timeZone={SP}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("button", { name: /^período de chegada/i })).toHaveTextContent("01/11/2026 — 19/11/2026");
    await userEvent.click(screen.getByRole("button", { name: /remover período/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("Aplicar período fica desabilitado até escolher um dia", async () => {
    render(<FiltroPeriodoDeCriacao timeZone={SP} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^período de chegada/i }));
    expect(await screen.findByRole("button", { name: "Aplicar período" })).toBeDisabled();
  });
});
