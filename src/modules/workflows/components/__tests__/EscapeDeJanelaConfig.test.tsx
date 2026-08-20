/**
 * EscapeDeJanelaConfig — o campo de escape do nó de TEXTO (issue #1689).
 *
 * Verifica COMPORTAMENTO observável: quando o painel aparece, o que ele avisa
 * enquanto está vazio, e EM QUAIS CAMPOS ele grava. O último é o que importa
 * mais: o painel é o mesmo do nó de template, e se ele gravasse nas chaves
 * daquele nó, o escape sobrescreveria a configuração do outro assunto sem que
 * nada ficasse vermelho — os dois conjuntos convivem no mesmo `data`.
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

vi.mock("@/modules/workflows/components/VariableInserter", () => ({
  VariableInserter: () => null,
}));

import { EscapeDeJanelaConfig } from "@/modules/workflows/components/action-configs";
import type { ActionNodeData } from "@/types/workflow";

const OFICIAL = { id: "inst-oficial", provider: "notificame", status: "connected" };
const CHIP = { id: "inst-chip", provider: "uazapi", status: "connected" };

const TEMPLATE = {
  name: "retomada_agosto",
  id: "t1",
  language: "pt_BR",
  status: "APPROVED",
  category: "MARKETING",
  parameterFormat: "POSITIONAL",
  components: [{ type: "BODY", text: "Oi {{1}}, podemos retomar?" }],
};

function renderPainel(data: Partial<ActionNodeData>, onUpdate = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const full = {
    type: "action",
    actionType: "send_whatsapp",
    label: "Enviar texto",
    ...data,
  } as ActionNodeData;
  const r = render(
    <QueryClientProvider client={qc}>
      <EscapeDeJanelaConfig data={full} onUpdate={onUpdate} />
    </QueryClientProvider>,
  );
  return { onUpdate, container: r.container };
}

beforeEach(() => {
  vi.clearAllMocks();
  instanciasMock.mockReturnValue({ data: [OFICIAL, CHIP] });
  templatesMock.mockReturnValue({ data: [TEMPLATE], isLoading: false, error: null });
});

describe("quando o campo aparece", () => {
  it("não aparece num nó sem número escolhido", () => {
    const { container } = renderPainel({});
    expect(container).toBeEmptyDOMElement();
  });

  it("não aparece num nó de chip — lá não há janela, e a tela não muda", () => {
    const { container } = renderPainel({ whatsappInstanceId: "inst-chip" });
    expect(container).toBeEmptyDOMElement();
    // Nem chega a montar o painel de template: a conta nunca é consultada.
    expect(templatesMock).not.toHaveBeenCalled();
  });

  it("aparece quando o nó nomeia o canal oficial", () => {
    renderPainel({ whatsappInstanceId: "inst-oficial" });
    expect(screen.getByText(/janela de 24 horas estiver fechada/i)).toBeInTheDocument();
  });
});

describe("o aviso de consequência", () => {
  it("vazio: diz que o nó falha e a execução para", () => {
    renderPainel({ whatsappInstanceId: "inst-oficial" });
    expect(screen.getByText(/a execução do workflow para nesse ponto/i)).toBeInTheDocument();
  });

  it("configurado: o aviso some", () => {
    renderPainel({
      whatsappInstanceId: "inst-oficial",
      escapeTemplateName: "retomada_agosto",
    });
    expect(screen.queryByText(/a execução do workflow para nesse ponto/i)).toBeNull();
  });
});

describe("onde o painel grava", () => {
  it("nos campos do ESCAPE, nunca nos do nó de template", () => {
    const { onUpdate } = renderPainel({
      whatsappInstanceId: "inst-oficial",
      // O nó de texto pode carregar os dois assuntos ao mesmo tempo.
      templateName: "outro_template",
      escapeTemplateName: "retomada_agosto",
      escapeTemplateComponents: TEMPLATE.components as never,
    });

    // O painel remonta a escolha a partir do que o nó guardou; aqui basta
    // provar o namespace de escrita a partir de uma variável do template.
    const campo = screen.getByLabelText("Valor de {{1}}");
    campo.focus();
    // `onChange` do Input controlado — dispara via evento nativo do DOM.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(campo, "{{nome}}");
    campo.dispatchEvent(new Event("input", { bubbles: true }));

    expect(onUpdate).toHaveBeenCalled();
    const escrito = onUpdate.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(Object.keys(escrito)).toEqual(["escapeTemplateVariables"]);
    expect(escrito.escapeTemplateVariables).toEqual({ "1": "{{nome}}" });
  });

  it("a prévia usa o template do ESCAPE, não o do outro assunto", () => {
    renderPainel({
      whatsappInstanceId: "inst-oficial",
      templateName: "outro_template",
      escapeTemplateName: "retomada_agosto",
      escapeTemplateComponents: TEMPLATE.components as never,
    });
    expect(screen.getByText(/podemos retomar/i)).toBeInTheDocument();
  });
});
