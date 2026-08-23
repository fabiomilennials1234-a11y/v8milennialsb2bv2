/**
 * TemplateNodeConfig — o painel do nó `send_whatsapp_template` (issue #1688).
 *
 * Verifica COMPORTAMENTO observável pela interface do módulo: o que o painel
 * mostra e o que ele grava no nó, dado um número e uma listagem de templates.
 * Nada aqui olha estrutura interna — os helpers de `template-send` entram REAIS,
 * porque é exatamente a regra deles (ordem, pendência, forma) que precisa valer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const instanciasMock = vi.fn();
const templatesMock = vi.fn();

vi.mock("@/modules/communication/hooks/useWhatsAppInstances", () => ({
  useWhatsAppInstances: () => instanciasMock(),
  useWhatsAppInstancesWithAgent: () => ({ data: [] }),
  useWhatsAppInstancesForUser: () => ({ data: [] }),
}));

vi.mock("@/modules/communication/hooks/useNotificameTemplates", () => ({
  useNotificameTemplates: (args: unknown) => templatesMock(args),
  notificameTemplatesQueryKey: () => ["notificame-templates"],
  useCreateNotificameTemplate: () => ({ mutateAsync: vi.fn() }),
}));

// Puxa tags/campos personalizados/membro atual — não é o que está sob teste.
vi.mock("@/modules/workflows/components/VariableInserter", () => ({
  VariableInserter: () => null,
}));

import { TemplateNodeConfig } from "@/modules/workflows/components/action-configs";
import type { ActionNodeData } from "@/types/workflow";

const INSTANCIA_OFICIAL = { id: "inst-oficial", provider: "notificame", status: "connected" };
const INSTANCIA_CHIP = { id: "inst-chip", provider: "uazapi", status: "connected" };

/** Corpo com DUAS variáveis nomeadas, na ordem em que aparecem no texto. */
const COMPONENTES_COM_VARIAVEIS = [
  { type: "BODY", text: "Olá {{nome}}, seu pedido {{pedido}} saiu para entrega." },
];

function renderPainel(data: Partial<ActionNodeData>, onUpdate = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const full = {
    type: "action",
    actionType: "send_whatsapp_template",
    label: "Template",
    ...data,
  } as ActionNodeData;
  render(
    <QueryClientProvider client={qc}>
      <TemplateNodeConfig data={full} onUpdate={onUpdate} />
    </QueryClientProvider>,
  );
  return onUpdate;
}

beforeEach(() => {
  vi.clearAllMocks();
  instanciasMock.mockReturnValue({ data: [INSTANCIA_OFICIAL, INSTANCIA_CHIP] });
  templatesMock.mockReturnValue({ data: [], isLoading: false, error: null });
});

describe("TemplateNodeConfig", () => {
  it("exige o número de saída antes de listar qualquer coisa", () => {
    renderPainel({});
    expect(screen.getByText(/Escolha primeiro o número de saída/i)).toBeInTheDocument();
    // Sem número não há de quem perguntar: a listagem nem é acionada.
    expect(templatesMock).toHaveBeenCalledWith({ instanceId: null });
  });

  it("recusa um número que não tem templates, e não pergunta à conta", () => {
    renderPainel({ whatsappInstanceId: "inst-chip" });
    expect(screen.getByText(/não é o canal oficial/i)).toBeInTheDocument();
    expect(templatesMock).toHaveBeenCalledWith({ instanceId: null });
  });

  it("lista APENAS os templates aprovados", () => {
    templatesMock.mockReturnValue({
      isLoading: false,
      error: null,
      data: [
        { name: "aprovado_um", status: "APPROVED", language: "pt_BR", components: [] },
        { name: "em_analise", status: "PENDING", language: "pt_BR", components: [] },
        { name: "recusado", status: "REJECTED", language: "pt_BR", components: [] },
      ],
    });
    renderPainel({ whatsappInstanceId: "inst-oficial" });

    // Um template em análise não é opção, é espera. Com só um aprovado, o
    // painel mostra o seletor — e não o vazio de "nenhum aprovado".
    expect(screen.queryByText(/Nenhum template aprovado/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Template aprovado")).toBeInTheDocument();
  });

  it("trata conta só com template não-aprovado como conta sem template", () => {
    // O CONTROLE POSITIVO do caso acima: se o filtro de APPROVED sumisse, este
    // teste ficaria verde por engano lá e vermelho aqui.
    templatesMock.mockReturnValue({
      isLoading: false,
      error: null,
      data: [
        { name: "em_analise", status: "PENDING", language: "pt_BR", components: [] },
        { name: "recusado", status: "REJECTED", language: "pt_BR", components: [] },
      ],
    });
    renderPainel({ whatsappInstanceId: "inst-oficial" });

    expect(screen.getByText(/Nenhum template aprovado/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Template aprovado")).not.toBeInTheDocument();
  });

  it("avisa quando o template gravado no nó deixou de estar aprovado", () => {
    templatesMock.mockReturnValue({
      isLoading: false,
      error: null,
      data: [{ name: "outro", status: "APPROVED", language: "pt_BR", components: [] }],
    });
    renderPainel({
      whatsappInstanceId: "inst-oficial",
      templateName: "sumiu_da_meta",
      templateComponents: [],
    });
    expect(screen.getByText(/não está mais aprovado/i)).toBeInTheDocument();
  });

  it("mostra um campo por variável, NA ORDEM DO TEXTO", () => {
    templatesMock.mockReturnValue({ data: [], isLoading: false, error: null });
    renderPainel({
      whatsappInstanceId: "inst-oficial",
      templateName: "pedido_saiu",
      templateComponents: COMPONENTES_COM_VARIAVEIS,
      // ⚠️ Gravado FORA de ordem de propósito: a Meta casa parâmetro por
      // POSIÇÃO e não confere nome. Se o painel desenhasse pela ordem do
      // objeto, o vendedor mapearia o campo errado sem nenhum erro aparecer.
      templateVariables: { pedido: "{{numero_pedido}}", nome: "{{nome}}" },
    });

    const campos = screen.getAllByLabelText(/^Valor de /);
    expect(campos.map((c) => c.getAttribute("aria-label"))).toEqual([
      "Valor de {{nome}}",
      "Valor de {{pedido}}",
    ]);
  });

  it("não pede variável nenhuma quando o template não tem", () => {
    renderPainel({
      whatsappInstanceId: "inst-oficial",
      templateName: "aviso_simples",
      templateComponents: [{ type: "BODY", text: "Estamos fechados hoje." }],
    });
    expect(screen.getByText(/não tem variáveis/i)).toBeInTheDocument();
    expect(screen.queryAllByLabelText(/^Valor de /)).toHaveLength(0);
  });

  it("avisa que link variável de botão não é preenchível pela automação", () => {
    renderPainel({
      whatsappInstanceId: "inst-oficial",
      templateName: "com_botao",
      templateComponents: [
        { type: "BODY", text: "Confira." },
        {
          type: "BUTTONS",
          buttons: [{ type: "URL", text: "Ver pedido", url: "https://x.com/{{1}}" }],
        },
      ],
    });
    expect(screen.getByText(/não preenche link de botão/i)).toBeInTheDocument();
  });
});
