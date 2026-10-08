/**
 * ChatHeader — quem cede espaço, e em que ordem.
 *
 * Print do CTO em 2026-09-03 (Milennials, dois números de voz): o botão de
 * ligar chegou a 200 px, o contato colapsou até sobrar o avatar, e o "Ao vivo"
 * caiu para baixo do avatar, por trás do botão. Três causas no código, e é o
 * que este arquivo prende: o contato não tinha piso, a linha do nome tinha
 * `flex-wrap`, e a raiz tinha `overflow-hidden` escondendo o resto.
 *
 * O jsdom não aplica CSS, então o que se afirma aqui é o CONTRATO em classes
 * — o mesmo que `layout-onda-2b.md` documenta — e o comportamento dos menus.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";

// Radix (dropdown + Popper) usa APIs de ponteiro e ResizeObserver que o jsdom
// não implementa. Sem estes stubs o menu nem abre.
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

vi.mock("@/modules/communication/hooks/useMessageLimits", () => ({
  useMessageLimits: () => ({ data: null }),
}));
vi.mock("@/modules/communication/components/chat/RealtimeStatusBadge", () => ({
  RealtimeStatusBadge: ({ className }: { className?: string }) => (
    <span className={className} data-testid="ao-vivo">Ao vivo</span>
  ),
}));
vi.mock("@/modules/communication/components/chat/history-sync/SyncChatButton", () => ({
  SyncChatDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Histórico desta conversa" /> : null),
}));
/**
 * O botão de ligar com DOIS números, como no print: é o pior caso de largura
 * que o cabeçalho tem que aguentar. A suíte do botão em si é outra.
 */
vi.mock("@/modules/communication/components/voice/VoiceCallButton", () => ({
  VoiceCallButton: () => (
    <div data-testid="ligar" className="inline-flex shrink-0">
      <button type="button">Ligar</button>
      <button type="button" aria-label="Trocar o número que vai ligar. Agora: Gabrielly-SDR." />
    </div>
  ),
}));

import { ChatHeader } from "./ChatHeader";

const base: React.ComponentProps<typeof ChatHeader> = {
  phoneNumber: "+55 11 97266-5516",
  contactName: "Carlos Alberto Manso LEAD_ID: 1819254802395016",
  hasLead: true,
  leadId: "lead-1",
  instanceId: "inst-1",
  instanceName: "Comercial",
  szChatSession: null,
  organizationId: "org-1",
  onBack: vi.fn(),
  onOpenLeadModal: vi.fn(),
  onTransferToSzChatTeam: vi.fn(),
  transferPending: false,
  density: "comfortable",
  onDensityChange: vi.fn(),
};

function montar(props: Partial<React.ComponentProps<typeof ChatHeader>> = {}) {
  return render(
    <TooltipProvider>
      <ChatHeader {...base} {...props} />
    </TooltipProvider>,
  );
}

const raiz = () => screen.getByText("Ligar").closest("div.border-b")!;
const nome = () => screen.getByRole("heading", { level: 3 });
const linhaDoNome = () => nome().parentElement!;
const blocoDoContato = () => nome().closest('[role="button"]')!;

describe("ChatHeader — o contato é o último a perder espaço", () => {
  it("does not offer lead creation before the first successful send", () => {
    montar({ hasLead: false, onOpenLeadModal: undefined });
    expect(screen.queryByRole("button", { name: "Criar lead" })).not.toBeInTheDocument();
    expect(nome().closest('[role="button"]')).toBeNull();
  });
  it("com dois números de voz, nome e telefone continuam no DOM", () => {
    montar();
    expect(screen.getByTestId("ligar")).toBeInTheDocument();
    expect(nome()).toHaveTextContent("Carlos Alberto Manso LEAD_ID: 1819254802395016");
    expect(screen.getByText("+55 11 97266-5516")).toBeInTheDocument();
  });

  it("o bloco do contato tem piso e continua sendo o único que encolhe", () => {
    montar();
    expect(blocoDoContato().className).toMatch(/\bflex-1\b/);
    expect(blocoDoContato().className).toMatch(/min-w-\[11rem\]/);
    expect(blocoDoContato().className).not.toMatch(/\bmin-w-0\b/);
  });

  // Com `flex-wrap`, o "Ao vivo" caía para baixo do avatar, por trás do botão.
  it("a linha do nome não quebra: nowrap, nome trunca, badge não encolhe", () => {
    montar();
    expect(linhaDoNome().className).not.toMatch(/\bflex-wrap\b/);
    expect(linhaDoNome().className).toMatch(/\bflex-nowrap\b/);
    expect(nome().className).toMatch(/\btruncate\b/);
    expect(within(linhaDoNome()).getByTestId("ao-vivo").className).toMatch(/\bshrink-0\b/);
  });

  it("o telefone trunca em vez de empurrar a linha", () => {
    montar();
    expect(screen.getByText("+55 11 97266-5516").className).toMatch(/\btruncate\b/);
  });

  // `overflow-hidden` escondia o problema em vez de resolver — e recortava o
  // anel de foco dos botões, que o DESIGN.md §5 reprova.
  it("a raiz não tem overflow-hidden", () => {
    montar();
    expect(raiz().className).not.toMatch(/overflow-hidden/);
  });
});

