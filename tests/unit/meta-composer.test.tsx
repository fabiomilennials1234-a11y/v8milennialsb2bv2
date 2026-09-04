// tests/unit/meta-composer.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mutateAsync = vi.fn();
vi.mock("@/modules/communication/hooks/chat-meta/useMetaSend", () => ({
  useMetaSend: () => ({ mutateAsync, isPending: false }),
}));

/**
 * O composer passou a ler `useCurrentTeamMember`, que desce até `useAuth` e
 * exige o `AuthProvider` — sem ele o componente lança na renderização e os dois
 * testes deste arquivo quebram na montagem, antes de qualquer asserção.
 *
 * O dublê é por SPREAD do módulo real: uma lista de exports faria um export
 * novo do barrel de identidade sumir daqui e o teste passar por ausência.
 */
vi.mock("@/modules/identity", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCurrentTeamMember: () => ({
    data: { id: "tm-1", organization_id: "org-1" },
  }),
}));

import { MetaComposer } from "@/modules/communication/components/chat-meta/MetaComposer";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("MetaComposer", () => {
  beforeEach(() => mutateAsync.mockReset());

  it("sends text on Enter", async () => {
    const recent = new Date(Date.now() - 60_000).toISOString();
    render(<MetaComposer conversationId="c1" lastInboundAt={recent} />, { wrapper });
    const input = screen.getByPlaceholderText(/Escreva sua mensagem/i) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "olá" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mutateAsync).toHaveBeenCalledWith({ conversationId: "c1", text: "olá" });
  });

  it("is disabled outside 24h window", () => {
    const old = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
    render(<MetaComposer conversationId="c1" lastInboundAt={old} />, { wrapper });
    const input = screen.getByPlaceholderText(/Escreva sua mensagem/i) as HTMLTextAreaElement;
    expect(input).toBeDisabled();
  });
});
