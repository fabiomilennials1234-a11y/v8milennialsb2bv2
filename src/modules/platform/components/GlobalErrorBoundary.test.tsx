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
    sessionStorage.clear();
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

  it("erro de chunk na 1ª ocorrência é atualização, não defeito: não relata nem mostra código", () => {
    vi.spyOn(recovery, "recoverFromStaleBuild").mockResolvedValue(true);
    render(
      <GlobalErrorBoundary>
        <Thrower error={new Error("Failed to fetch dynamically imported module: https://torquecrm.com.br/assets/Leads-abc.js?x=1")} />
      </GlobalErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Há uma versão nova do Torque");
    expect(reports).toHaveLength(0);
    expect(screen.queryByText(/^Código /)).not.toBeInTheDocument();
  });

  it("chunk que falha de novo após recuperação é defeito: relata o arquivo e mostra o código", () => {
    sessionStorage.setItem(recovery.RECOVERY_KEY, String(Date.now()));
    render(
      <GlobalErrorBoundary>
        <Thrower error={new Error("Failed to fetch dynamically imported module: https://torquecrm.com.br/assets/Leads-abc.js?x=1")} />
      </GlobalErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Não conseguimos carregar o Torque");
    expect(reports).toHaveLength(1);
    expect(reports[0].context).toEqual({ source: "render", kind: "chunk-persistente" });
    const message = (reports[0].error.cause as Error).message;
    expect(message).toContain("/assets/Leads-abc.js");
    expect(message).not.toContain("x=1");
    expect(message).not.toContain("torquecrm.com.br");
    expect(screen.getByText(`Código ${reports[0].error.reference}`)).toBeInTheDocument();
  });

  it("botão Recarregar não fica mudo quando o servidor não responde", async () => {
    const recover = vi.spyOn(recovery, "recoverFromStaleBuild").mockResolvedValue(false);
    render(
      <GlobalErrorBoundary>
        <Thrower error={new Error("Failed to fetch dynamically imported module: /assets/x.js")} />
      </GlobalErrorBoundary>,
    );
    recover.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));
    expect(recover).toHaveBeenCalledWith(undefined, { force: true });
    expect(await screen.findByRole("status")).toHaveTextContent("Não conseguimos falar com o servidor");
    await waitFor(() => expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeEnabled());
  });
});
