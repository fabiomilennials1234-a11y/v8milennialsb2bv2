/**
 * Lista de conversas com hook REAL + loader REAL; só o cliente supabase é
 * dublado. Prende o contrato de rede: 1 RPC + 1 createSignedUrls por janela
 * (inclusive com 300/600 linhas), PGRST202 desliga o loader, 42501 não
 * desliga, cache de assinatura ao remontar, e onError volta ao gradiente.
 */
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";

const sb = vi.hoisted(() => {
  const state = {
    mode: "ok" as "ok" | "absent" | "forbidden",
    rpcCalls: [] as Array<{ p_org: string; p_phones: string[] }>,
    signCalls: [] as string[][],
  };
  const client = {
    rpc: vi.fn(async (_fn: string, args: { p_org: string; p_phones: string[] }) => {
      state.rpcCalls.push(args);
      if (state.mode === "absent") return { data: null, error: { code: "PGRST202", message: "Could not find the function public.avatares_das_conversas(p_org, p_phones) in the schema cache" } };
      if (state.mode === "forbidden") return { data: null, error: { code: "42501", message: "forbidden" } };
      return { data: args.p_phones.map((phone) => ({ phone, storage_path: `org-1/avatars/${phone}.jpg`, content_sha256: "a".repeat(64) })), error: null };
    }),
    storage: {
      from: (_b: string) => ({
        createSignedUrls: vi.fn(async (paths: string[]) => {
          state.signCalls.push(paths);
          return { data: paths.map((path) => ({ path, signedUrl: `https://proj.supabase.co/storage/v1/object/sign/contact-avatars/${path}?token=t`, error: null })), error: null };
        }),
      }),
    },
  };
  return { state, client };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: sb.client }));
vi.mock("@/modules/platform/hooks/useFeatureFlag", () => ({ useFeatureFlag: () => ({ enabled: false }) }));
vi.mock("@/modules/identity", () => ({
  useChatLeadCreation: () => ({ allowed: true, isLoading: false }),
  useCurrentTeamMember: () => ({ data: { organization_id: "org-1" } }),
}));
vi.mock("@/modules/communication/hooks/chat/useNomeCodContatoLead", () => ({
  useNomeCodContatoLead: () => false,
  useContatoDaConversa: () => ({ data: null }),
}));

import { ConversationListItem, type ConversationListItemProps } from "@/modules/communication/components/chat/list/ConversationListItem";
import { contactAvatarLoader } from "@/modules/communication/lib/contactAvatarLoader";
import type { ChatContact } from "@/modules/communication/hooks/chat/types";

beforeAll(() => {
  (globalThis as Record<string, unknown>).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});

let qc: QueryClient;
beforeEach(() => {
  qc = new QueryClient();
  contactAvatarLoader.reset();
  sb.state.mode = "ok"; sb.state.rpcCalls = []; sb.state.signCalls = [];
});

const phoneOf = (i: number) => `55119${String(i).padStart(8, "0")}`;
function contact(i: number, over: Partial<ChatContact> = {}): ChatContact {
  return {
    channel: "whatsapp", instance_id: "inst-1", phone_number: phoneOf(i), push_name: `Maria ${i}`,
    last_message: "oi", last_message_time: "2026-07-23T00:00:00Z", last_message_direction: "incoming",
    last_message_sent_source: "manual", unread_count: 0, lead_id: null, lead_name: null,
    conversation_id: `conv-${i}`, archived_at: null, tags: [], is_group: false, funnels: [], qualification_tier: null,
    ...over,
  } as ChatContact;
}
const props = (c: ChatContact): ConversationListItemProps => ({
  contact: c, isSelected: false, onSelect: vi.fn(), activeTab: "active", isAdmin: false,
  instanceId: "inst-1", organizationId: "org-1", allTags: [], onArchive: vi.fn(), onUnarchive: vi.fn(),
  onDelete: vi.fn(), onAddTag: vi.fn(), onRemoveTag: vi.fn(),
});
function List({ from, to, over }: { from: number; to: number; over?: Partial<ChatContact> }) {
  const items = [];
  for (let i = from; i < to; i++) items.push(<ConversationListItem key={i} {...props(contact(i, over))} />);
  return <QueryClientProvider client={qc}><TooltipProvider>{items}</TooltipProvider></QueryClientProvider>;
}
const fotos = (el: HTMLElement) => el.querySelectorAll<HTMLImageElement>('img[src*="contact-avatars"]');

