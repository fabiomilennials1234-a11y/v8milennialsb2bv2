import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  identity: {
    userId: "user-1" as string | null,
    organizationId: "org-1" as string | null,
    isMaster: false,
    isReady: true,
  },
  status: "unseen" as "loading" | "unseen" | "claiming" | "claimed" | "seen" | "error",
  enabledArg: [] as boolean[],
  claim: vi.fn(),
  resolve: vi.fn(),
  mutateAsync: vi.fn(),
  loadDialog: vi.fn(),
}));

vi.mock("@/modules/identity", () => ({ useIdentity: () => mocks.identity }));
vi.mock("@/modules/platform/hooks/usePromptImpression", () => ({
  usePromptImpression: (_key: string, { enabled }: { enabled: boolean }) => {
    mocks.enabledArg.push(enabled);
    return { status: enabled ? mocks.status : "loading", claim: mocks.claim, resolve: mocks.resolve };
  },
}));
vi.mock("@/modules/platform/hooks/useSubmitFeatureSuggestion", () => ({
  useSubmitFeatureSuggestion: () => ({ mutateAsync: mocks.mutateAsync }),
}));
import {
  ENTRY_DELAY_MS,
  FeatureSuggestionPrompt,
  RECHECK_MS,
} from "@/modules/platform/components/feedback/FeatureSuggestionPrompt";
import * as dialogModule from "@/modules/platform/components/feedback/FeatureSuggestionDialog";

function tree(path = "/") {
  return (
    <MemoryRouter initialEntries={[path]}>
      <FeatureSuggestionPrompt loadDialog={mocks.loadDialog} />
    </MemoryRouter>
  );
}

function mount(path = "/") {
  return render(tree(path));
}

