import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowUiSession } from "../../../../../tests/helpers/workflow-ui-session";
import { QuestionButtonsPanel } from "../sidebar-panels/QuestionButtonsPanel";
import type { QuestionButtonsNodeData } from "@/types/workflow";

const workflowId = "22222222-2222-4222-8222-222222222222";
const firstImage = { bucket: "workflow-question-images" as const, path: "11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333.png", mimeType: "image/png" as const, sizeBytes: 3 };
function Editor({ saved = true, initialImage }: { saved?: boolean; initialImage?: QuestionButtonsNodeData["image"] }) {
  const [data, setData] = useState<QuestionButtonsNodeData>({ type: "question_buttons", text: "Escolha", buttons: [{ id: "a", label: "Vendas" }], timeoutHours: 24, image: initialImage });
  return <WorkflowUiSession><QuestionButtonsPanel workflowId={saved ? workflowId : undefined} data={data} onUpdate={updates => setData({ ...data, ...updates })} /></WorkflowUiSession>;
}
afterEach(() => vi.unstubAllGlobals());

describe("Imagem fixa da pergunta", () => {
  it("permite descartar imagem pendente de importação explicitamente", () => {
    render(<Editor initialImage={null} />);
    fireEvent.click(screen.getByRole("button", {name:"Continuar sem imagem"}));
    expect(screen.queryByText("imagem privada válida")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", {name:"Continuar sem imagem"})).not.toBeInTheDocument();
  });
  it("preserva imagem anterior quando servidor rejeita substituição e mostra motivo", async () => {
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof init?.body === "string") return Response.json({ previewUrl: "https://storage.test/previous" });
      return Response.json({ error: "Arquivo inválido. Escolha uma imagem PNG, JPEG ou WebP." }, { status: 400 });
    });
    render(<Editor initialImage={firstImage} />);
    await screen.findByRole("img", { name: "Imagem da pergunta" });
    fireEvent.change(screen.getByLabelText("Imagem fixa"), { target: { files: [new File(["fake"], "foto.png", { type: "image/png" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Arquivo inválido");
    expect(screen.getByRole("img", { name: "Imagem da pergunta" })).toHaveAttribute("src", "https://storage.test/previous");
    expect(screen.getByRole("button", { name: "Remover imagem" })).toBeInTheDocument();
  });
  it("reabre imagem persistida e renova prévia expirada uma vez", async () => {
    const requests: unknown[] = [];
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({ previewUrl: `https://storage.test/preview-${requests.length}` });
    });
    render(<Editor initialImage={firstImage} />);
    const preview = await screen.findByRole("img", { name: "Imagem da pergunta" });
    expect(preview).toHaveAttribute("src", "https://storage.test/preview-1");
    fireEvent.error(preview);
    await waitFor(() => expect(preview).toHaveAttribute("src", "https://storage.test/preview-2"));
    expect(requests[0]).toEqual({ action: "preview", workflowId, path: firstImage.path });
    fireEvent.error(preview);
    expect(requests).toHaveLength(2);
  });
  it("recusa tipo não aceito e tamanho acima do orçamento antes de enviar", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    render(<Editor />);
    fireEvent.change(screen.getByLabelText("Imagem fixa"), { target: { files: [new File(["<svg>"], "logo.svg", { type: "image/svg+xml" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("PNG, JPEG ou WebP");
    fireEvent.change(screen.getByLabelText("Imagem fixa"), { target: { files: [new File([new Uint8Array(5 * 1024 * 1024 + 1)], "foto.png", { type: "image/png" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("5 MiB");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("substitui e remove referência sem apagar arquivo de uma execução anterior", async () => {
    const methods: string[] = [];
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      return Response.json({ image: { ...firstImage, path: firstImage.path.replace("33333333", methods.length === 1 ? "33333333" : "44444444") }, previewUrl: `https://storage.test/image-${methods.length}` });
    });
    render(<Editor />);
    const file = new File(["png"], "foto.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Imagem fixa"), { target: { files: [file] } });
    await screen.findByRole("button", { name: "Substituir imagem" });
    fireEvent.change(screen.getByLabelText("Imagem fixa"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole("img", { name: "Imagem da pergunta" })).toHaveAttribute("src", "https://storage.test/image-2"));
    fireEvent.click(screen.getByRole("button", { name: "Remover imagem" }));
    expect(screen.queryByRole("img", { name: "Imagem da pergunta" })).not.toBeInTheDocument();
    expect(methods).toEqual(["POST", "POST"]);
  });
  it("exige rascunho salvo antes de aceitar upload", () => {
    render(<Editor saved={false} />);
    expect(screen.getByRole("button", { name: "Adicionar imagem" })).toBeDisabled();
    expect(screen.getByText("Salve o rascunho para adicionar uma imagem.")).toBeInTheDocument();
  });
  it("envia arquivo pelo workflow salvo e apresenta prévia sem campo de URL", async () => {
    const requests: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      return Response.json({ image: firstImage, previewUrl: "https://storage.test/first?token=short" });
    });
    render(<Editor />);
    fireEvent.change(screen.getByLabelText("Imagem fixa"), { target: { files: [new File(["png"], "foto.png", { type: "image/png" })] } });
    expect(await screen.findByRole("img", { name: "Imagem da pergunta" })).toHaveAttribute("src", "https://storage.test/first?token=short");
    const form = requests[0].body as FormData;
    expect(form.get("workflowId")).toBe(workflowId);
    expect(form.get("file")).toBeInstanceOf(File);
    expect(screen.queryByRole("textbox", { name: /url/i })).not.toBeInTheDocument();
  });
});
