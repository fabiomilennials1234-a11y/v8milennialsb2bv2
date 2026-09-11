import "@testing-library/jest-dom/vitest";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CopyLeadSummaryButton } from "./CopyLeadSummaryButton";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("./load-summary", () => ({ loadLeadSummary: mocks.load }));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org" }),
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error, info: mocks.info },
}));
let write: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue("RESUMO DO NEGÓCIO\nTexto completo");
  write = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: write },
  });
});
function mount(pending = false) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <div role="dialog">
        <div data-summary-pending={pending} />
        <CopyLeadSummaryButton leadId="lead" entryId="entry" />
      </div>
    </QueryClientProvider>,
  );
}
it("copia texto simples e confirma somente após sucesso", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Copiar resumo" }));
  await waitFor(() =>
    expect(mocks.success).toHaveBeenCalledWith("Resumo copiado"),
  );
  expect(mocks.load).toHaveBeenCalledWith("lead", "org", "entry");
  expect(write).toHaveBeenCalledWith("RESUMO DO NEGÓCIO\nTexto completo");
});
it("bloqueia cópia quando existem edições pendentes", () => {
  mount(true);
  fireEvent.click(screen.getByRole("button", { name: "Copiar resumo" }));
  expect(mocks.info).toHaveBeenCalled();
  expect(mocks.load).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});
it("nunca copia resultado parcial ou mostra sucesso após falha de leitura", async () => {
  mocks.load.mockRejectedValue(new Error("Sem acesso"));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Copiar resumo" }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Sem acesso"));
  expect(write).not.toHaveBeenCalled();
  expect(mocks.success).not.toHaveBeenCalled();
});
it("oferece texto completo para cópia manual quando navegador bloqueia clipboard", async () => {
  write.mockRejectedValue(new Error("NotAllowedError"));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Copiar resumo" }));
  expect(
    await screen.findByRole("textbox", {
      name: "Resumo do negócio para copiar",
    }),
  ).toHaveValue("RESUMO DO NEGÓCIO\nTexto completo");
  expect(mocks.success).not.toHaveBeenCalled();
});
it("descarta resultado quando card fecha durante carregamento", async () => {
  let resolve!: (text: string) => void;
  mocks.load.mockReturnValue(
    new Promise<string>((done) => {
      resolve = done;
    }),
  );
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "Copiar resumo" }));
  expect(screen.getByRole("button", { name: "Preparando…" })).toBeDisabled();
  view.unmount();
  resolve("Resumo");
  await Promise.resolve();
  expect(write).not.toHaveBeenCalled();
});
