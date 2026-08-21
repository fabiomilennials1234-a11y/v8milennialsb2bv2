/**
 * O envio pelo Direct morreu em produção com a palavra "Forbidden" na tela, e
 * nenhuma das duas metades desse sintoma era o que parecia.
 *
 * Medido em prod (`function_edge_logs`, 2026-08-17): 2 POST em
 * `notificame-send-social`, os DOIS com status **400** — nenhum 403, nenhum 200.
 * A cadeia inteira:
 *
 *   1. este hook invocava SEM `organization_id` no corpo;
 *   2. a função usa `requireAuth({ requireOrganization: true })`, que recusa a
 *      chamada com `AuthError(…, 400)` em vez de cair no fallback legado;
 *   3. `authErrorResponse` rotula QUALQUER status ≠ 401 como `error: "Forbidden"`
 *      e guarda o motivo humano em `message`;
 *   4. `readInvokeError` lia só `error` — e o toast dizia "Forbidden".
 *
 * Os dois testes abaixo prendem as duas metades. O primeiro é a causa; o segundo
 * é a razão de a causa ter sido invisível por um dia. Sem o segundo, o próximo
 * `AuthError` volta a chegar ao vendedor como uma palavra em inglês sem sujeito.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invokeMock(...a) } },
}));

const teamMemberMock = vi.fn();
vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => teamMemberMock(),
}));

import { useSendSocialMessage, SocialSendError } from "./useSendSocialMessage";

const ORG = "6030520a-2ca7-477d-be89-55758e2cd808";
const CANAL = "52b532e1-a994-417d-a9a0-2c50b61afeaf";
const IGSID = "17841400000000000";

const newQc = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

/** O erro de `functions.invoke`: o corpo real vive em `.context`, não na mensagem. */
const invokeError = (body: unknown) => ({
  data: null,
  error: { message: "Edge Function returned a non-2xx status code", context: { json: async () => body } },
});

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ data: { message: { message_id: "m1", status: "sent" } }, error: null });
  teamMemberMock.mockReset();
  teamMemberMock.mockReturnValue({ data: { organization_id: ORG } });
});

describe("useSendSocialMessage — a org viaja no corpo", () => {
  it("manda organization_id no envio de texto", async () => {
    const { result } = renderHook(() => useSendSocialMessage(CANAL), { wrapper: wrap(newQc()) });

    await result.current.mutateAsync({ contactExternalId: IGSID, text: "oi" });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [fn, opts] = invokeMock.mock.calls[0];
    expect(fn).toBe("notificame-send-social");
    expect(opts.body).toMatchObject({
      organization_id: ORG,
      messaging_channel_id: CANAL,
      to: IGSID,
      text: "oi",
    });
  });

  it("manda organization_id também no envio de mídia", async () => {
    const { result } = renderHook(() => useSendSocialMessage(CANAL), { wrapper: wrap(newQc()) });

    await result.current.mutateAsync({
      contactExternalId: IGSID,
      media: { type: "audio", url: "https://exemplo.test/a.ogg" },
    });

    expect(invokeMock.mock.calls[0][1].body).toMatchObject({ organization_id: ORG });
  });

  it("não chama a função quando a org ainda não resolveu — o 400 seria idêntico", async () => {
    teamMemberMock.mockReturnValue({ data: null });
    const { result } = renderHook(() => useSendSocialMessage(CANAL), { wrapper: wrap(newQc()) });

    await expect(
      result.current.mutateAsync({ contactExternalId: IGSID, text: "oi" }),
    ).rejects.toBeInstanceOf(SocialSendError);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("useSendSocialMessage — a recusa sobe legível", () => {
  it("prefere `message` quando o corpo traz o rótulo 'Forbidden' em `error`", async () => {
    // Corpo EXATO de `authErrorResponse` (`_shared/user-auth.ts`): sem `code`, com
    // a categoria em `error` e o motivo em `message`.
    invokeMock.mockResolvedValue(
      invokeError({
        success: false,
        error: "Forbidden",
        message: "Você não pertence a esta organização",
      }),
    );
    const { result } = renderHook(() => useSendSocialMessage(CANAL), { wrapper: wrap(newQc()) });

    await expect(
      result.current.mutateAsync({ contactExternalId: IGSID, text: "oi" }),
    ).rejects.toMatchObject({ message: "Você não pertence a esta organização" });
  });

  it("mantém a mensagem da função quando ela vem com `code` próprio", async () => {
    invokeMock.mockResolvedValue(
      invokeError({ error: "Recurso não habilitado", code: "feature_disabled" }),
    );
    const { result } = renderHook(() => useSendSocialMessage(CANAL), { wrapper: wrap(newQc()) });

    await expect(
      result.current.mutateAsync({ contactExternalId: IGSID, text: "oi" }),
    ).rejects.toMatchObject({ code: "feature_disabled", message: "Recurso não habilitado" });
  });

  it("preserva o texto cru do fornecedor em `detail`", async () => {
    invokeMock.mockResolvedValue(
      invokeError({
        error: "Não foi possível enviar",
        code: "send_failed",
        detail: "outside the 24 hour window",
      }),
    );
    const { result } = renderHook(() => useSendSocialMessage(CANAL), { wrapper: wrap(newQc()) });

    await waitFor(async () => {
      await expect(
        result.current.mutateAsync({ contactExternalId: IGSID, text: "oi" }),
      ).rejects.toMatchObject({ code: "send_failed", detail: "outside the 24 hour window" });
    });
  });
});
