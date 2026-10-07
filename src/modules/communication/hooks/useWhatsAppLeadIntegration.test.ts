import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React, { type ReactNode } from "react";
import { toAppError } from "@/shared/errors/to-app-error";
import { useCreateLeadFromWhatsApp } from "./useWhatsAppLeadIntegration";

/**
 * Chamado 017c44b0 — "Criar Lead" no chat com telefone que já é lead de outro
 * responsável (escondido pela RLS): o lookup volta vazio, o INSERT colide em
 * `idx_leads_org_phone_unique` e a tela dizia só "Já existe um registro com
 * esses dados".
 */

const lookupResult = vi.fn();
const insertResult = vi.fn();
const insertSpy = vi.fn();

vi.mock("@/integrations/supabase/client", () => {
  const leads = {
    // lookup: select().eq().eq().limit().maybeSingle()
    select: () => {
      const chain: Record<string, unknown> = {};
      chain.eq = () => chain;
      chain.limit = () => chain;
      chain.maybeSingle = () => Promise.resolve(lookupResult());
      // insert(...).select().single() reaproveita `select`
      chain.single = () => Promise.resolve(insertResult());
      return chain;
    },
    insert: (payload: unknown) => {
      insertSpy(payload);
      return leads;
    },
  };
  return { supabase: { from: () => leads } };
});

vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({ data: { id: "tm-1", organization_id: "org-1" } }),
  isVirtualTeamMember: () => false,
}));

vi.mock("@/integrations/supabase/pipeline-entry-rpc", () => ({
  createCustomPipelineEntry: vi.fn(),
  createSystemPipelineEntry: vi.fn(),
  updateSystemPipelineEntry: vi.fn(),
}));

const PHONE_INDEX_ERROR = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "idx_leads_org_phone_unique"',
  details: "Key (organization_id, normalized_phone)=(org-1, 11999990000) already exists.",
  hint: null,
};

function run() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  const { result } = renderHook(() => useCreateLeadFromWhatsApp(), { wrapper });
  return result;
}

async function failureOf(result: ReturnType<typeof run>): Promise<unknown> {
  result.current.mutate({ phone: "11999990000", destination: "none" });
  await waitFor(() => expect(result.current.isError).toBe(true));
  return result.current.error;
}

describe("useCreateLeadFromWhatsApp — telefone de lead invisível", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("23505 em idx_leads_org_phone_unique vira mensagem de lead de outro responsável, sem dado do lead", async () => {
    lookupResult.mockReturnValue({ data: null, error: null });
    insertResult.mockReturnValue({ data: null, error: PHONE_INDEX_ERROR });

    const error = await failureOf(run());
    const app = toAppError(error, "Não foi possível criar o lead.");

    expect(app.userMessage).toMatch(/outro responsável/i);
    expect(app.userMessage).not.toMatch(/Já existe um registro com esses dados/);
    expect(app.userMessage).not.toMatch(/11999990000|org-1/);
    expect(app.reportable).toBe(false);
  });

  it("outro 23505 mantém o comportamento atual (erro cru, mensagem genérica de duplicidade)", async () => {
    const other = {
      code: "23505",
      message: 'duplicate key value violates unique constraint "leads_pkey"',
      details: "",
      hint: null,
    };
    lookupResult.mockReturnValue({ data: null, error: null });
    insertResult.mockReturnValue({ data: null, error: other });

    const error = await failureOf(run());

    expect(error).toBe(other);
    expect(toAppError(error).userMessage).toBe("Já existe um registro com esses dados.");
  });

  it("erro do lookup não é engolido nem vira 'já cadastrado' — e não tenta inserir às cegas", async () => {
    const lookupError = { code: "57014", message: "canceling statement due to statement timeout", details: "", hint: null };
    lookupResult.mockReturnValue({ data: null, error: lookupError });

    const error = await failureOf(run());

    expect(error).toBe(lookupError);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(toAppError(error, "Não foi possível criar o lead.").userMessage).not.toMatch(/outro responsável/i);
  });
});
