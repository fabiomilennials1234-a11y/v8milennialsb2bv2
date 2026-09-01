/**
 * A anotação da PESSOA dentro do painel do Negócio — o buraco do celular.
 *
 * ── O QUE ESTE ARQUIVO GUARDA ─────────────────────────────────────────────
 * `leads.notes` é o campo de texto mais preenchido do produto: 29.190 leads
 * (74,9%), contra 379 em `pipeline_entries.notes` e 3.094 comentários vivos.
 * Ele só era desenhado pela coluna da esquerda do painel (`LeadCardAside` →
 * `LeadCardNotes`), e abaixo de 768px essa coluna NÃO é montada — o
 * `DealCardPanel` chama `conteudo(false)`. Resultado: no celular o texto que a
 * equipe mais escreve não existia em lugar nenhum do Negócio.
 *
 * É o mesmo buraco que o slot `etiquetas` já tapava, e a correção é simétrica.
 *
 * ── A ASSERÇÃO QUE VALE MAIS ─────────────────────────────────────────────
 * **Nunca as duas caixas ao mesmo tempo.** Com a coluna na tela, repetir a
 * anotação da pessoa dentro do negócio daria dois campos gravando na MESMA
 * coluna do banco a 30cm um do outro — e `leads.notes` é campo único, sem
 * histórico: o texto que o perdedor sobrescrevesse não teria como voltar. Quem
 * decide é o painel (`comLead`), e é por isso que o slot é opcional.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { DealCardAnotacaoDoLead } from "@/modules/leads/components/deal-card/DealCardAnotacaoDoLead";

describe("Anotação da pessoa no painel do Negócio", () => {
  it("mostra o texto que já estava gravado em leads.notes", () => {
    render(<DealCardAnotacaoDoLead nome="Weberth Souza" valor="Cliente só atende de tarde." />);

    expect(screen.getByRole("textbox", { name: /anotação de weberth/i })).toHaveValue(
      "Cliente só atende de tarde.",
    );
  });

  it("o rótulo diz de QUEM é a anotação — pelo primeiro nome", () => {
    render(<DealCardAnotacaoDoLead nome="Weberth Souza" valor="" />);
    expect(screen.getByText("Anotação de Weberth")).toBeInTheDocument();
  });

  it("sem nome conhecido, degrada para um rótulo genérico em vez de 'Anotação de '", () => {
    render(<DealCardAnotacaoDoLead nome={null} valor="" />);
    expect(screen.getByText("Anotação da pessoa")).toBeInTheDocument();
  });

  /**
   * O aviso que impede a troca de caixa: a anotação do NEGÓCIO fica logo acima,
   * e as duas se parecem. Sem esta linha, escrever na errada é o desfecho
   * provável — e quem sobrescreve `leads.notes` não descobre.
   */
  it("avisa que o texto vale para todos os negócios da pessoa", () => {
    render(<DealCardAnotacaoDoLead nome="Weberth" valor="" />);
    expect(screen.getByText(/vale para todos os negócios dela/i)).toBeInTheDocument();
  });

  it("grava no blur, e só quando o texto MUDOU", () => {
    const onSalvar = vi.fn();
    render(<DealCardAnotacaoDoLead nome="Weberth" valor="original" onSalvar={onSalvar} />);
    const caixa = screen.getByRole("textbox", { name: /anotação de weberth/i });

    // Foco perdido sem alterar nada: `leads.notes` não tem histórico, e um
    // update à toa ainda sujaria o lead_history com um field_updated vazio.
    fireEvent.blur(caixa);
    expect(onSalvar).not.toHaveBeenCalled();

    fireEvent.change(caixa, { target: { value: "novo texto" } });
    fireEvent.blur(caixa);
    expect(onSalvar).toHaveBeenCalledExactlyOnceWith("novo texto");
  });

  it("sem onSalvar a caixa fica só de leitura — não oferece o que não grava", () => {
    render(<DealCardAnotacaoDoLead nome="Weberth" valor="texto" />);
    expect(screen.getByRole("textbox", { name: /anotação de weberth/i })).toHaveAttribute("readonly");
  });

  it("acompanha o valor quando a query volta com outro lead", () => {
    const { rerender } = render(<DealCardAnotacaoDoLead nome="Weberth" valor="do Weberth" />);
    rerender(<DealCardAnotacaoDoLead nome="Thais" valor="da Thais" />);

    expect(screen.getByRole("textbox", { name: /anotação de thais/i })).toHaveValue("da Thais");
  });
});
