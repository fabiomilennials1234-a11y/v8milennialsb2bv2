/**
 * As duas promessas de custo e de isolamento que o hook faz — com rede.
 *
 * Elas eram só comentário. Medido pela revisão: transformar o hook num poll de
 * 3 s deixava 26 testes verdes, e tirar o `organizationId` do `queryKey` deixava
 * 270 verdes. Promessa sem asserção é decoração; estes testes leem as opções que
 * o hook realmente entrega ao TanStack Query.
 *
 * O chat é o caminho mais quente do produto — um `refetchInterval` aqui cobra de
 * toda a base, o tempo inteiro, por um evento que quase nunca acontece.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Opções capturadas na última chamada de `useQuery`. */
let opcoes: Record<string, unknown> | null = null;

vi.mock("@tanstack/react-query", async () => {
  const real = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return {
    ...real,
    useQuery: (opts: Record<string, unknown>) => {
      opcoes = opts;
      return { data: [], isLoading: false } as unknown as ReturnType<typeof real.useQuery>;
    },
  };
});

let orgId: string | null = "org-1";
vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({ data: orgId ? { organization_id: orgId } : null }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({}) },
}));

import { useConversationCalls } from "./useConversationCalls";

beforeEach(() => {
  opcoes = null;
  orgId = "org-1";
});

function montar(phone: string | null, leadId: string | null) {
  renderHook(() => useConversationCalls(phone, leadId));
  return opcoes!;
}

describe("useConversationCalls — custo", () => {
  it("NÃO faz poll: nenhum refetchInterval", () => {
    const o = montar("5548996458738", null);
    expect(o.refetchInterval).toBeUndefined();
    expect(o.refetchIntervalInBackground).toBeUndefined();
  });

  it("uma conversa aberta = uma consulta, cacheada por um tempo", () => {
    const o = montar("5548996458738", null);
    // Sem frescor a volta para a mesma conversa refaria a consulta.
    expect(typeof o.staleTime).toBe("number");
    expect(o.staleTime as number).toBeGreaterThan(0);
  });

  it("sem telefone e sem lead a consulta nem é habilitada", () => {
    const o = montar("   ", null);
    expect(o.enabled).toBe(false);
  });

  it("sem organização não consulta", () => {
    orgId = null;
    const o = montar("5548996458738", null);
    expect(o.enabled).toBeFalsy();
  });
});

describe("useConversationCalls — isolamento entre organizações", () => {
  it("a organização faz parte da identidade do cache", () => {
    orgId = "org-1";
    const a = montar("5548996458738", null).queryKey as unknown[];
    orgId = "org-2";
    const b = montar("5548996458738", null).queryKey as unknown[];

    expect(a).toContain("org-1");
    expect(b).toContain("org-2");
    // Duas orgs com o MESMO telefone não podem compartilhar entrada de cache:
    // seria a ligação de um cliente aparecendo na conversa de outro.
    expect(a).not.toEqual(b);
  });

  it("o mesmo telefone em formatos diferentes é UMA entrada de cache", () => {
    const a = montar("5548996458738", null).queryKey as unknown[];
    const b = montar("+55 (48) 99645-8738", null).queryKey as unknown[];
    const c = montar("48996458738", null).queryKey as unknown[];

    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("lead diferente é consulta diferente — o filtro muda", () => {
    const semLead = montar("5548996458738", null).queryKey as unknown[];
    const comLead = montar(
      "5548996458738",
      "11111111-2222-4333-8444-555555555555",
    ).queryKey as unknown[];

    expect(semLead).not.toEqual(comLead);
  });
});
