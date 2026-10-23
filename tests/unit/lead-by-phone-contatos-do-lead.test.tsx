/**
 * `useLeadByPhone` resolve o lead de uma conversa pelo número.
 *
 * Chamados 2c4e502c / b9ccde65 (Café Jurerê): o lead guarda UM telefone em
 * `leads.phone`; os demais contatos moram em `lead_phones`. A busca só olhava
 * `leads.normalized_phone`, então abrir a conversa pelo SEGUNDO contato do lead
 * caía em "Criar ou vincular lead" como se o número fosse desconhecido.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createWrapper } from "../helpers/hook-test-utils";

import { fakeSupabaseTables, type FakeTables } from "../helpers/fake-supabase-tables";

let tables: FakeTables = {};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => fakeSupabaseTables(tables).supabase.from(t),
  },
}));
vi.mock("@/modules/identity/org-team/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({ data: { id: "tm1", organization_id: "org-t", role: "admin" } }),
  isVirtualTeamMember: () => false,
  useTeamMembers: () => ({ data: [] }),
}));
vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, session: { access_token: "tok" } }),
}));
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-t", isReady: true, teamMemberId: "tm1" }),
  useRequiredOrganization: () => ({ organizationId: "org-t", teamMemberId: "tm1" }),
}));
vi.mock("@/modules/identity/master/hooks/useMasterAuth", () => ({ useMasterAuth: () => ({ isMaster: false }) }));
vi.mock("@/modules/identity/permissions/lib/permissions", () => ({
  assertIsAdmin: vi.fn(),
  useCanPerformActionAsync: () => ({ data: { allowed: true } }),
}));
vi.mock("@/lib/normalizePhone", () => ({
  normalizePhone: (p: string) => (p ? p.replace(/\D/g, "") : null),
}));

import { useLeadByPhone } from "@/modules/communication/hooks/useWhatsAppLeadIntegration";

const ORG = "org-t";
const lead = (id: string, name: string, normalized_phone: string | null) => ({
  id, name, organization_id: ORG, normalized_phone, deleted_at: null,
});

beforeEach(() => {
  tables = { leads: [], lead_phones: [], pipeline_entries: [], deals: [] };
});

describe("useLeadByPhone — contatos do lead", () => {
  it("acha o lead pelo SEGUNDO contato (só existe em lead_phones)", async () => {
    tables.leads = [lead("lead-1", "Cliente", "19999990000")];
    tables.lead_phones = [{ organization_id: ORG, lead_id: "lead-1", normalized_phone: "1938521276", deleted_at: null }];

    const { result } = renderHook(() => useLeadByPhone("(19) 3852-1276"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.data).toMatchObject({ id: "lead-1", name: "Cliente" }));
  });

  it("número principal de um lead resolve para ele", async () => {
    tables.leads = [lead("lead-9", "Principal", "19991244569")];

    const { result } = renderHook(() => useLeadByPhone("19991244569"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.data).toMatchObject({ id: "lead-9", name: "Principal" }));
  });

  it("ignora lead apagado: nem principal nem contato contam", async () => {
    tables.leads = [{ ...lead("lead-x", "Apagado", "19991244569"), deleted_at: "2026-01-01" }];
    tables.lead_phones = [{ organization_id: ORG, lead_id: "lead-x", normalized_phone: "19991244569", deleted_at: null }];

    const { result } = renderHook(() => useLeadByPhone("19991244569"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isFetched).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("número desconhecido continua devolvendo null", async () => {
    const { result } = renderHook(() => useLeadByPhone("11999990000"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isFetched).toBe(true));
    expect(result.current.data).toBeNull();
  });
});
