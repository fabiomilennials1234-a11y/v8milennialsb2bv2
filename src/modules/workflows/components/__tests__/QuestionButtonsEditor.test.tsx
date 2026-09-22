import { OrgFeaturesProvider } from "@/contexts/OrgFeaturesContext";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { WorkflowUiSession } from "../../../../../tests/helpers/workflow-ui-session";
import AutomacoesEditor from "../../pages/AutomacoesEditor";
import { Toaster } from "sonner";

const image = { bucket: "workflow-question-images", path: "11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333.png", mimeType: "image/png", sizeBytes: 3 };

function mountEditor(enabled = true, connected = true, unified = false, legacy = false) {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal("DOMMatrixReadOnly", class { m22 = 1; });
    const nodes = [
      { id: "trigger", type: "trigger", position: { x: 0, y: 0 }, data: { type: "trigger", triggerType: "lead_created", config: {} } },
      { id: "question", type: "question_buttons", position: { x: 0, y: 200 }, data: { type: "question_buttons", text: "Como ajudar?", instanceId: "instance", buttons: [{ id: "sales", label: "Vendas" }, { id: "help", label: "Suporte" }], timeoutHours: 24 } },
      { id: "end", type: "end", position: { x: 400, y: 400 }, data: { type: "end" } },
    ];
    const edges = ["button:sales", "button:help", "other_response", "timeout", "send_failure"].filter(handle => connected || handle !== "timeout").map(sourceHandle => ({ id: sourceHandle, source: "question", target: "end", sourceHandle }));
    if (legacy) Object.assign(nodes[1], { type: "action", data: { type: "action", actionType: "send_whatsapp_menu", label: "Menu existente", menuType: "list", menuText: "Escolha", menuChoices: ["Vendas|sales", "Suporte|help"] } });
    edges.push({ id: "entry", source: "trigger", target: "question", sourceHandle: "default" });
    const workflow = { id: "flow", organization_id: "org", name: "Atendimento", is_active: false, trigger_type: "lead_created", trigger_config: {}, definition: { nodes, edges } };
    const saved: Array<{ definition: typeof workflow.definition }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const table = url.pathname.split("/").pop();
      if (table === "workflow-question-image") return Response.json({ image, previewUrl: "https://storage.test/preview?token=short-lived" });
      let rows: unknown[] = [];
      if (table === "team_members") rows = [{ id: "member", user_id: "user", role: "admin", organization_id: "org", is_active: true }];
      if (table === "organizations") rows = [{ id: "org", org_type: "crm", feature_flags: { workflow_question_buttons: enabled, unified_message_node: unified } }];
      if (table === "whatsapp_instances") rows = [{ id: "instance", instance_name: "TorqueSDR", provider: "uazapi", status: "connected" }];
      if (table === "workflows") {
        if (init?.method === "PATCH") saved.push(JSON.parse(String(init.body)));
        rows = [workflow];
      }
      if (table === "org_get_features_and_limits") return Response.json({ features: {}, limits: {}, plan_name: "Test" });
      if (url.pathname.includes("/rpc/")) return Response.json(true);
      const headers = new Headers(init?.headers);
      return Response.json(headers.get("accept")?.includes("vnd.pgrst.object") ? (rows[0] ?? null) : rows);
    }));
    render(<WorkflowUiSession userId="user"><OrgFeaturesProvider><MemoryRouter initialEntries={["/automacoes/flow"]}><Routes><Route path="/automacoes/:id" element={<AutomacoesEditor />} /></Routes><Toaster /></MemoryRouter></OrgFeaturesProvider></WorkflowUiSession>);
    return saved;
}

describe("Pergunta com botões — editor completo", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([false, true])("configura menu pelo tipo de Ação e limpa saídas (mensagem unificada: %s)", async unified => {
    const saved = mountEditor(true, true, unified);
    fireEvent.click(await screen.findByText("WhatsApp Menu"));
    const panel = await screen.findByRole("complementary", { name: "Configurar Ação" });
    fireEvent.keyDown(within(panel).getByRole("combobox", { name: "Tipo de Ação" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: /^Adicionar Tag$/ }));
    fireEvent.keyDown(within(panel).getByRole("combobox", { name: "Tipo de Ação" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: /^WhatsApp Menu$/ }));
    expect(await screen.findByLabelText("Botão 1")).toHaveValue("Opção 1");
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Escolha seu caminho" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].definition.nodes.find(node => node.id === "question")?.data).toMatchObject({ text: "Escolha seu caminho", timeoutHours: 24 });
    expect(saved[0].definition.edges).toEqual([{ id: "entry", source: "trigger", target: "question", sourceHandle: "default" }]);
  });
  it("preserva menu antigo ao abrir e salvar sem convertê-lo em pergunta", async () => {
    const saved = mountEditor(true, true, false, true);
    fireEvent.click(await screen.findByText("Menu existente"));
    expect(await screen.findByRole("complementary", { name: "Configurar Ação" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].definition.nodes.find(node => node.id === "question")).toMatchObject({ type: "action", data: { actionType: "send_whatsapp_menu", menuType: "list", menuChoices: ["Vendas|sales", "Suporte|help"] } });
  });
  it("persiste somente referência privada da imagem selecionada", async () => {
    const saved = mountEditor();
    fireEvent.click(await screen.findByText("WhatsApp Menu"));
    fireEvent.change(await screen.findByLabelText("Imagem fixa"), { target: { files: [new File(["png"], "foto.png", { type: "image/png" })] } });
    await screen.findByRole("img", { name: "Imagem da pergunta" });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].definition.nodes.find(node => node.id === "question")?.data).toMatchObject({ image });
    expect(JSON.stringify(saved[0].definition)).not.toContain("short-lived");
    expect(JSON.stringify(saved[0].definition)).not.toContain("https://storage.test");
  });
  it("salva rascunho após remover botão sem conservar conexão órfã", async () => {
    const saved = mountEditor();
    fireEvent.click(await screen.findByText("WhatsApp Menu"));
    fireEvent.click(await screen.findByRole("button", { name: "Remover Vendas" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].definition.nodes.find(node => node.id === "question")?.data.buttons).toEqual([{ id: "help", label: "Suporte" }]);
    expect(saved[0].definition.edges.filter(edge => edge.source === "question").map(edge => edge.sourceHandle)).toEqual(["button:help", "other_response", "timeout", "send_failure"]);
  });
  it("mantém rascunho importado desativado quando recurso está desligado", async () => {
    const saved = mountEditor(false);
    await screen.findByText("WhatsApp Menu");
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByRole("switch")).not.toBeChecked();
    expect(await screen.findByText("Pergunta com botões ainda não está liberada nesta organização.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(saved).toHaveLength(1));
  });
  it("salva pergunta incompleta como rascunho mas impede ativação sem destino", async () => {
    const saved = mountEditor(true, false);
    await screen.findByText("WhatsApp Menu");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByRole("switch")).not.toBeChecked();
    expect(await screen.findByText("Complete Pergunta com botões: destino da saída Sem resposta.")).toBeInTheDocument();
  });
});
