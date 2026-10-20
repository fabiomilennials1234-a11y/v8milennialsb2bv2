/**
 * Keystone do Chamado 33c5fd52 · PR6, pela tela: criar contato SEM lead e SEM
 * empresa, vincular a 2 leads, editar, excluir.
 *
 * O banco é um fake em memória que imita as RPCs (contact_list/create/update/
 * delete, lead_contact_link/unlink); a regra real (RLS, autorização) é coberta
 * por supabase/tests/contatos_crud_test.sql. Aqui se prova a ligação da tela:
 * argumentos das RPCs, o que a lista mostra depois de cada gesto.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeContact {
  id: string;
  name: string;
  email: string | null;
  job_title: string | null;
  phones: { id: string; phone: string; label: string | null; is_primary: boolean }[];
  links: { lead_id: string; papel: string | null }[];
}

const LEADS = [
  { id: "l1", name: "Padaria Alfa" },
  { id: "l2", name: "Padaria Beta" },
  { id: "l3", name: "Mercado Gama" },
];

const db = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), contacts: [] as unknown[] }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => db.rpc(...args),
    from: (...args: unknown[]) => db.from(...args),
  },
}));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1" }),
}));

import Contatos from "./Contatos";

function installFakeDb() {
  let seq = 0;
  const store = db.contacts as FakeContact[];
  store.length = 0;

  db.rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    switch (fn) {
      case "contact_list": {
        const q = String(args.p_search ?? "").toLowerCase();
        const rows = store
          .filter((c) => !q || c.name.toLowerCase().includes(q))
          .map((c) => ({
            id: c.id,
            organization_id: "org-1",
            name: c.name,
            email: c.email,
            job_title: c.job_title,
            created_at: "2026-10-19T00:00:00Z",
            updated_at: "2026-10-19T00:00:00Z",
            phones: c.phones,
            leads: c.links.map((l) => ({
              lead_id: l.lead_id,
              name: LEADS.find((x) => x.id === l.lead_id)?.name ?? "?",
              papel: l.papel,
            })),
          }));
        return { data: { total: rows.length, rows }, error: null };
      }
      case "contact_create": {
        const id = `c${++seq}`;
        const phones = (args.p_phones as { phone: string; label: string | null; is_primary: boolean }[]).map(
          (p, i) => ({ id: `${id}p${i}`, ...p }),
        );
        store.push({
          id,
          name: String(args.p_name),
          email: (args.p_email as string | undefined) ?? null,
          job_title: (args.p_job_title as string | undefined) ?? null,
          phones,
          links: ((args.p_lead_ids as string[]) ?? []).map((lead_id) => ({ lead_id, papel: null })),
        });
        return { data: id, error: null };
      }
      case "contact_update": {
        const c = store.find((x) => x.id === args.p_contact_id);
        if (!c) return { data: null, error: { code: "PT404", message: "Contato não encontrado." } };
        c.name = String(args.p_name);
        c.email = (args.p_email as string | undefined) ?? null;
        c.job_title = (args.p_job_title as string | undefined) ?? null;
        c.phones = (args.p_phones as { phone: string; label: string | null; is_primary: boolean }[]).map(
          (p, i) => ({ id: `${c.id}p${i}`, ...p }),
        );
        return { data: c.id, error: null };
      }
      case "contact_delete": {
        const i = store.findIndex((x) => x.id === args.p_contact_id);
        if (i < 0) return { data: null, error: { code: "PT404", message: "Contato não encontrado." } };
        store.splice(i, 1);
        return { data: args.p_contact_id, error: null };
      }
      case "lead_contact_link": {
        const c = store.find((x) => x.id === args.p_contact_id);
        if (!c) return { data: null, error: { code: "PT404", message: "Contato não encontrado." } };
        if (!c.links.some((l) => l.lead_id === args.p_lead_id)) {
          c.links.push({ lead_id: String(args.p_lead_id), papel: (args.p_papel as string | undefined) ?? null });
        }
        return { data: c.id, error: null };
      }
      case "lead_contact_unlink": {
        const c = store.find((x) => x.id === args.p_contact_id);
        if (c) c.links = c.links.filter((l) => l.lead_id !== args.p_lead_id);
        return { data: args.p_contact_id, error: null };
      }
      default:
        return { data: null, error: { code: "42883", message: `rpc ${fn}` } };
    }
  });

  db.from = vi.fn((table: string) => {
    expect(table).toBe("leads");
    let term = "";
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "order"]) q[m] = vi.fn(() => q);
    q.ilike = vi.fn((_col: string, pattern: string) => {
      term = pattern.replace(/^%|%$/g, "").toLowerCase();
      return q;
    });
    q.limit = vi.fn(async () => ({
      data: LEADS.filter((l) => l.name.toLowerCase().includes(term)),
      error: null,
    }));
    return q;
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Contatos />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  installFakeDb();
});

describe("Contatos — keystone", () => {
  it("cria sem lead e sem empresa, vincula a 2 leads, edita e exclui", async () => {
    const user = userEvent.setup();
    renderPage();

    // Vazio: o convite diz que não precisa de lead nem de empresa.
    expect(await screen.findByText("Nenhum contato ainda")).toBeInTheDocument();

    // 1. Criar SÓ com nome (sem lead, sem empresa).
    await user.click(screen.getAllByRole("button", { name: /novo contato/i })[0]);
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Nome"), "Maria Compras");
    await user.type(within(dialog).getByLabelText("Telefone 1"), "(48) 99999-1111");
    await user.click(within(dialog).getByRole("button", { name: "Criar contato" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(db.rpc).toHaveBeenCalledWith("contact_create", {
      p_org: "org-1",
      p_name: "Maria Compras",
      p_email: undefined,
      p_job_title: undefined,
      p_phones: [{ phone: "(48) 99999-1111", label: null, is_primary: true }],
      p_lead_ids: [],
    });
    const linha = (await screen.findByText("Maria Compras")).closest("tr") as HTMLElement;
    expect(within(linha).getByText("Sem lead")).toBeInTheDocument();

    // 2. Editar: vincular a 2 leads (cada vínculo grava na hora).
    await user.click(within(linha).getByRole("button", { name: "Editar Maria Compras" }));
    const edit = await screen.findByRole("dialog");
    for (const [busca, lead] of [["alfa", "Padaria Alfa"], ["beta", "Padaria Beta"]] as const) {
      await user.type(within(edit).getByLabelText("Buscar lead para vincular"), busca);
      await user.click(await within(edit).findByRole("button", { name: new RegExp(lead) }));
    }
    await waitFor(() =>
      expect(db.rpc).toHaveBeenCalledWith("lead_contact_link", { p_lead_id: "l2", p_contact_id: "c1", p_papel: undefined }),
    );
    expect(db.rpc).toHaveBeenCalledWith("lead_contact_link", { p_lead_id: "l1", p_contact_id: "c1", p_papel: undefined });
    await waitFor(() => expect(within(edit).getByLabelText("Desvincular Padaria Beta")).toBeInTheDocument());

    // 3. Editar dados e salvar.
    const nome = within(edit).getByLabelText("Nome");
    await user.clear(nome);
    await user.type(nome, "Maria Silva");
    await user.click(within(edit).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const linha2 = (await screen.findByText("Maria Silva")).closest("tr") as HTMLElement;
    expect(within(linha2).getByText("Padaria Alfa +1")).toBeInTheDocument();

    // 4. Excluir.
    await user.click(within(linha2).getByRole("button", { name: "Excluir Maria Silva" }));
    const confirmar = await screen.findByRole("alertdialog");
    expect(within(confirmar).getByText(/desvinculado de 2 leads/)).toBeInTheDocument();
    await user.click(within(confirmar).getByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(db.rpc).toHaveBeenCalledWith("contact_delete", { p_contact_id: "c1" }));
    expect(await screen.findByText("Nenhum contato ainda")).toBeInTheDocument();
  }, 30_000);

  it("nome em branco não chega ao banco", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole("button", { name: /novo contato/i }))[0]);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Criar contato" }));
    expect(await within(dialog).findByText("Informe o nome do contato.")).toBeInTheDocument();
    expect(db.rpc).not.toHaveBeenCalledWith("contact_create", expect.anything());
  }, 30_000);

  it("na criação os leads escolhidos vão junto com o contato", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole("button", { name: /novo contato/i }))[0]);
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Nome"), "Ana");
    await user.type(within(dialog).getByLabelText("Buscar lead para vincular"), "gama");
    await user.click(await within(dialog).findByRole("button", { name: /Mercado Gama/ }));
    await user.click(within(dialog).getByRole("button", { name: "Criar contato" }));
    await waitFor(() =>
      expect(db.rpc).toHaveBeenCalledWith("contact_create", expect.objectContaining({ p_lead_ids: ["l3"] })),
    );
  }, 30_000);
});