describe("ConversationListItem + loader real", () => {
  it("URL → img aparece por cima do gradiente; onError → img some, inicial fica", async () => {
    const { container, getAllByText } = render(<List from={0} to={1} />);
    await waitFor(() => expect(fotos(container)).toHaveLength(1));
    const img = fotos(container)[0];
    expect(img.src).toContain(`org-1/avatars/${phoneOf(0)}.jpg`);
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    fireEvent.error(img);
    expect(fotos(container)).toHaveLength(0);
    expect(getAllByText("M").length).toBeGreaterThan(0);
  });

  it("PGRST202: gradiente, 1 RPC, 0 assinatura; montar mais linhas NÃO chama de novo", async () => {
    sb.state.mode = "absent";
    const errSpy = vi.spyOn(console, "error");
    const a = render(<List from={0} to={20} />);
    await waitFor(() => expect(sb.state.rpcCalls).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 60));
    expect(fotos(a.container)).toHaveLength(0);
    expect(sb.state.signCalls).toHaveLength(0);
    const b = render(<List from={20} to={60} />);
    await new Promise((r) => setTimeout(r, 80));
    expect(sb.state.rpcCalls).toHaveLength(1);
    expect(fotos(b.container)).toHaveLength(0);
    // refetch manual (staleTime vencido / invalidate) também não sai para a rede
    await act(async () => { await qc.invalidateQueries({ queryKey: ["contact-avatar"] }); });
    await new Promise((r) => setTimeout(r, 60));
    expect(sb.state.rpcCalls).toHaveLength(1);
    expect(errSpy.mock.calls.filter((c) => String(c[0]).includes("avatar"))).toEqual([]);
    errSpy.mockRestore();
  });

  it("42501: gradiente sem desligar o loader (janela seguinte chama de novo)", async () => {
    sb.state.mode = "forbidden";
    const a = render(<List from={0} to={3} />);
    await waitFor(() => expect(sb.state.rpcCalls).toHaveLength(1));
    render(<List from={3} to={6} />);
    await waitFor(() => expect(sb.state.rpcCalls).toHaveLength(2));
    expect(fotos(a.container)).toHaveLength(0);
  });

  it("grupo e canal social: nenhuma RPC", async () => {
    render(<List from={0} to={5} over={{ is_group: true }} />);
    render(<List from={5} to={10} over={{ channel: "instagram", external_user_id: "1784000000000123" } as Partial<ChatContact>} />);
    await new Promise((r) => setTimeout(r, 60));
    expect(sb.state.rpcCalls).toHaveLength(0);
  });
});

describe("contagem de rede por janela", () => {
  it("300 linhas no mesmo frame: 1 RPC (300 telefones) + 1 createSignedUrls (300 paths)", async () => {
    const { container } = render(<List from={0} to={300} />);
    await waitFor(() => expect(fotos(container)).toHaveLength(300), { timeout: 10000 });
    expect(sb.state.rpcCalls).toHaveLength(1);
    expect(sb.state.rpcCalls[0].p_phones).toHaveLength(300);
    expect(sb.state.signCalls).toHaveLength(1);
    expect(sb.state.signCalls[0]).toHaveLength(300);
  });

  it("remontar a lista (mesmo QueryClient): 0 chamadas novas", async () => {
    const first = render(<List from={0} to={300} />);
    await waitFor(() => expect(fotos(first.container)).toHaveLength(300), { timeout: 10000 });
    first.unmount();
    const second = render(<List from={0} to={300} />);
    await new Promise((r) => setTimeout(r, 80));
    expect(fotos(second.container)).toHaveLength(300);
    expect(sb.state.rpcCalls).toHaveLength(1);
    expect(sb.state.signCalls).toHaveLength(1);
  });

  it("QueryClient novo (ex.: recarregou o cache do react-query) mas loader vivo: RPC de novo, assinatura do cache (0)", async () => {
    const first = render(<List from={0} to={50} />);
    await waitFor(() => expect(fotos(first.container)).toHaveLength(50));
    first.unmount();
    qc = new QueryClient();
    const second = render(<List from={0} to={50} />);
    await waitFor(() => expect(fotos(second.container)).toHaveLength(50));
    expect(sb.state.rpcCalls).toHaveLength(2);
    expect(sb.state.signCalls).toHaveLength(1);
  });

  it("600 linhas: 2 RPC (500+100) + 1 assinatura", async () => {
    const { container } = render(<List from={0} to={600} />);
    await waitFor(() => expect(fotos(container)).toHaveLength(600), { timeout: 20000 });
    expect(sb.state.rpcCalls.map((c) => c.p_phones.length)).toEqual([500, 100]);
    expect(sb.state.signCalls).toHaveLength(1);
  }, 30000);

  it("duas janelas (scroll): 2 RPC + 2 assinaturas, sem repetir telefone", async () => {
    render(<List from={0} to={150} />);
    await waitFor(() => expect(sb.state.signCalls).toHaveLength(1));
    render(<List from={150} to={300} />);
    await waitFor(() => expect(sb.state.signCalls).toHaveLength(2));
    expect(sb.state.rpcCalls).toHaveLength(2);
    const all = sb.state.rpcCalls.flatMap((c) => c.p_phones);
    expect(new Set(all).size).toBe(all.length);
  });
});
