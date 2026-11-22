/**
 * Aquecimento do boot (perf pacote 1, Trilha A). O que importa provar:
 *   1. o chunk da rota atual desce no boot (e não em 2g/economia de dados);
 *   2. o aquecimento grava nas MESMAS chaves que os hooks reais leem — quem
 *      monta depois não refaz a ida (as fábricas de chave são as dos hooks);
 *   3. sem sessão/vínculo nada sai, e a org é sempre a do vínculo atual.
 */
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMockSupabase } from "../helpers/supabase-mock";

const h = vi.hoisted(() => ({
  mock: null as ReturnType<typeof createMockSupabase> | null,
  from: vi.fn(),
  user: { id: "u1" } as { id: string } | null,
  teamMember: null as Record<string, unknown> | null,
  master: { isMaster: false, isLoading: false },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      h.from(table);
      return h.mock!.sb.from(table);
    },
  },
}));
vi.mock("@/modules/identity", () => ({
  useAuth: () => ({ user: h.user }),
  useMasterAuth: () => h.master,
  useCurrentTeamMember: () => ({ data: h.teamMember }),
  useOrganization: () => ({ organizationId: h.teamMember?.organization_id ?? null }),
  isVirtualTeamMember: (id: string | null | undefined) => !!id && id.startsWith("master-virtual-"),
}));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: () => {} }));

import {
  AquecerTelaAtual,
  alvoDoAquecimento,
  aquecerTelaAtual,
  iniciarCargaDaRotaAtual,
} from "@/core/boot-prewarm";
import { registrarRotas, __resetarRotasParaTestes } from "@/core/route-prefetch";
import {
  useWhatsAppInstancesForUser,
  whatsappInstancesForUserKey,
} from "@/modules/communication/hooks/chat/useWhatsAppInstances";
import { pipelinesQueryKey, usePipelines } from "@/modules/pipelines/hooks/model/usePipelines";
import { funilStagesKey } from "@/modules/pipelines/hooks/model/usePaginatedFunil";

const membro = { id: "tm-1", user_id: "u1", organization_id: "org-A", role: "member" };

function conexao(c: Partial<{ saveData: boolean; effectiveType: string }> | undefined) {
  Object.defineProperty(navigator, "connection", { value: c, configurable: true });
}

/** Mesmo `staleTime` padrão do QueryClient do App (5 min) — sem ele todo mount refaria a ida. */
function novoCliente() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } } });
}

function comCliente(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  __resetarRotasParaTestes();
  conexao(undefined);
  h.from.mockClear();
  h.user = { id: "u1" };
  h.teamMember = { ...membro };
  h.master = { isMaster: false, isLoading: false };
  h.mock = createMockSupabase();
  h.mock.mockTable("whatsapp_instances", [
    { id: "cx-a1", instance_name: "a1", organization_id: "org-A", status: "connected" },
    { id: "cx-a2", instance_name: "a2", organization_id: "org-A", status: "connected" },
    { id: "cx-b1", instance_name: "b1", organization_id: "org-B", status: "connected" },
  ]);
  h.mock.mockTable("whatsapp_instance_allowed_members", [
    { whatsapp_instance_id: "cx-a1", team_member_id: "tm-1" },
    { whatsapp_instance_id: "cx-b1", team_member_id: "tm-1" },
  ]);
  h.mock.mockTable("pipelines", [
    { id: "p-a", organization_id: "org-A", slug: "vendas", is_active: true, display_order: 1 },
    { id: "p-b", organization_id: "org-B", slug: "vendas", is_active: true, display_order: 1 },
  ]);
  h.mock.mockTable("pipeline_stages", [
    { id: "s1", pipeline_id: "p-a", stage_key: "novo", position: 1, is_active: true },
    { id: "s2", pipeline_id: "p-b", stage_key: "novo", position: 1, is_active: true },
  ]);
});

describe("iniciarCargaDaRotaAtual — chunk da rota no boot", () => {
  it("baixa o chunk da rota em que o app abriu", () => {
    const imp = vi.fn(() => Promise.resolve({}));
    registrarRotas({ "/funil/:slug": imp });
    iniciarCargaDaRotaAtual("/funil/vendas");
    expect(imp).toHaveBeenCalledTimes(1);
  });

  it("usa o caminho atual da janela quando não recebe um", () => {
    const imp = vi.fn(() => Promise.resolve({}));
    registrarRotas({ [window.location.pathname]: imp });
    iniciarCargaDaRotaAtual();
    expect(imp).toHaveBeenCalledTimes(1);
  });

  it.each([{ saveData: true }, { effectiveType: "2g" }, { effectiveType: "slow-2g" }])(
    "não baixa com economia de dados/2g (%o)",
    (c) => {
      conexao(c);
      const imp = vi.fn(() => Promise.resolve({}));
      registrarRotas({ "/dashboard": imp });
      iniciarCargaDaRotaAtual("/dashboard");
      expect(imp).not.toHaveBeenCalled();
    },
  );
});

describe("alvoDoAquecimento", () => {
  it("mapeia funil, chat e Comando; o resto fica de fora", () => {
    expect(alvoDoAquecimento("/funil/vendas")).toEqual({ tipo: "funil", slug: "vendas" });
    expect(alvoDoAquecimento("/funil/vendas/?view=lista")).toEqual({ tipo: "funil", slug: "vendas" });
    expect(alvoDoAquecimento("/chat-whatsapp?phone=1")).toEqual({ tipo: "caixas" });
    expect(alvoDoAquecimento("/dashboard")).toEqual({ tipo: "caixas" });
    expect(alvoDoAquecimento("/leads")).toBeNull();
    expect(alvoDoAquecimento("/")).toBeNull();
    expect(alvoDoAquecimento("/funil")).toBeNull();
  });
});

