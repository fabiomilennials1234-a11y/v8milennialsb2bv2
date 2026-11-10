import { renderHook } from "@testing-library/react";

const id = vi.hoisted(() => ({ isAdmin: true, teamMemberId: "tm-1" as string | null, isLoading: false, flag: true }));
vi.mock("@/modules/identity", () => ({
  useIdentity: () => ({ isAdmin: id.isAdmin, teamMemberId: id.teamMemberId, isLoading: id.isLoading }),
  useOrganization: () => ({ organizationId: "org-1", teamMemberId: id.teamMemberId }),
}));
vi.mock("./useFeatureFlag", () => ({ useFeatureFlag: () => ({ enabled: id.flag, isLoading: false }) }));

import { useVisaoMeuTodos } from "./useVisaoMeuTodos";

const CHAVE = "v8:ui:visao-meu-todos:funis:org-1:tm-1";

beforeEach(() => {
  localStorage.clear();
  id.isAdmin = true;
  id.teamMemberId = "tm-1";
  id.isLoading = false;
  id.flag = true;
});

describe("useVisaoMeuTodos — pronto", () => {
  it("admin com 'Meus' salvo: só fica pronto DEPOIS de ler a escolha — e ela é 'meu'", () => {
    const amanha = new Date(Date.now() + 86_400_000).toISOString();
    localStorage.setItem(CHAVE, JSON.stringify({ value: "meu", savedAt: new Date().toISOString(), expiresAt: amanha }));
    const vistos: Array<{ pronto: boolean; visao: string }> = [];
    renderHook(() => {
      const v = useVisaoMeuTodos("funis");
      vistos.push({ pronto: v.pronto, visao: v.visao });
      return v;
    });
    // Nenhum render diz "pronto" com a visão padrão no lugar da salva.
    expect(vistos.filter((v) => v.pronto).every((v) => v.visao === "meu")).toBe(true);
    expect(vistos.at(-1)).toEqual({ pronto: true, visao: "meu" });
  });

  it("sem o controle (não é admin): a visão é a padrão e já está pronta", () => {
    id.isAdmin = false;
    const { result } = renderHook(() => useVisaoMeuTodos("funis"));
    expect(result.current).toMatchObject({ disponivel: false, pronto: true, donoForcado: null });
  });

  it("identidade carregando: não está pronto", () => {
    id.isLoading = true;
    const { result } = renderHook(() => useVisaoMeuTodos("funis"));
    expect(result.current.pronto).toBe(false);
  });
});
