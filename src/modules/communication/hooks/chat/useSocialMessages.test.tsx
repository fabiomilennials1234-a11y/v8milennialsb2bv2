/**
 * A THREAD das caixas que leem `channel_messages`.
 *
 * O que este arquivo guarda é a COLUNA. Ler pela coluna errada é literalmente o
 * defeito de 18/08: a mensagem do canal oficial entrou correta no banco, com
 * `instance_id` preenchido e `messaging_channel_id` NULO, e o chat procurava por
 * `messaging_channel_id`. Nada quebrou, nada logou — a conversa simplesmente não
 * existia na tela, que para o vendedor é indistinguível de "o cliente não
 * respondeu".
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/** Registra cada `.eq(coluna, valor)` da cadeia do PostgREST. */
const eqCalls: Array<[string, unknown]> = [];
const fromMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  Object.assign(builder, {
    select: vi.fn(chain),
    eq: vi.fn((col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return builder;
    }),
    order: vi.fn(chain),
    limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
  });
  return {
    supabase: {
      from: (t: string) => {
        fromMock(t);
        return builder;
      },
    },
  };
});

const teamMemberMock = vi.fn();
vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => teamMemberMock(),
}));

import { useSocialMessages } from "./useSocialMessages";
import type { SocialContact } from "./types";

const ORG = "38f3bea4-44c6-4732-bb20-065f547a7ed8";
const INSTANCIA = "7312692e-b9b4-4f90-aba3-09cff992bbfc";
const CANAL_SOCIAL = "11111111-1111-1111-1111-111111111111";

function contato(over: Partial<SocialContact>): SocialContact {
  return {
    channel: "instagram",
    conversation_key: "k",
    messaging_channel_id: CANAL_SOCIAL,
    external_user_id: "17841400000000000",
    handle: null,
    display_name: null,
    avatar_url: null,
    last_message: null,
    last_message_time: "2026-08-18T19:03:28+00:00",
    last_message_direction: "incoming",
    unread_count: 0,
    lead_id: null,
    lead_name: null,
    tags: [],
    ...over,
  } as SocialContact;
}

const newQc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrap = (qc: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );

beforeEach(() => {
  eqCalls.length = 0;
  fromMock.mockReset();
  teamMemberMock.mockReset();
  teamMemberMock.mockReturnValue({ data: { organization_id: ORG } });
});

describe("useSocialMessages — a coluna do eixo", () => {
  it("Instagram lê por messaging_channel_id", async () => {
    const { result } = renderHook(() => useSocialMessages(contato({})), {
      wrapper: wrap(newQc()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fromMock).toHaveBeenCalledWith("channel_messages");
    expect(eqCalls).toContainEqual(["messaging_channel_id", CANAL_SOCIAL]);
    expect(eqCalls.map(([c]) => c)).not.toContain("instance_id");
  });

  it("canal oficial lê por instance_id — a coluna que o inbound dele preenche", async () => {
    const { result } = renderHook(
      () =>
        useSocialMessages(
          contato({
            channel: "whatsapp_oficial",
            messaging_channel_id: INSTANCIA,
            external_user_id: "554884334050",
          }),
        ),
      { wrapper: wrap(newQc()) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(eqCalls).toContainEqual(["instance_id", INSTANCIA]);
    // A coluna do Instagram é NULA nas linhas desta caixa: filtrar por ela aqui
    // devolveria zero mensagem para sempre, em silêncio.
    expect(eqCalls.map(([c]) => c)).not.toContain("messaging_channel_id");
  });

  it("as duas caixas continuam recortando por organização", async () => {
    const { result } = renderHook(
      () => useSocialMessages(contato({ channel: "whatsapp_oficial" })),
      { wrapper: wrap(newQc()) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(eqCalls).toContainEqual(["organization_id", ORG]);
  });

  it("sem contato não consulta nada", async () => {
    renderHook(() => useSocialMessages(null), { wrapper: wrap(newQc()) });

    await new Promise((r) => setTimeout(r, 10));
    expect(fromMock).not.toHaveBeenCalled();
  });
});