describe("aquecerTelaAtual — mesmas chaves dos hooks reais", () => {
  it("caixas: grava na chave de useWhatsAppInstancesForUser e o hook não refaz a ida", async () => {
    const client = novoCliente();
    const dono = { organizationId: "org-A", teamMemberId: "tm-1", teamMemberRole: "member" };
    await aquecerTelaAtual(client, "/chat-whatsapp", dono);

    const aquecido = client.getQueryData<{ id: string }[]>(whatsappInstancesForUserKey(dono));
    // Só a caixa vinculada da org do vínculo — nunca a da outra org.
    expect(aquecido?.map((i) => i.id)).toEqual(["cx-a1"]);
    const idas = h.from.mock.calls.length;

    const { result } = renderHook(() => useWhatsAppInstancesForUser(), { wrapper: comCliente(client) });
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.data?.map((i) => i.id)).toEqual(["cx-a1"]);
    expect(h.from.mock.calls.length).toBe(idas);
  });

  it("funil: lista de funis + etapas nas chaves de usePipelines/useFunilStages, da org do vínculo", async () => {
    const client = novoCliente();
    await aquecerTelaAtual(client, "/funil/vendas", {
      organizationId: "org-A",
      teamMemberId: "tm-1",
      teamMemberRole: "member",
    });

    const funis = client.getQueryData<{ id: string }[]>(pipelinesQueryKey("org-A"));
    expect(funis?.map((p) => p.id)).toEqual(["p-a"]);
    const etapas = client.getQueryData<{ id: string }[]>(funilStagesKey("p-a"));
    expect(etapas?.map((s) => s.id)).toEqual(["s1"]);
    expect(client.getQueryData(funilStagesKey("p-b"))).toBeUndefined();

    const idas = h.from.mock.calls.length;
    const { result } = renderHook(() => usePipelines(), { wrapper: comCliente(client) });
    expect(result.current.isSuccess).toBe(true);
    expect(h.from.mock.calls.length).toBe(idas);
  });

  it("funil inexistente: aquece a lista e para — sem etapas de funil nenhum", async () => {
    const client = novoCliente();
    await aquecerTelaAtual(client, "/funil/nao-existe", {
      organizationId: "org-A",
      teamMemberId: "tm-1",
      teamMemberRole: "member",
    });
    expect(h.from.mock.calls.map(([t]) => t)).toEqual(["pipelines"]);
  });

  it("falha de leitura vira silêncio: não lança e não grava nada", async () => {
    h.mock!.mockSelectError("whatsapp_instances", { code: "42501", message: "denied" });
    const client = novoCliente();
    const dono = { organizationId: "org-A", teamMemberId: "tm-1", teamMemberRole: "member" };
    await expect(aquecerTelaAtual(client, "/dashboard", dono)).resolves.toBeUndefined();
    expect(client.getQueryData(whatsappInstancesForUserKey(dono))).toBeUndefined();
  });

  it("sem vínculo completo não sai nada", async () => {
    const client = novoCliente();
    await aquecerTelaAtual(client, "/dashboard", { organizationId: "org-A", teamMemberId: null, teamMemberRole: null });
    await aquecerTelaAtual(client, "/dashboard", { organizationId: null, teamMemberId: "tm-1", teamMemberRole: null });
    expect(h.from).not.toHaveBeenCalled();
  });
});

describe("<AquecerTelaAtual />", () => {
  function montar(path: string, client = novoCliente()) {
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <AquecerTelaAtual />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("com sessão e vínculo, aquece a tela atual", async () => {
    const client = novoCliente();
    montar("/dashboard", client);
    await waitFor(() =>
      expect(
        client.getQueryData(
          whatsappInstancesForUserKey({ organizationId: "org-A", teamMemberId: "tm-1", teamMemberRole: "member" }),
        ),
      ).toBeDefined(),
    );
  });

  it("sem sessão não sai nada", async () => {
    h.user = null;
    montar("/dashboard");
    await new Promise((r) => setTimeout(r, 20));
    expect(h.from).not.toHaveBeenCalled();
  });

  it("sem vínculo resolvido não sai nada", async () => {
    h.teamMember = null;
    montar("/dashboard");
    await new Promise((r) => setTimeout(r, 20));
    expect(h.from).not.toHaveBeenCalled();
  });

  it("vínculo de OUTRO usuário (cache de sessão anterior) não aquece", async () => {
    h.teamMember = { ...membro, user_id: "outro-usuario" };
    montar("/dashboard");
    await new Promise((r) => setTimeout(r, 20));
    expect(h.from).not.toHaveBeenCalled();
  });

  it("master não é aquecido (nada antes do 2º fator), nem com vínculo virtual pronto", async () => {
    h.master = { isMaster: true, isLoading: false };
    h.teamMember = { id: "master-virtual-u1", user_id: "u1", organization_id: "org-A", role: "admin" };
    montar("/dashboard");
    await new Promise((r) => setTimeout(r, 20));
    expect(h.from).not.toHaveBeenCalled();
  });

  it("identidade master ainda resolvendo: espera, não aquece", async () => {
    h.master = { isMaster: false, isLoading: true };
    montar("/dashboard");
    await new Promise((r) => setTimeout(r, 20));
    expect(h.from).not.toHaveBeenCalled();
  });

  it("aquece uma vez por org, não a cada render", async () => {
    const client = novoCliente();
    const { rerender } = montar("/dashboard", client);
    await waitFor(() => expect(h.from).toHaveBeenCalled());
    const idas = h.from.mock.calls.length;
    rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <AquecerTelaAtual />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(h.from.mock.calls.length).toBe(idas);
  });
});
