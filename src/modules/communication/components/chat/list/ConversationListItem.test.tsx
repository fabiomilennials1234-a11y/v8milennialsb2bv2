import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConversationListItem, type ConversationListItemProps } from "./ConversationListItem";
import type { ChatContact } from "@/modules/communication/hooks/chat/types";

// As flags de nome (`chat_nome_do_lead`, `chat_nome_cod_contato_lead`) leem a
// org via AuthProvider; desligadas aqui, a linha usa a regra de nome de sempre.
vi.mock("@/modules/platform/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: false }),
}));

function contact(over: Partial<ChatContact> = {}): ChatContact {
  return {
    channel: "whatsapp",
    instance_id: "inst-1",
    phone_number: "5548999000111",
    push_name: "Maria",
    last_message: "oi",
    last_message_time: "2026-07-23T00:00:00Z",
    last_message_direction: "incoming",
    last_message_sent_source: "manual",
    unread_count: 0,
    lead_id: "lead-1",
    lead_name: "Maria Silva",
    conversation_id: "conv-1",
    archived_at: null,
    tags: [],
    is_group: false,
    funnels: [],
    qualification_tier: null,
    ...over,
  };
}

function baseProps(over: Partial<ConversationListItemProps> = {}): ConversationListItemProps {
  return {
    contact: contact(),
    isSelected: false,
    onSelect: vi.fn(),
    activeTab: "active",
    isAdmin: false,
    instanceId: "inst-1",
    organizationId: "org-1",
    allTags: [],
    onArchive: vi.fn(),
    onUnarchive: vi.fn(),
    onDelete: vi.fn(),
    onAddTag: vi.fn(),
    onRemoveTag: vi.fn(),
    ...over,
  };
}

describe("ConversationListItem — pill de etapa (S4)", () => {
  it("mostra o rótulo da etapa quando fornecido", () => {
    render(<ConversationListItem {...baseProps({ stageLabel: "Agendado" })} />);
    expect(screen.getByText("Agendado")).toBeInTheDocument();
  });

  it("não mostra pill quando stageLabel ausente", () => {
    render(<ConversationListItem {...baseProps()} />);
    expect(screen.queryByTitle(/^Etapa:/)).not.toBeInTheDocument();
  });
});

