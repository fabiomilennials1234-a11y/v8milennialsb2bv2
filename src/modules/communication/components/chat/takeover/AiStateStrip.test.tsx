/**
 * A faixa de estado da IA oferece SÓ o que a máquina aceita.
 *
 * A trava que este arquivo prende é a da decisão D3 do CTO: o mockup oferecia
 * "Assumir conversa" com a IA ativa e no "Retomando", e o gatilho
 * `enforce_ai_state_transition` recusa as duas (23514). Cada estado lista aqui
 * as transições que a faixa mostra — e o que ela NÃO pode mostrar.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AiTakeoverState } from "@/modules/communication/lib/chat-types";

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
  (globalThis as Record<string, unknown>).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const fsm = {
  state: "AI_ACTIVE" as AiTakeoverState,
  resumeMode: null as null | "immediate" | "after_response" | "dont_resume",
  pauseAi: vi.fn(async () => {}),
  resumeAi: vi.fn(async () => {}),
  markHumanActive: vi.fn(async () => {}),
  markHandoffBack: vi.fn(async () => {}),
  markWaitingHuman: vi.fn(async () => {}),
};

vi.mock("@/modules/communication/hooks/chat/useTakeover", () => ({
  useTakeover: () => ({
    ...fsm,
    updatedAt: null,
    isLoading: false,
    isMutating: false,
  }),
}));

import { AiStateStrip } from "./AiStateStrip";

function montar(props: Partial<React.ComponentProps<typeof AiStateStrip>> = {}) {
  const onToggleAi = vi.fn();
  render(
    <TooltipProvider>
      <AiStateStrip
        conversationId="conv-1"
        aiDisabled={false}
        onToggleAi={onToggleAi}
        toggleAiPending={false}
        {...props}
      />
    </TooltipProvider>,
  );
  return { onToggleAi };
}

const botao = (nome: string) => screen.queryByRole("button", { name: nome });

beforeEach(() => {
  fsm.state = "AI_ACTIVE";
  fsm.resumeMode = null;
  vi.clearAllMocks();
});

describe("AiStateStrip — transições por estado (as do menu de TakeoverControls)", () => {
  it("IA ativa: pausar; NUNCA 'Assumir conversa' (a FSM recusa)", async () => {
    const user = userEvent.setup();
    montar();
    expect(screen.getByText("IA ativa")).toBeInTheDocument();
    expect(botao("Assumir conversa")).not.toBeInTheDocument();
    await user.click(botao("Pausar IA")!);
    expect(fsm.pauseAi).toHaveBeenCalledWith("immediate");

    await user.click(screen.getByRole("button", { name: "Mais ações da IA" }));
    await user.click(await screen.findByRole("menuitem", { name: "Pausar após resposta" }));
    expect(fsm.pauseAi).toHaveBeenCalledWith("after_response");
  });

  it("pausada: retomar e assumir", async () => {
    fsm.state = "AI_PAUSED_MANUAL";
    fsm.resumeMode = "dont_resume";
    const user = userEvent.setup();
    montar();
    expect(screen.getByText("Não retoma sozinha — retome quando quiser.")).toBeInTheDocument();
    await user.click(botao("Retomar IA")!);
    expect(fsm.resumeAi).toHaveBeenCalledOnce();
    await user.click(botao("Assumir conversa")!);
    expect(fsm.markHumanActive).toHaveBeenCalledOnce();
  });

  it("aguardando você: é alerta, e oferece assumir ou deixar com a IA", async () => {
    fsm.state = "WAITING_HUMAN";
    const user = userEvent.setup();
    montar();
    expect(screen.getByRole("alert")).toHaveAttribute("data-state", "WAITING_HUMAN");
    await user.click(botao("Assumir conversa")!);
    expect(fsm.markHumanActive).toHaveBeenCalledOnce();
    await user.click(botao("Deixar com a IA")!);
    expect(fsm.resumeAi).toHaveBeenCalledOnce();
  });

  it("você assumiu: devolver; switch do lead travado e desligado", async () => {
    fsm.state = "HUMAN_ACTIVE";
    const user = userEvent.setup();
    const { onToggleAi } = montar();
    await user.click(botao("Devolver para a IA")!);
    expect(fsm.markHandoffBack).toHaveBeenCalledOnce();
    const sw = screen.getByRole("switch", { name: "Copilot ligado para este lead" });
    expect(sw).toBeDisabled();
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(onToggleAi).not.toHaveBeenCalled();
  });

  it("retomando: só 'Retomar IA agora' — NUNCA 'Assumir conversa'", async () => {
    fsm.state = "HANDOFF_BACK";
    const user = userEvent.setup();
    montar();
    expect(botao("Assumir conversa")).not.toBeInTheDocument();
    await user.click(botao("Retomar IA agora")!);
    expect(fsm.resumeAi).toHaveBeenCalledOnce();
  });
});

describe("AiStateStrip — o switch do lead é outro conceito", () => {
  it("lead com IA desligada: a faixa diz o que acontece de fato, sem ações de FSM", () => {
    montar({ aiDisabled: true });
    expect(screen.getByText("IA desligada para este lead", { selector: "p" })).toBeInTheDocument();
    expect(botao("Pausar IA")).not.toBeInTheDocument();
  });

  it("religar a IA chama o mesmo handler do switch de antes", async () => {
    const user = userEvent.setup();
    const { onToggleAi } = montar({ aiDisabled: true });
    await user.click(screen.getByRole("switch", { name: "Copilot ligado para este lead" }));
    expect(onToggleAi).toHaveBeenCalledWith(true);
  });

  it("'Ver histórico da IA' só aparece quando há para onde ir", async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole("button", { name: "Mais ações da IA" }));
    expect(screen.queryByRole("menuitem", { name: "Ver histórico da IA" })).not.toBeInTheDocument();
  });
});
