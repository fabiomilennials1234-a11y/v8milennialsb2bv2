// O mapa com os hooks de verdade (useUfHeatmap/useLeadsByUf) e um QueryClient
// real: a transição erro → sucesso é onde a pintura do SVG se perdia. Um mock
// estático do hook não alcança esse caminho — o TabMapa.test.tsx cobre o resto.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.hoisted(() => ({ heatmap: vi.fn(), leads: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => (fn === "get_uf_heatmap" ? rpc.heatmap(args) : rpc.leads(args)),
  },
}));
vi.mock("@/modules/identity", () => ({ useOrganization: () => ({ organizationId: "org-cj" }) }));

import { TabMapa } from "./TabMapa";

const PINTADO = "hsl(47 100% 52%)";
const LINHAS = [
  { uf: "SC", leads_count: 7028, clients_count: 0, total_sold: 0, unmapped_count: 1673 },
  { uf: "SP", leads_count: 1990, clients_count: 0, total_sold: 0, unmapped_count: 1673 },
];
const OK = () => Promise.resolve({ data: LINHAS, error: null });
const E504 = () =>
  Promise.resolve({ data: null, error: { message: "upstream request timeout", code: "", details: null, hint: null } });

const montar = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60_000 } } });
  const r = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TabMapa />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { qc, ...r };
};
const fillSC = (c: HTMLElement) => c.querySelector("path#BRSC")?.getAttribute("fill") ?? null;
const abreSC = (c: HTMLElement) => {
  fireEvent.click(c.querySelector("path#BRSC")!);
  return !!screen.queryByRole("heading", { name: "Santa Catarina" });
};

beforeEach(() => {
  rpc.heatmap.mockReset();
  rpc.leads.mockReset();
  rpc.leads.mockResolvedValue({ data: [], error: null });
});

it("refetch falha com a última carga em cache: o mapa segue pintado, e 'Tentar de novo' com o MESMO dado mantém pintura e clique", async () => {
  rpc.heatmap.mockImplementationOnce(OK).mockImplementationOnce(E504).mockImplementation(OK);
  const { qc, container } = montar();
  await waitFor(() => expect(fillSC(container)).toBe(PINTADO));

  await act(async () => {
    await qc.refetchQueries({ queryKey: ["uf-heatmap"] });
  });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Não deu para atualizar o mapa"));
  expect(screen.queryByText("Não foi possível carregar o mapa")).toBeNull();
  expect(fillSC(container)).toBe(PINTADO);

  fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(fillSC(container)).toBe(PINTADO);
  expect(abreSC(container)).toBe(true);
});

it("1ª carga falha: tela de erro cheia; 'Tentar de novo' traz o mapa pintado e clicável", async () => {
  rpc.heatmap.mockImplementationOnce(E504).mockImplementation(OK);
  const { container } = montar();
  await waitFor(() => expect(screen.getByText("Não foi possível carregar o mapa")).toBeTruthy());
  expect(container.querySelector(".tabmapa-svg")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
  await waitFor(() => expect(fillSC(container)).toBe(PINTADO));
  expect(abreSC(container)).toBe(true);
});