it("marks the row's account unread, without selecting the conversation", async () => {
  const props = baseProps({ instanceId: "different-open-box", onMarkUnread: vi.fn() });
  render(<ConversationListItem {...props} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Opções da conversa" }));
  await user.click(screen.getByRole("menuitem", { name: "Marcar como não lido" }));
  expect(props.onMarkUnread).toHaveBeenCalledWith("5548999000111", "inst-1");
  expect(props.onSelect).not.toHaveBeenCalled();
});

describe("ConversationListItem — linha de três andares (V5)", () => {
  it("'Pediu atendente' aparece quando o lead está na fila de handoff", () => {
    render(<ConversationListItem {...baseProps({ waitingHumanLeadIds: new Set(["lead-1"]) })} />);
    expect(screen.getByText("Pediu atendente")).toBeInTheDocument();
  });

  it("sem fila de handoff, não há 'Pediu atendente'", () => {
    render(<ConversationListItem {...baseProps({ waitingHumanLeadIds: new Set(["outro-lead"]) })} />);
    expect(screen.queryByText("Pediu atendente")).not.toBeInTheDocument();
  });

  it("selo 'IA' quando a última mensagem saiu do Copilot", () => {
    render(
      <ConversationListItem
        {...baseProps({
          contact: contact({ last_message_direction: "outgoing", last_message_sent_source: "copilot" }),
        })}
      />,
    );
    expect(screen.getByTitle("A última mensagem foi do Copilot")).toHaveTextContent("IA");
  });

  it("mensagem manual de saída continua prefixada com 'Você:'", () => {
    render(<ConversationListItem {...baseProps({ contact: contact({ last_message_direction: "outgoing" }) })} />);
    expect(screen.getByText("Você:")).toBeInTheDocument();
    expect(screen.queryByTitle("A última mensagem foi do Copilot")).not.toBeInTheDocument();
  });
});

describe("ConversationListItem — responsável do lead no lugar da caixa", () => {
  const caixa = { id: "inst-1", nome: "Riofix", kind: "whatsapp" as const };

  it("com dono: mostra o nome curto, e não o nome da caixa", () => {
    render(
      <ConversationListItem
        {...baseProps({ caixa, responsavel: { nome: "Ana S.", nomeCompleto: "Ana Paula Souza" } })}
      />,
    );
    expect(screen.getByText("Ana S.")).toBeInTheDocument();
    expect(screen.queryByText("Riofix")).not.toBeInTheDocument();
    expect(screen.queryByText("Sem responsável")).not.toBeInTheDocument();
  });

  it("tooltip traz o responsável completo e a caixa", () => {
    render(
      <ConversationListItem
        {...baseProps({ caixa, responsavel: { nome: "Ana S.", nomeCompleto: "Ana Paula Souza" } })}
      />,
    );
    expect(screen.getByTestId("linha-responsavel")).toHaveAttribute(
      "title",
      "Responsável: Ana Paula Souza · Caixa: Riofix",
    );
  });

  it("sem dono (null): 'Sem responsável' discreto", () => {
    render(<ConversationListItem {...baseProps({ caixa, responsavel: null })} />);
    const rotulo = screen.getByText("Sem responsável");
    expect(rotulo).toHaveClass("italic", "opacity-60");
    expect(screen.getByTestId("linha-responsavel")).toHaveAttribute(
      "title",
      "Responsável: Sem responsável · Caixa: Riofix",
    );
  });

  it("sem lead / pendente (undefined): segmento não renderiza", () => {
    render(
      <ConversationListItem
        {...baseProps({ caixa, contact: contact({ lead_id: null }), responsavel: undefined })}
      />,
    );
    expect(screen.queryByTestId("linha-responsavel")).not.toBeInTheDocument();
    expect(screen.queryByText("Sem responsável")).not.toBeInTheDocument();
    expect(screen.queryByText("Riofix")).not.toBeInTheDocument();
  });

  it("modo unificado sem dono a afirmar (undefined): volta bolinha + nome da caixa", () => {
    render(
      <ConversationListItem
        {...baseProps({ caixa, contact: contact({ lead_id: null }), responsavel: undefined, variasCaixas: true })}
      />,
    );
    expect(screen.queryByTestId("linha-responsavel")).not.toBeInTheDocument();
    const seg = screen.getByTestId("linha-caixa");
    expect(seg).toHaveAttribute("title", "Caixa: Riofix");
    expect(seg).toHaveTextContent("Riofix");
    expect((seg.firstElementChild as HTMLElement).style.backgroundColor).not.toBe("");
    expect(screen.queryByText("Sem responsável")).not.toBeInTheDocument();
  });

  it("etapa continua igual ao lado do responsável", () => {
    render(
      <ConversationListItem
        {...baseProps({ caixa, stageLabel: "Vendido", responsavel: { nome: "Ana S.", nomeCompleto: "Ana Souza" } })}
      />,
    );
    expect(screen.getByTitle("Etapa: Vendido")).toHaveTextContent("Vendido");
  });

  it("uma caixa: bolinha neutra; várias caixas: bolinha na cor da caixa", () => {
    const { rerender } = render(
      <ConversationListItem {...baseProps({ caixa, responsavel: null })} />,
    );
    const bolinha = () => screen.getByTestId("linha-responsavel").firstElementChild as HTMLElement;
    expect(bolinha()).toHaveClass("bg-current");
    expect(bolinha().style.backgroundColor).toBe("");

    rerender(<ConversationListItem {...baseProps({ caixa, responsavel: null, variasCaixas: true })} />);
    expect(bolinha()).not.toHaveClass("bg-current");
    expect(bolinha().style.backgroundColor).not.toBe("");
  });

  it("preserva o fio 'também em X'", () => {
    render(
      <ConversationListItem
        {...baseProps({
          caixa,
          responsavel: { nome: "Ana S.", nomeCompleto: "Ana Souza" },
          tambemEm: [{ id: "inst-2", nome: "Oficial", kind: "whatsapp" as const }],
        })}
      />,
    );
    expect(screen.getByText("também em Oficial")).toBeInTheDocument();
  });
});
