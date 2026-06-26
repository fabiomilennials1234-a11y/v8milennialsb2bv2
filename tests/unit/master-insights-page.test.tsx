import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock só o hook de listagem de orgs — o estado vazio não toca os hooks de dados.
vi.mock("@/modules/identity/master/hooks/useMasterOrganizations", () => ({
  useMasterOrganizations: () => ({
    data: [
      { id: "org-2", name: "Bertin" },
      { id: "org-1", name: "Acme Distribuidora" },
    ],
    isLoading: false,
    isError: false,
  }),
}));

import MasterInsights from "@/modules/identity/master/pages/MasterInsights";

beforeAll(() => {
  // Polyfills p/ jsdom (framer-motion / Radix).
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (!("ResizeObserver" in window)) {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  // cmdk chama scrollIntoView ao montar a lista — não existe em jsdom.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/insights"]}>
        <MasterInsights />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("MasterInsights (smoke)", () => {
  it("renders the empty state with the editorial headline and org combobox", () => {
    renderPage();
    expect(screen.getByText("Unit economics por organização")).toBeInTheDocument();
    expect(
      screen.getByText(/Selecione uma organização para apresentar CAC/i),
    ).toBeInTheDocument();
    // combobox hero (sem org selecionada)
    expect(
      screen.getByRole("combobox", { name: /selecionar organização/i }),
    ).toBeInTheDocument();
  });

  it("opens the org combobox listing the (sorted) organizations", () => {
    renderPage();
    fireEvent.click(screen.getByRole("combobox", { name: /selecionar organização/i }));
    expect(screen.getByPlaceholderText(/buscar organização/i)).toBeInTheDocument();
    expect(screen.getByText("Acme Distribuidora")).toBeInTheDocument();
    expect(screen.getByText("Bertin")).toBeInTheDocument();
  });
});
