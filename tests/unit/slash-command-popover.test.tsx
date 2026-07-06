/**
 * SlashCommandPopover — test suite.
 *
 * Cobre a integridade do dropdown de templates (botão "Template rápido" / Ctrl+K):
 *  1. Lista templates filtrados por command / display_name
 *  2. Filtro por command prefix
 *  3. Filtro por display_name (substring)
 *  4. onSelect ao clicar
 *  5. Empty-state quando a org não tem templates (fix: era beco sem saída, retornava null)
 *  6. Empty-state quando a busca não casa nenhum template
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SlashCommandPopover } from "@/modules/communication/components/chat/SlashCommandPopover";
import type { MessageTemplate } from "@/modules/communication/hooks/useMessageTemplates";

const tpl = (over: Partial<MessageTemplate>): MessageTemplate => ({
  id: crypto.randomUUID(),
  organization_id: "org-1",
  command: "ola",
  display_name: "Saudação",
  body: "Olá {{name}}!",
  media_url: null,
  media_type: "text",
  created_by: "u1",
  updated_at: "",
  created_at: "",
  ...over,
});

describe("SlashCommandPopover", () => {
  let onSelect: ReturnType<typeof vi.fn>;
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSelect = vi.fn();
    onClose = vi.fn();
    // jsdom não implementa scrollIntoView (usado no efeito de navegação ↑↓)
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  const templates = [
    tpl({ command: "ola", display_name: "Saudação" }),
    tpl({ command: "preco", display_name: "Tabela de preço" }),
  ];

  it("lista todos os templates com query vazia '/'", () => {
    render(<SlashCommandPopover query="/" templates={templates} onSelect={onSelect} onClose={onClose} />);
    expect(screen.getByText("/ola")).toBeInTheDocument();
    expect(screen.getByText("/preco")).toBeInTheDocument();
  });

  it("filtra por prefixo de command", () => {
    render(<SlashCommandPopover query="/pre" templates={templates} onSelect={onSelect} onClose={onClose} />);
    expect(screen.getByText("/preco")).toBeInTheDocument();
    expect(screen.queryByText("/ola")).not.toBeInTheDocument();
  });

  it("filtra por substring do display_name", () => {
    render(<SlashCommandPopover query="/saud" templates={templates} onSelect={onSelect} onClose={onClose} />);
    expect(screen.getByText("/ola")).toBeInTheDocument();
    expect(screen.queryByText("/preco")).not.toBeInTheDocument();
  });

  it("chama onSelect ao clicar num template", () => {
    render(<SlashCommandPopover query="/" templates={templates} onSelect={onSelect} onClose={onClose} />);
    fireEvent.click(screen.getByText("/ola"));
    expect(onSelect).toHaveBeenCalledWith(templates[0]);
  });

  // ─── Empty-states (fix: antes retornava null → beco sem saída) ───
  it("mostra empty-state quando a org não tem templates", () => {
    render(<SlashCommandPopover query="/" templates={[]} onSelect={onSelect} onClose={onClose} />);
    expect(screen.getByText(/Nenhum template cadastrado/i)).toBeInTheDocument();
  });

  it("mostra empty-state com a query quando nada casa", () => {
    render(<SlashCommandPopover query="/xyz" templates={templates} onSelect={onSelect} onClose={onClose} />);
    expect(screen.getByText(/Nenhum template para "xyz"/i)).toBeInTheDocument();
  });
});
