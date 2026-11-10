import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";

const flag = vi.hoisted(() => ({ enabled: true, isLoading: false }));
vi.mock("@/modules/platform/hooks/useFeatureFlag", () => ({
  useFeatureFlag: (key: string) =>
    key === "chat_ir_para_negocio" ? { enabled: flag.enabled, isLoading: flag.isLoading } : { enabled: false, isLoading: false },
}));

import { usePedidoDoNegocio } from "./usePedidoDoNegocio";

const NEGOCIO = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f";
const FUNIL_A = "8106f2dc-e13b-4aaa-8058-05034c1e239a";
const FUNIL_B = "11111111-2222-4333-8444-555555555555";

function montar(url: string, state?: unknown, param = FUNIL_A) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[{ pathname: url.split("?")[0], search: url.includes("?") ? `?${url.split("?")[1]}` : "", state }]}>
      {children}
    </MemoryRouter>
  );
  return renderHook(
    ({ p }: { p: string }) => {
      const r = usePedidoDoNegocio(p);
      return { ...r, busca: useLocation().search, navegar: useNavigate() };
    },
    { wrapper, initialProps: { p: param } },
  );
}

beforeEach(() => {
  flag.enabled = true;
  flag.isLoading = false;
});

describe("usePedidoDoNegocio", () => {
  it("com a flag: consome o ?negocio= UMA vez e o tira da URL (F5 não repete)", () => {
    const { result } = montar(`/funil/${FUNIL_A}?negocio=${NEGOCIO}&view=v1`);
    expect(result.current.pedido).toMatchObject({ entryId: NEGOCIO, funil: FUNIL_A, viaTeclado: false });
    expect(result.current.busca).toBe("?view=v1");
    expect(result.current.ligado).toBe(true);
  });

  it("veio pelo teclado no chat: o pedido diz isso ao board", () => {
    const { result } = montar(`/funil/${FUNIL_A}?negocio=${NEGOCIO}`, { viaTeclado: true });
    expect(result.current.pedido?.viaTeclado).toBe(true);
  });

  it("kill switch: sem a flag, o board ignora o endereço (links já enviados) e só limpa a URL", () => {
    flag.enabled = false;
    const { result } = montar(`/funil/${FUNIL_A}?negocio=${NEGOCIO}`);
    expect(result.current.pedido).toBeNull();
    expect(result.current.busca).toBe("");
    expect(result.current.ligado).toBe(false);
  });

  it("flag ainda carregando: não decide nem mexe na URL", () => {
    flag.isLoading = true;
    flag.enabled = false;
    const { result } = montar(`/funil/${FUNIL_A}?negocio=${NEGOCIO}`);
    expect(result.current.pedido).toBeNull();
    expect(result.current.busca).toBe(`?negocio=${NEGOCIO}`);
  });

  it("valor que não é UUID não vira pedido (vai para seletor de DOM e RPC)", () => {
    const { result } = montar(`/funil/${FUNIL_A}?negocio=%22%5D%3Cscript%3E`);
    expect(result.current.pedido).toBeNull();
  });

  it("trocar de funil encerra o pedido; o do outro funil nunca vale aqui (redirect)", () => {
    const { result, rerender } = montar(`/funil/${FUNIL_A}?negocio=${NEGOCIO}`);
    expect(result.current.pedido?.funil).toBe(FUNIL_A);
    // O render do redirect: a rota já é B, o pedido ainda é o de A.
    rerender({ p: FUNIL_B });
    expect(result.current.pedido).toBeNull();
    // A URL do redirect traz o pedido de novo, agora para B.
    act(() => result.current.navegar(`/funil/${FUNIL_B}?negocio=${NEGOCIO}`, { replace: true }));
    expect(result.current.pedido).toMatchObject({ entryId: NEGOCIO, funil: FUNIL_B });
  });
});
