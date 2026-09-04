// tests/unit/meta-composer.test.tsx
//
// 🚨 Este arquivo ficou VERMELHO em `main` (04/09) e derrubou o ratchet de toda
// branch que saísse de lá. A causa não foi uma regressão de comportamento: a
// #1977 acrescentou `useCurrentTeamMember()` ao `MetaComposer` — para pôr a org
// no path do upload, que é o que a RLS do bucket `media` lê — e esse hook chama
// `useAuth()`. O teste montava o componente só com `QueryClientProvider`, então
// o render passou a estourar "useAuth must be used within an AuthProvider" e os
// DOIS casos caíram juntos.
//
// Dependência nova de hook num componente exige mock novo no teste dele. É a
// mesma armadilha que já tinha mordido `hooks-sprint2-small.test.ts`: o teste
// não acompanha o import graph sozinho.
//
// De quebra, o caminho que a #1977 corrigiu não tinha teste NENHUM — por isso
// dava para quebrar o composer inteiro sem nada acusar o motivo real. Os casos
// de upload abaixo fecham esse buraco.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mutateAsync = vi.fn();
vi.mock("@/modules/communication/hooks/chat-meta/useMetaSend", () => ({
  useMetaSend: () => ({ mutateAsync, isPending: false }),
}));

/** A org do membro logado — variável, para cobrir o caso sem org. */
let organizationId: string | null = "org-1111";
vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({
    data: organizationId ? { id: "tm-1", organization_id: organizationId } : null,
  }),
}));

const upload = vi.fn();
const getPublicUrl = vi.fn(() => ({ data: { publicUrl: "https://cdn/x.png" } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: (...args: unknown[]) => upload(...args),
        getPublicUrl: (...args: unknown[]) => getPublicUrl(...args),
      }),
    },
  },
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args), success: vi.fn() },
}));

import { MetaComposer } from "@/modules/communication/components/chat-meta/MetaComposer";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const RECENTE = () => new Date(Date.now() - 60_000).toISOString();

/** Dispara o input de arquivo escondido do composer. */
function enviarImagem(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["x"], "foto.png", { type: "image/png" });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("MetaComposer", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    upload.mockReset();
    toastError.mockReset();
    organizationId = "org-1111";
    upload.mockResolvedValue({ data: { path: "meta/org-1111/c1/uuid-foto.png" }, error: null });
  });

  it("sends text on Enter", async () => {
    render(<MetaComposer conversationId="c1" lastInboundAt={RECENTE()} />, { wrapper });
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

  it("põe a ORG no segundo segmento do path — é onde a RLS do bucket procura", async () => {
    // `media_insert_org_scoped` lê `foldername(name)[2]` e exige que seja uma org
    // do usuário. Com a conversa nesse lugar (`meta/<conversationId>/…`) o uuid
    // casava a regex mas nunca pertencia a `get_my_organization_ids()`, e todo
    // vendedor não-master levava violação de RLS no anexo. #1977.
    const { container } = render(
      <MetaComposer conversationId="c1" lastInboundAt={RECENTE()} />,
      { wrapper },
    );

    enviarImagem(container);

    await waitFor(() => expect(upload).toHaveBeenCalled());
    const path = upload.mock.calls[0][0] as string;
    expect(path.split("/")[1]).toBe("org-1111");
    expect(path.startsWith("meta/org-1111/c1/")).toBe(true);
  });

  it("sem org ativa não sobe arquivo — falha antes da rede, com motivo", async () => {
    organizationId = null;
    const { container } = render(
      <MetaComposer conversationId="c1" lastInboundAt={RECENTE()} />,
      { wrapper },
    );

    enviarImagem(container);

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(upload).not.toHaveBeenCalled();
    expect(String(toastError.mock.calls[0][0])).toMatch(/organiza/i);
  });

  it("erro de upload chega ao usuário COM a mensagem do banco", async () => {
    // O "Falha no upload" mudo foi o que escondeu a violação de RLS por meses.
    upload.mockResolvedValue({
      data: null,
      error: { message: "new row violates row-level security policy" },
    });
    const { container } = render(
      <MetaComposer conversationId="c1" lastInboundAt={RECENTE()} />,
      { wrapper },
    );

    enviarImagem(container);

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).toContain("row-level security");
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