describe("ChatHeader — as ações moram num grupo que não encolhe", () => {
  // V5 (02/10): "Sincronizar histórico" saiu do botão solto para o ⋯ — o
  // grupo agora é Ver lead · Ligar · densidade · ⋯.
  it("Ver lead, Ligar, densidade e ⋯ ficam no mesmo grupo shrink-0", () => {
    montar();
    const grupo = screen.getByTestId("ligar").parentElement!;
    expect(grupo.className).toMatch(/\bshrink-0\b/);
    expect(within(grupo).getByRole("button", { name: "Ver lead" })).toBeInTheDocument();
    expect(within(grupo).getByRole("button", { name: "Densidade das mensagens" })).toBeInTheDocument();
    expect(within(grupo).getByRole("button", { name: "Mais ações da conversa" })).toBeInTheDocument();
  });

  // Abaixo de `lg` o rótulo vira ícone; o nome acessível fica, pelo aria-label.
  it("o rótulo 'Ver lead' cede abaixo de lg, e o botão continua nomeado", () => {
    montar();
    const rotulo = screen.getByText("Ver lead");
    expect(rotulo.className).toMatch(/\bhidden\b/);
    expect(rotulo.className).toMatch(/lg:inline/);
    expect(screen.getByRole("button", { name: "Ver lead" })).toHaveAttribute("title", "Ver dados do lead e funis");
  });

  it("sem lead, o rótulo 'Criar Lead' segue a mesma regra", () => {
    montar({ hasLead: false, leadId: undefined });
    expect(screen.getByText("Criar Lead").className).toMatch(/lg:inline/);
    expect(screen.getByRole("button", { name: "Criar lead" })).toBeInTheDocument();
  });

  it("a legenda traz a caixa ao lado do telefone", () => {
    montar();
    expect(screen.getByText("Comercial")).toBeInTheDocument();
  });
});

describe("ChatHeader — o ⋯ da conversa", () => {
  it("sincronizar histórico abre o diálogo de sempre", async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole("button", { name: "Mais ações da conversa" }));
    await user.click(await screen.findByRole("menuitem", { name: "Sincronizar histórico" }));
    expect(await screen.findByRole("dialog", { name: "Histórico desta conversa" })).toBeInTheDocument();
  });

  it("marcar como não lida e arquivar chamam os handlers da linha", async () => {
    const user = userEvent.setup();
    const onMarkUnread = vi.fn();
    const onArchive = vi.fn();
    montar({ onMarkUnread, onArchive });
    await user.click(screen.getByRole("button", { name: "Mais ações da conversa" }));
    await user.click(await screen.findByRole("menuitem", { name: "Marcar como não lida" }));
    expect(onMarkUnread).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Mais ações da conversa" }));
    await user.click(await screen.findByRole("menuitem", { name: "Arquivar conversa" }));
    expect(onArchive).toHaveBeenCalledOnce();
  });

  it("conversa arquivada oferece desarquivar, não arquivar", async () => {
    const user = userEvent.setup();
    montar({ isArchived: true, onArchive: vi.fn(), onUnarchive: vi.fn() });
    await user.click(screen.getByRole("button", { name: "Mais ações da conversa" }));
    expect(await screen.findByRole("menuitem", { name: "Desarquivar conversa" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Arquivar conversa" })).not.toBeInTheDocument();
  });
});

describe("ChatHeader — densidade num botão com três opções", () => {
  it("abre as três densidades com descrição, marca a atual e usa o mesmo handler", async () => {
    const onDensityChange = vi.fn();
    const user = userEvent.setup();
    montar({ onDensityChange, density: "comfortable" });

    await user.click(screen.getByRole("button", { name: "Densidade das mensagens" }));
    expect(await screen.findByText("Equilíbrio entre leitura e volume")).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /Padrão/ })).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("menuitemradio", { name: /Compacto/ }));
    expect(onDensityChange).toHaveBeenCalledWith("compact");
  });

  it("sem onDensityChange, o botão de densidade não existe", () => {
    montar({ onDensityChange: undefined });
    expect(screen.queryByRole("button", { name: "Densidade das mensagens" })).not.toBeInTheDocument();
  });
});
