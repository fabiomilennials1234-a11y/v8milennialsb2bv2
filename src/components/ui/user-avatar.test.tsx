/**
 * Regressão — UserAvatar não pode quebrar com nome ausente.
 *
 * Bug de origem (2026-07-27): a página /ranking (Performance) morria inteira com
 * "Cannot read properties of null (reading 'split')". O componente tipava
 * `name: string` e fazia `name.split(" ")` direto, mas os call sites alimentam
 * ele com nome vindo de RPC — `get_ranking_data` devolve `name: string | null`.
 * O erro de tipo existia, mas estava suprimido pelo .tsc-baseline.json, então
 * só aparecia em runtime, derrubando a tela.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UserAvatar } from "./user-avatar";

describe("UserAvatar", () => {
  it("não quebra e mostra '?' quando name é null", () => {
    expect(() => render(<UserAvatar name={null} />)).not.toThrow();
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("não quebra quando name é undefined", () => {
    expect(() => render(<UserAvatar name={undefined} />)).not.toThrow();
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("cai no '?' com string vazia ou só espaços", () => {
    const { rerender } = render(<UserAvatar name="" />);
    expect(screen.getByText("?")).toBeInTheDocument();
    rerender(<UserAvatar name="   " />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("monta as iniciais a partir dos dois primeiros nomes", () => {
    render(<UserAvatar name="Tania Biasotto" />);
    expect(screen.getByText("TB")).toBeInTheDocument();
  });

  it("tolera espaços extras entre os nomes", () => {
    render(<UserAvatar name="  Elena   Faria  " />);
    expect(screen.getByText("EF")).toBeInTheDocument();
  });

  it("usa uma inicial só quando o nome tem uma palavra", () => {
    render(<UserAvatar name="Ricardo" />);
    expect(screen.getByText("R")).toBeInTheDocument();
  });
});
