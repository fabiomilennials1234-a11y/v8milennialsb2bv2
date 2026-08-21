/**
 * Fatia "lead vinculado a identidade de Instagram" — A PORTA DO HUMANO.
 *
 * O webhook não cria lead (ver `notificame-lead-link-inbound.test.ts`). Quem cria
 * é ESTE caminho: `useSocialLeadLink`, no clique de uma pessoa autenticada. Como
 * ele é a ÚNICA porta, o que se cobra aqui é o que uma porta precisa ter:
 *
 *   • A ORG VEM DO AUTH, e de mais lugar nenhum. Nenhuma das três mutations
 *     aceita `organizationId` no argumento — nem por acidente, nem por um campo a
 *     mais no objeto. Sem org resolvida, a chamada NÃO SAI: `p_org` forjado pelo
 *     chamador é o vetor catalogado deste repo (RPC DEFINER que recorta por
 *     parâmetro do cliente).
 *
 *   • A SEGUNDA REIVINDICAÇÃO DO MESMO IGSID NÃO SOBRESCREVE. O servidor levanta
 *     `identity_already_linked:<lead_id>`; o front tem que LER o id e oferecer o
 *     lead atual. Sobrescrever seria roubo de conversa entre dois vendedores da
 *     mesma org, sem trilha.
 *
 *   • TELEFONE VAZIO VIRA NULL antes de sair do browser. `''` num lead é o campo
 *     que o resgate de telefone (`.is('phone', null)`) nunca mais alcança.
 *
 *   • ESCRITA SÓ POR RPC. Nenhum `.from(...)` de tabela — não por estilo: a
 *     identidade é SELECT-only para `authenticated` e o backfill do histórico é
 *     impossível de fora da DEFINER.
 *
 * Sem rede: `supabase.rpc` e o team member do auth são controlados aqui.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";

const { rpcMock, fromMock, teamMemberMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
  teamMemberMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    // Presente e ACUSADOR: se algum caminho tentar escrever em tabela pelo
    // PostgREST, o teste morre com a razão escrita.
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => teamMemberMock(),
}));

import {
  useLinkSocialConversationToLead,
  useCreateLeadFromSocial,
  useUnlinkSocialConversation,
  parseAlreadyLinkedLeadId,
} from "@/modules/communication/hooks/chat/useSocialLeadLink";

// ── fixtures ─────────────────────────────────────────────────────────────────

const ORG_DO_AUTH = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_FORJADA = "bbbbbbbb-0000-4000-8000-000000000002";
const CANAL = "cccccccc-1111-4111-8111-111111111111";
const IGSID = "igsid-cliente-777";
const LEAD = "eeeeeeee-1111-4111-8111-111111111111";
const OUTRO_LEAD = "ffffffff-2222-4222-8222-222222222222";

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const argsDaRpc = (nome: string) =>
  (rpcMock.mock.calls.find((c) => c[0] === nome)?.[1] ?? null) as Record<string, unknown> | null;

beforeEach(() => {
  vi.clearAllMocks();
  teamMemberMock.mockReturnValue({ data: { id: "tm-1", organization_id: ORG_DO_AUTH } });
  rpcMock.mockResolvedValue({ data: LEAD, error: null });
  fromMock.mockImplementation((tabela: string) => {
    throw new Error(`escrita direta em ${tabela} — esta fatia só escreve por RPC`);
  });
});

// ─── 1. a org vem do auth ────────────────────────────────────────────────────

describe("1. a organização vem do auth, nunca do chamador", () => {
  it("vincular manda `p_org` = org do team member logado", async () => {
    const { result } = renderHook(() => useLinkSocialConversationToLead(CANAL), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ externalUserId: IGSID, leadId: LEAD });
    });

    expect(argsDaRpc("link_social_conversation_to_lead")).toEqual({
      p_org: ORG_DO_AUTH,
      p_channel: CANAL,
      p_external_user_id: IGSID,
      p_lead_id: LEAD,
    });
  });

  it("um `organizationId` enfiado no argumento é IGNORADO — não vira p_org", async () => {
    const { result } = renderHook(() => useLinkSocialConversationToLead(CANAL), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        externalUserId: IGSID,
        leadId: LEAD,
        // Campo hostil: é assim que um caminho de UI descuidado ofereceria a org.
        ...({ organizationId: ORG_FORJADA, p_org: ORG_FORJADA } as Record<string, unknown>),
      } as never);
    });

    const args = argsDaRpc("link_social_conversation_to_lead")!;
    expect(args.p_org).toBe(ORG_DO_AUTH);
    expect(JSON.stringify(args)).not.toContain(ORG_FORJADA);
  });

  it("criar idem — `p_org` sai do auth, e o resto do payload é o esperado", async () => {
    const { result } = renderHook(() => useCreateLeadFromSocial(CANAL), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        messagingChannelId: CANAL,
        externalUserId: IGSID,
        name: "Fulana da Silva",
        destination: "qualificacao",
      });
    });

    const args = argsDaRpc("create_lead_from_social_conversation")!;
    expect(args.p_org).toBe(ORG_DO_AUTH);
    expect(args.p_channel).toBe(CANAL);
    expect(args.p_name).toBe("Fulana da Silva");
    expect(args.p_destination).toBe("qualificacao");
  });

  it("desvincular idem", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useUnlinkSocialConversation(CANAL), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ externalUserId: IGSID });
    });

    expect(argsDaRpc("unlink_social_conversation_from_lead")).toEqual({
      p_org: ORG_DO_AUTH,
      p_channel: CANAL,
      p_external_user_id: IGSID,
    });
  });

  it("SEM org no auth: a chamada NÃO SAI (fail-closed, não `null` no p_org)", async () => {
    // Mandar `p_org: null` faria a RPC devolver 42501 — mas só depois de uma ida
    // ao servidor, e com mensagem que ninguém liga a "seu usuário não tem org".
    teamMemberMock.mockReturnValue({ data: null });
    const { result } = renderHook(() => useCreateLeadFromSocial(CANAL), { wrapper });

    await expect(
      result.current.mutateAsync({
        messagingChannelId: CANAL,
        externalUserId: IGSID,
        name: "Fulana",
        destination: "qualificacao",
      }),
    ).rejects.toThrow(/organiza/i);

    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("SEM canal: idem — conversa sem canal de origem não vincula nada", async () => {
    const { result } = renderHook(() => useLinkSocialConversationToLead(null), { wrapper });

    await expect(
      result.current.mutateAsync({ externalUserId: IGSID, leadId: LEAD }),
    ).rejects.toThrow(/canal/i);

    expect(rpcMock).not.toHaveBeenCalled();
  });
});

// ─── 2. a segunda reivindicação do mesmo IGSID ──────────────────────────────

describe("2. dois leads não reivindicam a mesma identidade", () => {
  it("o erro do servidor sobe INTEIRO — o front não engole nem reenvia", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: `identity_already_linked:${OUTRO_LEAD}` },
    });
    const { result } = renderHook(() => useLinkSocialConversationToLead(CANAL), { wrapper });

    await expect(
      result.current.mutateAsync({ externalUserId: IGSID, leadId: LEAD }),
    ).rejects.toMatchObject({ message: `identity_already_linked:${OUTRO_LEAD}` });

    // UMA chamada. Retry automático numa recusa de unicidade seria martelar o
    // índice esperando que ele ceda.
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("a UI consegue extrair QUAL lead já detém a identidade", () => {
    // Sem o id, a única mensagem possível seria "já vinculado" — e o vendedor não
    // teria como chegar ao lead que está do outro lado.
    expect(parseAlreadyLinkedLeadId({ message: `identity_already_linked:${OUTRO_LEAD}` })).toBe(
      OUTRO_LEAD,
    );
  });

  it.each([
    ["permissão", { message: "forbidden: leads.create" }],
    ["canal de outra org", { message: "forbidden: channel not in org" }],
    ["erro sem mensagem", {}],
    ["texto parecido, sem uuid", { message: "identity_already_linked:" }],
  ])("%s NÃO é lido como 'já vinculado' — a UI não pode mentir sobre a causa", (_l, err) => {
    expect(parseAlreadyLinkedLeadId(err)).toBeNull();
  });

  it("criar recusa a segunda vez pelo MESMO erro — o caminho não desvia para vincular", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: `identity_already_linked:${OUTRO_LEAD}` },
    });
    const { result } = renderHook(() => useCreateLeadFromSocial(CANAL), { wrapper });

    await expect(
      result.current.mutateAsync({
        messagingChannelId: CANAL,
        externalUserId: IGSID,
        name: "Fulana",
        destination: "qualificacao",
      }),
    ).rejects.toMatchObject({ message: `identity_already_linked:${OUTRO_LEAD}` });

    // Nenhum segundo round-trip "consertando" — um lead a mais era exatamente o
    // que a transação única existe para impedir.
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});

// ─── 3. o lead que nasce sem telefone ────────────────────────────────────────

describe("3. telefone, e-mail e empresa vazios saem NULOS", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["string vazia", ""],
    ["só espaço", "   "],
  ])("phone = %s ⇒ p_phone null, JAMAIS ''", async (_l, phone) => {
    const { result } = renderHook(() => useCreateLeadFromSocial(CANAL), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        messagingChannelId: CANAL,
        externalUserId: IGSID,
        name: "Fulana",
        phone: phone as string | null | undefined,
        destination: "qualificacao",
      });
    });

    const args = argsDaRpc("create_lead_from_social_conversation")!;
    expect(args.p_phone).toBeNull();
    expect(args.p_phone).not.toBe("");
  });

  it("CONTROLE POSITIVO: telefone informado atravessa (aparado)", async () => {
    const { result } = renderHook(() => useCreateLeadFromSocial(CANAL), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        messagingChannelId: CANAL,
        externalUserId: IGSID,
        name: "Fulana",
        phone: "  11987654321  ",
        destination: "qualificacao",
      });
    });

    expect(argsDaRpc("create_lead_from_social_conversation")!.p_phone).toBe("11987654321");
  });

  it("e-mail e empresa vazios também viram null — nada de '' na base", async () => {
    const { result } = renderHook(() => useCreateLeadFromSocial(CANAL), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        messagingChannelId: CANAL,
        externalUserId: IGSID,
        name: "Fulana",
        email: "   ",
        company: "",
        destination: "qualificacao",
      });
    });

    const args = argsDaRpc("create_lead_from_social_conversation")!;
    expect(args.p_email).toBeNull();
    expect(args.p_company).toBeNull();
  });

  it("nome em branco não sai do browser — e o servidor cobra de novo", async () => {
    const { result } = renderHook(() => useCreateLeadFromSocial(CANAL), { wrapper });

    await expect(
      result.current.mutateAsync({
        messagingChannelId: CANAL,
        externalUserId: IGSID,
        name: "   ",
        destination: "qualificacao",
      }),
    ).rejects.toThrow(/nome/i);

    expect(rpcMock).not.toHaveBeenCalled();
  });
});

// ─── 4. escrita só por RPC ───────────────────────────────────────────────────

describe("4. nenhuma escrita direta em tabela", () => {
  it("as três mutations usam RPC e nunca `.from(...)`", async () => {
    const link = renderHook(() => useLinkSocialConversationToLead(CANAL), { wrapper });
    await act(async () => {
      await link.result.current.mutateAsync({ externalUserId: IGSID, leadId: LEAD });
    });

    const criar = renderHook(() => useCreateLeadFromSocial(CANAL), { wrapper });
    await act(async () => {
      await criar.result.current.mutateAsync({
        messagingChannelId: CANAL,
        externalUserId: IGSID,
        name: "Fulana",
        destination: "qualificacao",
      });
    });

    rpcMock.mockResolvedValue({ data: null, error: null });
    const desvincular = renderHook(() => useUnlinkSocialConversation(CANAL), { wrapper });
    await act(async () => {
      await desvincular.result.current.mutateAsync({ externalUserId: IGSID });
    });

    // O dublê de `from` LANÇA; chegar aqui já prova que ninguém o chamou. A
    // asserção explícita é para quem lê o teste, não para o runtime.
    expect(fromMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledTimes(3);
  });

  it("estrutural: o módulo não tem `.from(` de tabela nenhuma", () => {
    const src = readFileSync(
      path.resolve(
        __dirname,
        "../../src/modules/communication/hooks/chat/useSocialLeadLink.ts",
      ),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(src).not.toMatch(/supabase[\s\S]{0,20}\.from\s*\(/);
    // Controle positivo da varredura: as três RPCs ESTÃO lá.
    expect(src).toMatch(/rpc\(\s*\n?\s*"link_social_conversation_to_lead"/);
    expect(src).toMatch(/rpc\(\s*\n?\s*"create_lead_from_social_conversation"/);
    expect(src).toMatch(/rpc\(\s*\n?\s*"unlink_social_conversation_from_lead"/);
  });
});

// ─── 5. a tela reflete o vínculo ─────────────────────────────────────────────

describe("5. depois do vínculo, a tela é invalidada onde o dado mora", () => {
  it("sucesso invalida a lista de conversas, os leads e a ficha", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const spy = vi.spyOn(client, "invalidateQueries");
    const w = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useLinkSocialConversationToLead(CANAL), { wrapper: w });
    await act(async () => {
      await result.current.mutateAsync({ externalUserId: IGSID, leadId: LEAD });
    });

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const chaves = spy.mock.calls.map((c) => JSON.stringify(c[0]));
    // A lista carrega `lead_id`/`lead_name` da RPC: sem invalidá-la, o badge do
    // lead só apareceria no próximo refetch por outro motivo.
    expect(chaves.some((k) => k.includes("socialContacts") || k.includes(CANAL))).toBe(true);
    expect(chaves.some((k) => k.includes("leads"))).toBe(true);
    expect(chaves.some((k) => k.includes("lead_by_id"))).toBe(true);
  });
});
