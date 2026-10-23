import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React, { type ReactNode } from "react";
import { fakeSupabaseTables, type FakeTables } from "../../../../tests/helpers/fake-supabase-tables";
import { useLeadByPhone } from "./useWhatsAppLeadIntegration";

/**
 * Chamados 99067f13 / 33c5fd52 — número em 2+ leads vivos: a tela abre o lead
 * com negócio aberto, ou nenhum. Nunca "o primeiro" que o banco devolver.
 */

const ORG = "org-1";
const PHONE = "48999990000";
let tables: FakeTables = {};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => fakeSupabaseTables(tables).supabase.from(t) },
}));
vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({ data: { id: "tm-1", organization_id: "org-1" } }),
  isVirtualTeamMember: () => false,
}));
vi.mock("@/integrations/supabase/pipeline-entry-rpc", () => ({
  createCustomPipelineEntry: vi.fn(),
  createSystemPipelineEntry: vi.fn(),
  updateSystemPipelineEntry: vi.fn(),
}));

const lead = (id: string, normalized_phone: string | null) => ({
  id, organization_id: ORG, normalized_phone, deleted_at: null, name: id,
});
const phones = [
  { organization_id: ORG, lead_id: "L-B", normalized_phone: PHONE, deleted_at: null },
];
const openDeal = (leadId: string) => ({
  deals: [{ id: "D1", organization_id: ORG, source_lead_id: leadId, created_at: "2026-05-01", closed_at: null, deleted_at: null }],
});

function run(opts?: { preferredLeadId?: string | null }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return renderHook(() => useLeadByPhone(PHONE, opts), { wrapper });
}

describe("useLeadByPhone", () => {
  beforeEach(() => {
    tables = {};
  });

  it("um lead vivo no número: abre esse lead (não regride)", async () => {
    tables = { leads: [lead("L-A", PHONE)], lead_phones: [], deals: [] };
    const { result } = run();
    await waitFor(() => expect(result.current.data).toMatchObject({ id: "L-A" }));
  });

  it("2 leads, o secundário com negócio aberto: abre o secundário, em qualquer ordem das linhas", async () => {
    for (const leads of [[lead("L-A", PHONE), lead("L-B", null)], [lead("L-B", null), lead("L-A", PHONE)]]) {
      tables = { leads, lead_phones: phones, ...openDeal("L-B") };
      const { result } = run();
      await waitFor(() => expect(result.current.data).toMatchObject({ id: "L-B" }));
    }
  });

  it("2 leads sem negócio aberto: nenhum lead", async () => {
    tables = { leads: [lead("L-A", PHONE), lead("L-B", null)], lead_phones: phones, deals: [] };
    const { result } = run();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("leadId preferido do deep link vence nos 2 leads sem negócio aberto", async () => {
    tables = { leads: [lead("L-A", PHONE), lead("L-B", null)], lead_phones: phones, deals: [] };
    const { result } = run({ preferredLeadId: "L-B" });
    await waitFor(() => expect(result.current.data).toMatchObject({ id: "L-B" }));
  });
});