function openOtherDialog() {
  const other = document.createElement("div");
  other.setAttribute("role", "dialog");
  other.setAttribute("data-state", "open");
  document.body.appendChild(other);
  return other;
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  mocks.identity = { userId: "user-1", organizationId: "org-1", isMaster: false, isReady: true };
  mocks.status = "unseen";
  mocks.enabledArg.length = 0;
  mocks.claim.mockReset().mockResolvedValue(true);
  mocks.resolve.mockReset().mockResolvedValue(undefined);
  mocks.mutateAsync.mockReset().mockResolvedValue(undefined);
  mocks.loadDialog.mockReset().mockResolvedValue(dialogModule);
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("FeatureSuggestionPrompt — gates", () => {
  it("elegível: espera ~1,5 s, faz o claim e só então abre", async () => {
    mount();
    await advance(ENTRY_DELAY_MS - 10);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await advance(20);
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("claim recusado (23505/erro) → nada aparece", async () => {
    mocks.claim.mockResolvedValue(false);
    mount();
    await advance(ENTRY_DELAY_MS + 10);
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each(["seen", "error", "loading"] as const)("status %s → sem claim, sem diálogo", async (status) => {
    mocks.status = status;
    mount();
    await advance(ENTRY_DELAY_MS * 3);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each([
    ["master", { isMaster: true }],
    ["sem org", { organizationId: null }],
    ["sem usuário", { userId: null }],
    ["identidade carregando", { isReady: false }],
  ])("%s → hook desabilitado, nada gravado", async (_label, patch) => {
    mocks.identity = { ...mocks.identity, ...patch };
    mount();
    await advance(ENTRY_DELAY_MS * 3);
    expect(mocks.enabledArg.every((enabled) => enabled === false)).toBe(true);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each(["/auth", "/signup", "/reset-password", "/_mockup/x", "/master/operacao", "/tv"])(
    "rota excluída %s → nada gravado",
    async (path) => {
      mount(path);
      await advance(ENTRY_DELAY_MS * 3);
      expect(mocks.claim).not.toHaveBeenCalled();
    },
  );

  it("/chat é permitido", async () => {
    mount("/chat");
    await advance(ENTRY_DELAY_MS + 10);
    expect(mocks.claim).toHaveBeenCalledTimes(1);
  });

  it("aba oculta adia; ao voltar a ficar visível, re-checa e segue", async () => {
    visibility = "hidden";
    mount();
    await advance(ENTRY_DELAY_MS + RECHECK_MS * 3);
    expect(mocks.claim).not.toHaveBeenCalled();
    visibility = "visible";
    await advance(RECHECK_MS + 10);
    expect(mocks.claim).toHaveBeenCalledTimes(1);
  });

  it("outro diálogo aberto adia; quando fecha, segue", async () => {
    const other = openOtherDialog();
    mount();
    await advance(ENTRY_DELAY_MS + RECHECK_MS * 3);
    expect(mocks.claim).not.toHaveBeenCalled();
    other.remove();
    await advance(RECHECK_MS + 10);
    expect(mocks.claim).toHaveBeenCalledTimes(1);
  });

  it("decisão uma vez por montagem: re-render não faz segundo claim", async () => {
    const view = mount();
    await advance(ENTRY_DELAY_MS + 10);
    view.rerender(tree());
    await advance(ENTRY_DELAY_MS * 3);
    expect(mocks.claim).toHaveBeenCalledTimes(1);
  });

  it("desmontar antes do atraso cancela tudo", async () => {
    const view = mount();
    await advance(ENTRY_DELAY_MS / 2);
    view.unmount();
    await advance(ENTRY_DELAY_MS * 2);
    expect(mocks.claim).not.toHaveBeenCalled();
  });
});

describe("FeatureSuggestionPrompt — a exibição não se gasta à toa", () => {
  it("chunk do diálogo não carrega → desiste SEM claim", async () => {
    mocks.loadDialog.mockRejectedValue(new Error("chunk"));
    mount();
    await advance(ENTRY_DELAY_MS * 3);
    expect(mocks.loadDialog).toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("chunk carrega antes do claim", async () => {
    const order: string[] = [];
    mocks.loadDialog.mockImplementation(async () => (order.push("load"), dialogModule));
    mocks.claim.mockImplementation(async () => (order.push("claim"), true));
    mount();
    await advance(ENTRY_DELAY_MS + 10);
    expect(order.slice(-2)).toEqual(["load", "claim"]);
  });

  it("status claimed (montagem anterior já gravou) → abre sem novo claim", async () => {
    mocks.status = "claimed";
    mount();
    await advance(ENTRY_DELAY_MS + 10);
    expect(mocks.claim).not.toHaveBeenCalled();
    vi.useRealTimers();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("troca de rota durante o claim: desmonta, remonta com claimed, abre com 1 claim só", async () => {
    let finishClaim: (value: boolean) => void = () => undefined;
    mocks.claim.mockImplementation(() => new Promise<boolean>((done) => (finishClaim = done)));
    const first = mount();
    await advance(ENTRY_DELAY_MS + 10);
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    first.unmount();
    // O hook real grava "claimed" no cache quando o INSERT passa.
    await act(async () => finishClaim(true));
    mocks.status = "claimed";
    mount("/pipeline");
    await advance(ENTRY_DELAY_MS + 10);
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("outro diálogo abre entre o claim e o render → espera ficar livre e abre", async () => {
    let other: HTMLElement | null = null;
    mocks.claim.mockImplementation(async () => {
      other = openOtherDialog();
      return true;
    });
    mount();
    await advance(ENTRY_DELAY_MS + 10);
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    await advance(RECHECK_MS * 3);
    expect(screen.queryByTestId("feature-suggestion-dialog")).not.toBeInTheDocument();
    other!.remove();
    await advance(RECHECK_MS + 10);
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    expect(await screen.findByTestId("feature-suggestion-dialog")).toBeInTheDocument();
  });
});

describe("FeatureSuggestionPrompt — claim em voo e saída", () => {
  it("status claiming (outra montagem com INSERT em voo) → aguarda o mesmo claim e abre", async () => {
    mocks.status = "claiming";
    mount();
    await advance(ENTRY_DELAY_MS + 10);
    // O hook devolve a promise em voo; aqui o dublê só confirma que o Prompt a usa.
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("fechar desmonta o diálogo (fase closed): sem overlay e sem pointer-events travado", async () => {
    mount();
    await advance(ENTRY_DELAY_MS + 10);
    vi.useRealTimers();
    await screen.findByRole("dialog");
    await act(async () => {
      screen.getByRole("button", { name: "Agora não" }).click();
    });
    await waitFor(() => expect(screen.queryByTestId("feature-suggestion-overlay")).not.toBeInTheDocument());
    expect(document.body.style.pointerEvents).toBe("");
    expect(mocks.resolve).toHaveBeenCalledWith("dismissed");
  });
});

describe("FeatureSuggestionPrompt — desfechos", () => {
  async function openDialog() {
    mount();
    await advance(ENTRY_DELAY_MS + 10);
    vi.useRealTimers();
    return screen.findByRole("dialog");
  }

  it("Agora não → resolve('dismissed')", async () => {
    await openDialog();
    await act(async () => {
      screen.getByRole("button", { name: "Agora não" }).click();
    });
    expect(mocks.resolve).toHaveBeenCalledWith("dismissed");
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it("enviar → sugestão gravada na org ativa, depois resolve('submitted')", async () => {
    await openDialog();
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Sua ideia"), "Relatório por vendedor");
    await user.click(screen.getByRole("button", { name: /Enviar sugestão/ }));
    await screen.findByText("Recebido. Obrigado!");
    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      organizationId: "org-1",
      kind: "feature",
      body: "Relatório por vendedor",
    });
    expect(mocks.resolve).toHaveBeenCalledWith("submitted");
    expect(mocks.mutateAsync.mock.invocationCallOrder[0]).toBeLessThan(mocks.resolve.mock.invocationCallOrder[0]);
    await user.click(screen.getByRole("button", { name: "Voltar ao Torque" }));
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
  });

  it("falha no envio não resolve o desfecho", async () => {
    mocks.mutateAsync.mockRejectedValue(new Error("x"));
    await openDialog();
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Sua ideia"), "Ideia que falha");
    await user.click(screen.getByRole("button", { name: /Enviar sugestão/ }));
    await screen.findByRole("alert");
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
