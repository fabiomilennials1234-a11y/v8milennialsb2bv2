/**
 * Redirect da antiga aba Clientes de /leads → /carteira (CTO 2026-10-16).
 *
 * Monta o par real `usePersistedState` + `useRedirecionaAbaClientes` dentro de
 * um Router de verdade, com o localStorage do jsdom — o que prova o contrato
 * que importa: estado antigo `cliente` redireciona UMA vez, leva os filtros, e
 * a próxima visita a /leads fica em /leads (sem loop, sem aba fantasma).
 */
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", teamMemberId: "tm-1" }),
}));

import { usePersistedState } from "@/shared/hooks/usePersistedState";
import { useRedirecionaAbaClientes } from "./useRedirecionaAbaClientes";
import { DEFAULT_CARTEIRA_FILTERS } from "../lib/carteira-route";

const LEADS_KEY = "v8:ui:leads:org-1:tm-1";
const CARTEIRA_KEY = "v8:ui:carteira:org-1:tm-1";
const DEFAULT_LEADS = {
  searchQuery: "",
  filterOrigin: "all",
  filterQualification: "all",
  filterResponsible: "all",
  filterClassificacao: "all",
};

function seed(key: string, value: unknown) {
  const now = Date.now();
  localStorage.setItem(
    key,
    JSON.stringify({
      value,
      savedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    }),
  );
}
const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? "null")?.value;

let applyView: ((v: typeof DEFAULT_LEADS) => void) | null = null;
let goToLeads: (() => void) | null = null;
let goBack: (() => void) | null = null;
/** Cada aba que a "lista" chegou a pintar — o flash que a trava impede. */
let pintadas: string[] = [];

/** Dublê mínimo de `LeadsInner`: o mesmo par de hooks, a mesma regra de pintura. */
function LeadsHarness() {
  const [filterState, setFilterState] = usePersistedState("leads", DEFAULT_LEADS);
  const redirecionando = useRedirecionaAbaClientes(
    filterState.filterClassificacao ?? "all",
    filterState,
    setFilterState,
  );
  applyView = (v) => setFilterState(() => v);
  if (redirecionando) return null;
  pintadas.push(filterState.filterClassificacao ?? "all");
  return <div>LISTA DE LEADS · aba {filterState.filterClassificacao}</div>;
}

function CarteiraHarness() {
  const { search } = useLocation();
  const navigate = useNavigate();
  goToLeads = () => navigate("/leads");
  goBack = () => navigate(-1);
  return <div>CARTEIRA {search}</div>;
}

function renderAt(path: string | string[], initialIndex?: number) {
  return render(
    <MemoryRouter initialEntries={Array.isArray(path) ? path : [path]} initialIndex={initialIndex}>
      <Routes>
        <Route path="/" element={<div>HOME</div>} />
        <Route path="/leads" element={<LeadsHarness />} />
        <Route path="/carteira" element={<CarteiraHarness />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  applyView = null;
  goToLeads = null;
  goBack = null;
  pintadas = [];
});

describe("useRedirecionaAbaClientes", () => {
  it("estado persistido antigo `cliente` → /carteira, levando os filtros da aba", async () => {
    seed(LEADS_KEY, { ...DEFAULT_LEADS, filterClassificacao: "cliente", searchQuery: "ana", filterOrigin: "site" });
    renderAt("/leads");

    expect(await screen.findByText(/^CARTEIRA/)).toBeInTheDocument();
    expect(stored(CARTEIRA_KEY)).toEqual({ ...DEFAULT_CARTEIRA_FILTERS, searchQuery: "ana", filterOrigin: "site" });
    // A aba de Leads voltou para a padrão — o resto do estado fica.
    expect(stored(LEADS_KEY)).toMatchObject({ filterClassificacao: "all", searchQuery: "ana" });
  });

  it("trava: entre o reset para `all` e o /carteira a lista NÃO pinta", async () => {
    seed(LEADS_KEY, { ...DEFAULT_LEADS, filterClassificacao: "cliente" });
    renderAt("/leads");
    await screen.findByText(/^CARTEIRA/);
    // O primeiro render (antes da hidratação) pinta o padrão; depois que
    // `cliente` chega, nada mais pinta — nem o `all` do reset.
    expect(pintadas.filter((aba) => aba !== "all")).toEqual([]);
    expect(pintadas.length).toBeLessThanOrEqual(1);
  });

  it("replace: o voltar do navegador sai do redirect, não cai em /leads de novo", async () => {
    seed(LEADS_KEY, { ...DEFAULT_LEADS, filterClassificacao: "cliente" });
    renderAt(["/", "/leads"], 1);
    await screen.findByText(/^CARTEIRA/);

    act(() => goBack!());
    expect(await screen.findByText("HOME")).toBeInTheDocument();
  });

  it("sem loop: depois do redirect, voltar a /leads fica em /leads", async () => {
    seed(LEADS_KEY, { ...DEFAULT_LEADS, filterClassificacao: "cliente" });
    renderAt("/leads");
    await screen.findByText(/^CARTEIRA/);

    act(() => goToLeads!());
    expect(await screen.findByText("LISTA DE LEADS · aba all")).toBeInTheDocument();
  });

  it("preserva o deep-link ?lead= e descarta ?view=", async () => {
    seed(LEADS_KEY, { ...DEFAULT_LEADS, filterClassificacao: "cliente" });
    renderAt("/leads?view=V1&lead=L1");
    expect(await screen.findByText("CARTEIRA ?lead=L1")).toBeInTheDocument();
  });

  it("aplicar visão salva com `cliente` = redirecionar", async () => {
    renderAt("/leads");
    expect(await screen.findByText("LISTA DE LEADS · aba all")).toBeInTheDocument();

    act(() => applyView!({ ...DEFAULT_LEADS, filterClassificacao: "cliente", filterResponsible: "tm-9" }));
    expect(await screen.findByText(/^CARTEIRA/)).toBeInTheDocument();
    expect(stored(CARTEIRA_KEY)).toMatchObject({ filterResponsible: "tm-9" });
    expect(stored(LEADS_KEY)).toMatchObject({ filterClassificacao: "all" });
  });

  it.each(["all", "lead", "perdido", "indefinido"])("aba %s não redireciona", async (aba) => {
    seed(LEADS_KEY, { ...DEFAULT_LEADS, filterClassificacao: aba });
    renderAt("/leads");
    expect(await screen.findByText(`LISTA DE LEADS · aba ${aba}`)).toBeInTheDocument();
    expect(localStorage.getItem(CARTEIRA_KEY)).toBeNull();
  });
});
