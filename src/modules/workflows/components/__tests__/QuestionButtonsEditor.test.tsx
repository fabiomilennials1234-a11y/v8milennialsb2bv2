import { OrgFeaturesProvider } from "@/contexts/OrgFeaturesContext";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, vi, afterEach } from "vitest";
import { WorkflowUiSession } from "../../../../../tests/helpers/workflow-ui-session";
import AutomacoesEditor from "../../pages/AutomacoesEditor";
import { Toaster } from "sonner";

const image = { bucket: "workflow-question-images", path: "11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333.png", mimeType: "image/png", sizeBytes: 3 };

// Sem a chave da pergunta com botões em feature_flags: o WhatsApp Menu é
// padrão para toda org (a flag deixou de existir).
function mountEditor({ connected = true, unified = false, legacy = false } = {}) {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal("DOMMatrixReadOnly", class { m22 = 1; });
    const nodes = [
      { id: "trigger", type: "trigger", position: { x: 0, y: 0 }, data: { type: "trigger", triggerType: "lead_created", config: {} } },
      { id: "question", type: "question_buttons", position: { x: 0, y: 200 }, data: { type: "question_buttons", text: "Como ajudar?", instanceId: "instance", buttons: [{ id: "sales", label: "Vendas" }, { id: "help", label: "Suporte" }], timeoutHours: 24 } },
      { id: "end", type: "end", position: { x: 400, y: 400 }, data: { type: "end" } },
    ];
    const edges = ["button:sales", "button:help", "other_response", "timeout", "send_failure"].filter(handle => connected || handle !== "timeout").map(sourceHandle => ({ id: sourceHandle, source: "question", target: "end", sourceHandle }));
    if (legacy) {
      Object.assign(nodes[1], { type: "action", data: { type: "action", actionType: "send_whatsapp_menu", label: "Menu existente", menuType: "list", menuText: "Escolha", menuChoices: ["Vendas|sales", "Suporte|help"], whatsappInstanceId: "instance" } });
      // Menu legado tem uma única saída, sem handle.
      edges.splice(0, edges.length, { id: "legacy-out", source: "question", target: "end" } as typeof edges[number]);
    }
    edges.push({ id: "entry", source: "trigger", target: "question", sourceHandle: "default" });
    const workflow = { id: "flow", organization_id: "org", name: "Atendimento", is_active: false, trigger_type: "lead_created", trigger_config: {}, definition: { nodes, edges } };
    const saved: Array<{ definition: typeof workflow.definition }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const table = url.pathname.split("/").pop();
      if (table === "workflow-question-image") return Response.json({ image, previewUrl: "https://storage.test/preview?token=short-lived" });
      let rows: unknown[] = [];
      if (table === "team_members") rows = [{ id: "member", user_id: "user", role: "admin", organization_id: "org", is_active: true }];
      if (table === "organizations") rows = [{ id: "org", org_type: "crm", feature_flags: unified ? { unified_message_node: true } : {} }];
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
    const saved = mountEditor({ unified });
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
    const saved = mountEditor({ legacy: true });
    fireEvent.click(await screen.findByText("Menu existente"));
    const panel = await screen.findByRole("complementary", { name: "Configurar Ação" });
    // Cartão em leitura: texto e opções visíveis, nada editável do menu antigo.
    expect(within(panel).getByRole("heading", { name: "Menu no formato antigo" })).toBeInTheDocument();
    expect(within(panel).getByText("Escolha")).toBeInTheDocument();
    expect(within(panel).getByRole("list", { name: "Opções do menu" })).toHaveTextContent("VendasSuporte");
    expect(within(panel).queryByLabelText("Mensagem")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].definition.nodes.find(node => node.id === "question")).toMatchObject({ type: "action", data: { actionType: "send_whatsapp_menu", menuType: "list", menuChoices: ["Vendas|sales", "Suporte|help"] } });
  });
  it("converte menu antigo em pergunta: preserva texto e botões, remove saída sem handle e desfaz", async () => {
    const saved = mountEditor({ legacy: true });
    fireEvent.click(await screen.findByText("Menu existente"));
    fireEvent.click(await screen.findByRole("button", { name: "Converter em pergunta com botões" }));
    expect(await screen.findByLabelText("Mensagem")).toHaveValue("Escolha");
    expect(screen.getByLabelText("Botão 1")).toHaveValue("Vendas");
    expect(screen.getByLabelText("Botão 2")).toHaveValue("Suporte");
    expect(await screen.findByText(/religue as saídas de cada resposta/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    const converted = saved[0].definition.nodes.find(node => node.id === "question");
    expect(converted).toMatchObject({ type: "question_buttons", data: { type: "question_buttons", label: "Menu existente", text: "Escolha", instanceId: "instance", timeoutHours: 24 } });
    expect((converted?.data as { buttons: { label: string }[] }).buttons.map(button => button.label)).toEqual(["Vendas", "Suporte"]);
    expect(saved[0].definition.edges.map(edge => edge.id)).toEqual(["entry"]);

    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(saved[1].definition.nodes.find(node => node.id === "question")).toMatchObject({ type: "action", data: { actionType: "send_whatsapp_menu", menuChoices: ["Vendas|sales", "Suporte|help"] } });
    expect(saved[1].definition.edges.map(edge => edge.id)).toEqual(["legacy-out", "entry"]);
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
  it("ativa pergunta completa em org sem a chave de feature flag", async () => {
    mountEditor();
    await screen.findByText("WhatsApp Menu");
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(screen.getByRole("switch")).toBeChecked());
    expect(screen.queryByText(/ainda não está liberada/i)).not.toBeInTheDocument();
  });
  it("salva pergunta incompleta como rascunho mas impede ativação sem destino", async () => {
    const saved = mountEditor({ connected: false });
    await screen.findByText("WhatsApp Menu");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByRole("switch")).not.toBeChecked();
    expect(await screen.findByText("Complete Pergunta com botões: destino da saída Sem resposta.")).toBeInTheDocument();
  });
});
