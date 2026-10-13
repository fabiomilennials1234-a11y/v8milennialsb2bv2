import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { addErrorReporter } from "@/shared/errors";
import { RIOFIX_ORG_ID } from "../../../lib/negocioNoChat";
import { DEFAULT_INBOX_FILTER } from "../../../lib/inboxFilter";
import { batchContact } from "../../../../../../tests/helpers/conversationBatch";
import { ConversationList } from "./ConversationList";

const api = vi.hoisted(() => ({ upsert: vi.fn(), update: vi.fn(), eq: vi.fn(), rpc: vi.fn(), single: vi.fn(), org: "36971ff5-fd73-4f30-a733-04bf8c90e5b6" }));
vi.mock("@/modules/identity", () => ({ useCurrentTeamMember: () => ({ data: { organization_id: api.org } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: () => ({
    upsert: (row: unknown) => { api.upsert(row); return { select: () => ({ single: api.single }) }; },
    update: (row: unknown) => {
      api.update(row);
      const query = { eq: (key: string, value: string) => { api.eq(key, value); return query; }, is: () => query, select: () => ({ single: api.single }) };
      return query;
    },
  }),
  rpc: api.rpc,
} }));
// Flags de nome da linha (`chat_nome_do_lead`, …) leem a org via AuthProvider,
// que este teste não monta. Desligadas: a linha usa o nome de sempre.
vi.mock("@/modules/platform/hooks/useFeatureFlag", () => ({ useFeatureFlag: () => ({ enabled: false }) }));
vi.mock("@/shared/hooks/use-viewport", () => ({ useViewport: () => ({ isMobile: false }) }));

const contacts = [batchContact("5511999999999"), batchContact("5521999999999", "box-b")];
function Harness({ org = RIOFIX_ORG_ID, admin = true, archived = false }: { org?: string; admin?: boolean; archived?: boolean }) {
  const [search, setSearch] = useState("");
  const rows = archived ? contacts.map((c, i) => ({ ...c, archived_at: "2026-10-05T12:00:00Z", conversation_id: `historical-${i}` })) : contacts;
  return <ConversationList contacts={rows} selectedKey={null} onSelectContact={vi.fn()}
    searchQuery={search} onSearchChange={setSearch} isLoading={false} activeTab={archived ? "archived" : "active"} onTabChange={vi.fn()}
    onArchive={vi.fn()} onUnarchive={vi.fn()} onDelete={vi.fn()} isAdmin={admin} organizationId={org}
    instanceId="currently-open-other-box" marcadas={["box-a", "box-b"]} allTags={[]}
    onAddTag={vi.fn()} onRemoveTag={vi.fn()} filter={DEFAULT_INBOX_FILTER} patch={vi.fn()} toggleMulti={vi.fn()}
    clearFilter={vi.fn()} funnelOptions={[]} vendorOptions={[]} resolveContactVendorId={() => null}
    currentTeamMemberId={null} canSeeUnassigned={true} waitingHumanCount={0} filterGate="ok" onRetryEnrichment={vi.fn()} />;
}
function setup(props = {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const view = render(<QueryClientProvider client={client}><TooltipProvider><Harness {...props} /></TooltipProvider></QueryClientProvider>);
  return { ...view, invalidate, user: userEvent.setup() };
}

beforeEach(() => {
  vi.clearAllMocks(); api.org = RIOFIX_ORG_ID;
  api.single.mockResolvedValue({ data: { id: "saved" }, error: null });
  api.rpc.mockResolvedValue({ data: "deleted", error: null });
});
afterEach(cleanup);

describe("Riofix bulk controls in the real conversation list", () => {
  it("is absent for other organizations", () => {
    setup({ org: "other" });
    expect(screen.queryByRole("button", { name: "Selecionar conversas" })).not.toBeInTheDocument();
  });
  it("archives only checked rows using their own box; refreshes once per query family", async () => {
    const { user, invalidate } = setup();
    await user.click(screen.getByRole("button", { name: "Selecionar conversas" }));
    await user.click(screen.getByRole("checkbox", { name: "Selecionar 5521999999999" }));
    await user.click(screen.getByRole("button", { name: "Arquivar" }));
    await waitFor(() => expect(api.upsert).toHaveBeenCalledTimes(1));
    expect(api.upsert).toHaveBeenCalledWith(expect.objectContaining({ organization_id: RIOFIX_ORG_ID, instance_id: "box-b", phone_number: "5521999999999" }));
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
  it("selects all displayed rows and clears selection when search changes", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Selecionar conversas" }));
    await user.click(screen.getByRole("checkbox", { name: "Selecionar todas as conversas exibidas" }));
    expect(screen.getByRole("status")).toHaveTextContent("2 selecionadas");
    await user.type(screen.getByPlaceholderText("Buscar conversa..."), "5511");
    expect(screen.queryByRole("button", { name: "Arquivar" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Selecionar conversas" }));
    await user.click(screen.getByRole("checkbox", { name: "Selecionar todas as conversas exibidas" }));
    expect(screen.getByRole("status")).toHaveTextContent("1 selecionadas");
  });
  it("shows deletion only to admins and requires confirmation", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Selecionar conversas" }));
    await user.click(screen.getByRole("checkbox", { name: "Selecionar 5511999999999" }));
    await user.click(screen.getByRole("button", { name: "Excluir" }));
    expect(api.rpc).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Excluir 1 conversa?");
    await user.click(screen.getByRole("button", { name: "Excluir conversas" }));
    await waitFor(() => expect(api.rpc).toHaveBeenCalledWith("soft_delete_whatsapp_conversation", {
      p_organization_id: RIOFIX_ORG_ID, p_instance_id: "box-a", p_phone_number: "5511999999999",
    }));
  });
  it("members cannot see the bulk delete control", async () => {
    const { user } = setup({ admin: false });
    await user.click(screen.getByRole("button", { name: "Selecionar conversas" }));
    expect(screen.queryByRole("button", { name: "Excluir" })).not.toBeInTheDocument();
  });
  it("unarchives the exact metadata id, including retired instances of the same line", async () => {
    const { user } = setup({ archived: true });
    await user.click(screen.getByRole("button", { name: "Selecionar conversas" }));
    await user.click(screen.getByRole("checkbox", { name: "Selecionar 5511999999999" }));
    await user.click(screen.getByRole("button", { name: "Desarquivar" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith({ archived_at: null }));
    expect(api.eq.mock.calls).toEqual([["organization_id", RIOFIX_ORG_ID], ["id", "historical-0"]]);
  });
  it("rejects a stale organization before submitting any row", async () => {
    api.org = "other";
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Selecionar conversas" }));
    await user.click(screen.getByRole("checkbox", { name: "Selecionar 5511999999999" }));
    await user.click(screen.getByRole("button", { name: "Arquivar" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Arquivar" })).not.toBeDisabled());
    expect(api.upsert).not.toHaveBeenCalled();
  });
  it("keeps failed rows checked for retry and locks repeated clicks while pending", async () => {
    const report = vi.fn();
    const unregister = addErrorReporter(report);
    let finish!: (value: unknown) => void;
    api.single.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    api.single.mockResolvedValueOnce({ error: new Error("network") });
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Selecionar conversas" }));
    await user.click(screen.getByRole("checkbox", { name: "Selecionar todas as conversas exibidas" }));
    await user.click(screen.getByRole("button", { name: "Arquivar" }));
    expect(screen.getByRole("button", { name: "Arquivar" })).toBeDisabled();
    await act(async () => finish({ data: { id: "a" }, error: null }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 selecionadas"));
    expect(screen.getByRole("checkbox", { name: "Selecionar 5521999999999" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Selecionar 5511999999999" })).not.toBeChecked();
    expect(report).toHaveBeenCalledTimes(1);
    unregister();
  });
});
