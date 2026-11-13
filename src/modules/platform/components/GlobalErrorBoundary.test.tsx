import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { addErrorReporter, type ErrorReport } from "@/shared/errors";
import * as recovery from "@/core/stale-build-recovery";
import { GlobalErrorBoundary } from "./GlobalErrorBoundary";

function Thrower({ error }: { error: Error }): never {
  throw error;
}

describe("GlobalErrorBoundary", () => {
  let reports: ErrorReport[];
  let unregister: () => void;

  beforeEach(() => {
    reports = [];
    unregister = addErrorReporter((report) => reports.push(report));
    // React loga o erro capturado no console; o teste não precisa desse ruído.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    unregister();
    vi.restoreAllMocks();
  });

  it("não mostra o texto técnico do erro", () => {
    render(
      <GlobalErrorBoundary>
        <Thrower error={new TypeError("Cannot read properties of undefined (reading 'map')")} />
      </GlobalErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Algo deu errado nesta tela");
    expect(screen.queryByText(/Cannot read properties/)).not.toBeInTheDocument();
  });

  it("mostra o código e relata com a mesma referência", () => {
    render(
      <GlobalErrorBoundary>
        <Thrower error={new Error("boom")} />
      </GlobalErrorBoundary>,
    );
    expect(reports).toHaveLength(1);
    expect(reports[0].context).toEqual({ source: "render" });
    const reference = reports[0].error.reference;
    expect(screen.getByText(`Código ${reference}`)).toBeInTheDocument();
  });

  it("erro de chunk é atualização, não defeito: não relata nem mostra código", () => {
    vi.spyOn(sessionStorage, "getItem").mockReturnValue(String(Date.now()));
    render(
      <GlobalErrorBoundary>
        <Thrower error={new Error("Failed to fetch dynamically imported module: /assets/x.js")} />
      </GlobalErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Há uma versão nova do Torque");
    expect(reports).toHaveLength(0);
    expect(screen.queryByText(/^Código /)).not.toBeInTheDocument();
  });
  it("explica a falha e permite nova tentativa sem apagar a sessão", async () => {
    const recover = vi.spyOn(recovery, "recoverFromStaleBuild").mockResolvedValue(false);
    render(<GlobalErrorBoundary><Thrower error={new Error("Loading chunk 42 failed")} /></GlobalErrorBoundary>);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Confira sua conexão"));
    fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));
    await waitFor(() => expect(recover).toHaveBeenCalledWith(undefined, { force: true }));
  });

  it("ir para o início também recupera o build antes de navegar", async () => {
    const recover = vi.spyOn(recovery, "recoverFromStaleBuild").mockResolvedValue(false);
    render(<GlobalErrorBoundary><Thrower error={new Error("Loading chunk 42 failed")} /></GlobalErrorBoundary>);
    await waitFor(() => expect(screen.getByRole("button", { name: "Ir para o início" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Ir para o início" }));
    await waitFor(() => expect(recover).toHaveBeenCalledWith(expect.objectContaining({ reload: expect.any(Function) }), { force: true }));
  });

});
