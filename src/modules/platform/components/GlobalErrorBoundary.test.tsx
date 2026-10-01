import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { setErrorReporter, type ErrorReport } from "@/shared/errors";
import { GlobalErrorBoundary } from "./GlobalErrorBoundary";

function Thrower({ error }: { error: Error }): never {
  throw error;
}

describe("GlobalErrorBoundary", () => {
  let reports: ErrorReport[];

  beforeEach(() => {
    reports = [];
    setErrorReporter((report) => reports.push(report));
    // React loga o erro capturado no console; o teste não precisa desse ruído.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    setErrorReporter(null);
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
});
