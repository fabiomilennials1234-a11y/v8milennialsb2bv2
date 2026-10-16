import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({ outbounder: false }));
vi.mock("../hooks/useMasterAuth", () => ({ useMasterAuth: () => ({ isOutbounder: state.outbounder, isFullMaster: !state.outbounder, permissions: { all: !state.outbounder, organizations: true } }) }));
vi.mock("../hooks/useMasterOrganizations", () => ({
  useMasterOrganizations: () => ({ data: [
    { id: "ativa", name: "Ativa", slug: "ativa", subscription_status: "active", org_type: "crm" },
    { id: "trial", name: "Cliente Trial", slug: "trial", subscription_status: "trial", org_type: "crm" },
    { id: "inativa", name: "Inativa", slug: "inativa", subscription_status: "suspended", org_type: "crm" },
    { id: "bv", name: "Cliente Outbound", slug: "bv", subscription_status: "suspended", org_type: "outbound" },
    { id: "cancelada", name: "Cancelada", slug: "cancelada", subscription_status: "cancelled", org_type: "crm" },
  ], isLoading: false }),
  useMasterCreateOrganization: () => ({}), useMasterDeleteOrganization: () => ({}),
  useMasterSetOrgSuspension: () => ({}), FUNNEL_TEMPLATES: {},
}));
vi.mock("../hooks/useOrgFicha", () => ({ useOrgHealthSignals: () => ({ data: new Map() }) }));
vi.mock("../hooks/useOrgFinance", () => ({ useOrgFinance: () => ({ isError: true }), useCostSettings: () => ({ isError: true }) }));
vi.mock("../hooks/usePlanCatalog", () => ({ usePlanCatalog: () => ({ data: new Map() }) }));
vi.mock("../components/org/OrgFicha", () => ({ OrgFicha: () => null }));
vi.mock("../components/org/OrgFinanceDialogs", () => ({ CostSettingsDialog: () => null, MonthlyFeeDialog: () => null }));
vi.mock("../components/BillingOverrideModal", () => ({ BillingOverrideModal: () => null }));

import MasterOrganizations from "./MasterOrganizations";

const renderPage = (url = "/master/organizations") => render(<MemoryRouter initialEntries={[url]}><MasterOrganizations /></MemoryRouter>);
const table = () => within(screen.getByRole("table"));
beforeEach(() => { state.outbounder = false; });
afterEach(cleanup);

describe("abas de status das organizações", () => {
  it("mantém orgs ativas sem login na aba de ativas", () => {
    renderPage();
    expect(table().getByText("Ativa")).toBeInTheDocument();
    expect(table().getByText("Cliente Trial")).toBeInTheDocument();
    expect(table().queryByText("Inativa")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Orgs inativas · 3" })).toBeInTheDocument();
  });

  it("troca para inativas, limpa filtros anteriores e permite buscar", async () => {
    const user = userEvent.setup();
    renderPage("/master/organizations?uso=ativas");
    await user.type(screen.getByPlaceholderText("Buscar por nome ou slug..."), "Ativa");
    await user.click(screen.getByRole("tab", { name: /Orgs inativas/ }));
    expect(table().getByText("Inativa")).toBeInTheDocument();
    expect(table().getByText("Cliente Outbound")).toBeInTheDocument();
    expect(table().getByText("Cancelada")).toBeInTheDocument();
    expect(table().queryByText("Ativa")).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("Buscar por nome ou slug..."), "Inativa");
    expect(table().queryByText("Cliente Outbound")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ações de Inativa" }));
    await user.click(screen.getByRole("menuitem", { name: "Reativar" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Reativar Inativa");
  });

  it("permite inativar trial e mostra o destino da org na confirmação", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Ações de Cliente Trial" }));
    await user.click(screen.getByRole("menuitem", { name: "Inativar" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Inativar Cliente Trial");
    expect(screen.getByRole("alertdialog")).toHaveTextContent("aba Orgs inativas");
    expect(screen.getByRole("button", { name: "Inativar e cortar acesso" })).toBeDisabled();
  });

  it("abre inativas pela URL respeitando o escopo outbound", async () => {
    state.outbounder = true;
    renderPage("/master/organizations?status=inativas");
    await waitFor(() => expect(table().getByText("Cliente Outbound")).toBeInTheDocument());
    expect(table().queryByText("Inativa")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Orgs inativas · 1" })).toHaveAttribute("aria-selected", "true");
  });
});
