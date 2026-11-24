/**
 * Registrar pagamento por título: a lista é a decisão, o valor acompanha a
 * soma dos marcados e a RPC recebe exatamente os títulos marcados.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InadimplenteResumo, TituloSaldo } from "../lib/tipos";
import { PagamentoDialog } from "./PagamentoDialog";

const mutate = vi.fn();
let buscados: { data?: TituloSaldo[]; isError: boolean };
const buscouCom = vi.fn();

vi.mock("../hooks/useCobrancaMutacoes", () => ({
  useRegistrarPagamento: () => ({ mutate, isPending: false }),
}));
vi.mock("../hooks/useCobrancaDados", () => ({
  useTitulosEmAberto: (id: string | null) => {
    buscouCom(id);
    return buscados;
  },
}));

const caso = { id: "i1", casoId: "c1", nome: "Distribuidora Exemplo", saldoAberto: 1157.12 } as InadimplenteResumo;
const titulo = (id: string, numero: string, saldo: number, extra: Partial<TituloSaldo> = {}): TituloSaldo => ({
  id,
  origem: "manual",
  numero,
  descricao: null,
  valor: saldo,
  valorPago: 0,
  saldo,
  vencimento: "2026-11-23",
  status: "aberto",
  pagoEm: null,
  ...extra,
});
// Os três do relato do cliente (24/11), mais um pago e um do ERP que não entram na lista.
const TITULOS = [
  titulo("t1", "20311.01", 318.98),
  titulo("t2", "20311.02", 500.81),
  titulo("t3", "20311.03", 337.33),
  titulo("t4", "9999.01", 0, { status: "pago", pagoEm: "2026-11-20" }),
  titulo("t5", "ERP-1", 80, { origem: "erp" }),
];

const valor = () => (screen.getByLabelText("Valor recebido") as HTMLInputElement).value;
const caixa = (numero: string) => screen.getByRole("checkbox", { name: new RegExp(numero.replace(".", "\\.")) });
const registrar = () => screen.getByRole("button", { name: "Registrar" }) as HTMLButtonElement;

function abrir(props: Partial<Parameters<typeof PagamentoDialog>[0]> = {}) {
  render(<PagamentoDialog aberto onFechar={vi.fn()} caso={caso} titulos={TITULOS} {...props} />);
}

describe("PagamentoDialog", () => {
  beforeEach(() => {
    mutate.mockReset();
    buscouCom.mockReset();
    buscados = { data: undefined, isError: false };
  });

  it("abre com todos os títulos baixáveis marcados e o valor da soma", () => {
    abrir();
    const lista = screen.getByRole("group", { name: "Títulos pagos" });
    expect(within(lista).getAllByRole("checkbox")).toHaveLength(3);
    expect(within(lista).queryByText("9999.01")).toBeNull();
    expect(within(lista).queryByText("ERP-1")).toBeNull();
    expect(screen.getByText("1 título do ERP baixa pelo próprio ERP.")).toBeTruthy();
    expect(valor()).toBe("1.157,12");
    expect(screen.getByText("3 de 3 títulos")).toBeTruthy();
  });

  it("paga dois de três: desmarcar recalcula o valor e a RPC recebe só os marcados", async () => {
    abrir();
    await userEvent.click(caixa("20311.02"));
    expect(valor()).toBe("656,31");
    expect(screen.getByText("2 de 3 títulos")).toBeTruthy();
    await userEvent.click(registrar());
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({ casoId: "c1", valor: 656.31, tituloIds: ["t1", "t3"] });
  });

  it("aberto pela linha do título, só ele vem marcado", () => {
    abrir({ tituloInicial: "t2" });
    expect(caixa("20311.02").getAttribute("data-state")).toBe("checked");
    expect(caixa("20311.01").getAttribute("data-state")).toBe("unchecked");
    expect(valor()).toBe("500,81");
  });

  it("sem título marcado ou valor acima dos marcados, não registra", async () => {
    abrir({ tituloInicial: "t1" });
    await userEvent.click(caixa("20311.01"));
    expect(screen.getByText("Marque ao menos um título.")).toBeTruthy();
    expect(registrar().disabled).toBe(true);

    await userEvent.click(caixa("20311.01"));
    const campo = screen.getByLabelText("Valor recebido");
    await userEvent.clear(campo);
    await userEvent.type(campo, "400");
    expect(screen.getByText("Passa do saldo dos títulos marcados (R$ 318,98).")).toBeTruthy();
    expect(registrar().disabled).toBe(true);
  });

  it("valor menor que a soma é parcial e avisa como abate", async () => {
    abrir();
    const campo = screen.getByLabelText("Valor recebido");
    await userEvent.clear(campo);
    await userEvent.type(campo, "500");
    expect(screen.getByText("Parcial: abate do vencimento mais antigo entre os marcados.")).toBeTruthy();
    await userEvent.click(registrar());
    expect(mutate.mock.calls[0][0]).toMatchObject({ valor: 500, tituloIds: ["t1", "t2", "t3"] });
  });

  it("fora da ficha, busca os títulos do inadimplente", () => {
    buscados = { data: TITULOS.slice(0, 2), isError: false };
    abrir({ titulos: undefined });
    expect(buscouCom).toHaveBeenCalledWith("i1");
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(valor()).toBe("819,79");
  });

  it("com os títulos da ficha, não busca de novo", () => {
    abrir();
    expect(buscouCom).toHaveBeenCalledWith(null);
  });
});
