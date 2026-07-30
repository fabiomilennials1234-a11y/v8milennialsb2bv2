import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import React, { type ReactNode } from "react";

const rows = [
  { tc_session_id: "tc-1", name: "Comercial", jid: "5548...", status: "open", whatsapp_instance_id: "i-1" },
  { tc_session_id: "tc-2", name: "Suporte", jid: null, status: "pending", whatsapp_instance_id: "i-2" },
];

let orgRow: { voice_sessions_cap: number } | null = { voice_sessions_cap: 4 };

// `voip_sessions` termina em `.order()`; `organizations` termina em
// `.maybeSingle()`. Um mock único não serve para os dois encadeamentos.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "organizations") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: orgRow, error: null }) }) }),
        };
      }
      return {
        select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }) }),
      };
    },
  },
}));

vi.mock("@/modules/identity", () => ({ useOrganization: () => ({ organizationId: "org-1" }) }));

import { useVoipSessions, useVoiceSessionsCap } from "./useVoipSessions";

// JSX exige extensão .tsx neste projeto (parser oxc do Vite rejeita `<Tag>`
// em `.ts`); createElement mantém o arquivo `.ts` como o brief especifica.
const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
};

describe("useVoipSessions", () => {
  it("devolve TODAS as sessões, não só a aberta", async () => {
    const { result } = renderHook(() => useVoipSessions(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.map((s) => s.status)).toEqual(["open", "pending"]);
  });

  it("expõe a instância de cada sessão, que é como a tela casa número e voz", async () => {
    const { result } = renderHook(() => useVoipSessions(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].whatsappInstanceId).toBe("i-1");
  });
});

describe("useVoiceSessionsCap", () => {
  it("lê o teto da organização", async () => {
    orgRow = { voice_sessions_cap: 4 };
    const { result } = renderHook(() => useVoiceSessionsCap(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(4);
  });

  it("cai no padrão 10 quando não acha a linha, e não em zero", async () => {
    // Zero trancaria a tela inteira por causa de uma leitura que falhou.
    orgRow = null;
    const { result } = renderHook(() => useVoiceSessionsCap(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(10);
  });
});
