import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemberPermissions } from "./MemberPermissions";

// ── Mocks ──────────────────────────────────────────────────────────────────
const db = vi.hoisted(() => ({
  catalog: [] as Array<Record<string, unknown>>,
  orgDefaults: [] as Array<{ feature_key: string; enabled: boolean }>,
  upsert: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => {
  // Query builder mínimo: encadeável e "thenable", resolve com { data, error }.
  const builder = (rows: unknown) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "order", "eq"]) b[m] = () => b;
    b.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
    return b;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table === "feature_permissions") return builder(db.catalog);
        if (table === "organization_feature_defaults") {
          return {
            select: () => builder(db.orgDefaults),
            upsert: db.upsert,
            delete: () => builder(null),
          };
        }
        return builder([]);
      },
      auth: { getSession: async () => ({ data: { session: null } }) },
    },
  };
});

vi.mock("@/modules/identity", () => ({
  useTeamMembers: () => ({ data: [], isLoading: false }),
  useIdentity: () => ({ isAdmin: true, organizationId: "org-1" }),
}));
vi.mock("@/modules/platform", () => ({ useFeatureFlag: () => ({ enabled: false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/shared/errors", () => ({ notifyError: vi.fn() }));

// ── Catálogo mínimo: o grupo de Leads, o de Pipeline e uma ação de cada ────
function row(key: string, module: string, name: string, sort: number, def = true) {
  return {
    key,
    module,
    name,
    description: `${name}.`,
    is_admin_only: false,
    default_value: def,
    sort_order: sort,
  };
}

const CATALOG = [
  row("leads.view", "Leads", "Ver leads", 10),
  row("leads.view_all", "Leads", "Ver leads de todos", 70),
  row("leads.view_unassigned", "Leads", "Ver leads sem responsável", 71),
  row("leads.view_subordinates", "Leads", "Ver leads de subordinados", 72),
  row("leads.create", "Leads", "Criar lead", 20),
  row("pipeline.view", "Pipeline", "Ver funis", 10),
  row("pipeline.view_all", "Pipeline", "Ver cards de todos no funil", 15),
  row("pipeline.move_cards", "Pipeline", "Mover cards", 20),
];

const LEADS_OWN = [
  { feature_key: "leads.view_all", enabled: false },
  { feature_key: "leads.view_unassigned", enabled: false },
  { feature_key: "leads.view_subordinates", enabled: false },
];

function renderTela() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemberPermissions />
    </QueryClientProvider>,
  );
}

const grupo = (name: string) => screen.getByRole("radiogroup", { name });
const opcao = (name: string, label: string) =>
  within(grupo(name)).getByRole("radio", { name: label });

describe("MemberPermissions — Visualização no Funil (pipeline.view_all, ADR-0042)", () => {
  beforeEach(() => {
    db.catalog = CATALOG;
    db.orgDefaults = [];
    db.upsert.mockReset();
    db.upsert.mockResolvedValue({ error: null });
  });

  it("mostra os dois controles — Leads e Funil — e NÃO repete pipeline.view_all como switch", async () => {
    renderTela();
    await screen.findByRole("radiogroup", { name: "Visualização no Funil" });

    expect(grupo("Visualização de leads")).toBeInTheDocument();
    expect(grupo("Visualização no Funil")).toBeInTheDocument();
    expect(screen.queryByText("Ver cards de todos no funil")).not.toBeInTheDocument();
    // As ações seguem como linhas normais.
    expect(screen.getByText("Mover cards")).toBeInTheDocument();
  });

  it("com o catálogo no default (true), o Funil abre em 'Todos' e habilitado", async () => {
    renderTela();
    await screen.findByRole("radiogroup", { name: "Visualização no Funil" });

    expect(opcao("Visualização no Funil", "Todos")).toBeChecked();
    expect(opcao("Visualização no Funil", "Todos")).toBeEnabled();
    expect(opcao("Visualização no Funil", "Só os meus")).toBeEnabled();
  });

  it("escolher 'Só os meus' no Funil grava SÓ pipeline.view_all=false", async () => {
    renderTela();
    await screen.findByRole("radiogroup", { name: "Visualização no Funil" });

    fireEvent.click(opcao("Visualização no Funil", "Só os meus"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar permissões" }));

    await waitFor(() => expect(db.upsert).toHaveBeenCalledTimes(1));
    expect(db.upsert.mock.calls[0][0]).toEqual([
      { organization_id: "org-1", feature_key: "pipeline.view_all", enabled: false },
    ]);
  });

  it("o texto do Funil explica o efeito: Leads continua mostrando os leads, sem o card", async () => {
    renderTela();
    await screen.findByRole("radiogroup", { name: "Visualização no Funil" });

    fireEvent.click(opcao("Visualização no Funil", "Só os meus"));
    expect(screen.getByText(/sem o card do funil/i)).toBeInTheDocument();
  });

  it("Leads 'Só os meus' DERIVA o Funil: desabilitado, 'Só os meus' marcado, com aviso", async () => {
    db.orgDefaults = LEADS_OWN;
    renderTela();
    await screen.findByRole("radiogroup", { name: "Visualização no Funil" });

    expect(opcao("Visualização de leads", "Só os meus")).toBeChecked();
    expect(opcao("Visualização no Funil", "Só os meus")).toBeChecked();
    expect(opcao("Visualização no Funil", "Só os meus")).toBeDisabled();
    expect(opcao("Visualização no Funil", "Todos")).toBeDisabled();
    expect(screen.getByText(/Derivado da visualização de leads/)).toBeInTheDocument();
  });

  it("baixar Leads para 'Só os meus' NÃO grava pipeline.view_all (derivado, não escrito)", async () => {
    renderTela();
    await screen.findByRole("radiogroup", { name: "Visualização no Funil" });

    fireEvent.click(opcao("Visualização de leads", "Só os meus"));
    // Na tela o Funil já aparece rebaixado...
    expect(opcao("Visualização no Funil", "Só os meus")).toBeChecked();
    expect(opcao("Visualização no Funil", "Só os meus")).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Salvar permissões" }));
    await waitFor(() => expect(db.upsert).toHaveBeenCalledTimes(1));

    // ...mas só as três chaves de leads vão para o banco.
    const keys = (db.upsert.mock.calls[0][0] as Array<{ feature_key: string }>)
      .map((r) => r.feature_key)
      .sort();
    expect(keys).toEqual(["leads.view_all", "leads.view_subordinates", "leads.view_unassigned"]);
    expect(keys).not.toContain("pipeline.view_all");
  });

  it("o valor gravado reaparece quando Leads sobe de novo (Funil 'Só os meus' guardado)", async () => {
    db.orgDefaults = [...LEADS_OWN, { feature_key: "pipeline.view_all", enabled: false }];
    renderTela();
    await screen.findByRole("radiogroup", { name: "Visualização no Funil" });
    expect(opcao("Visualização no Funil", "Só os meus")).toBeDisabled();

    fireEvent.click(opcao("Visualização de leads", "Todos da org"));

    expect(opcao("Visualização no Funil", "Só os meus")).toBeChecked();
    expect(opcao("Visualização no Funil", "Só os meus")).toBeEnabled();
  });
});
