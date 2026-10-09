/**
 * useClipboardImagePaste — o handler de onPaste dos compositores.
 *
 * Contrato: só intercepta (preventDefault) quando o clipboard traz imagem; texto
 * segue o caminho nativo do textarea; desabilitado (envio em andamento) não
 * intercepta nem troca o anexo; várias imagens → primeira + aviso.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, createEvent } from "@testing-library/react";

vi.mock("sonner", async (importOriginal) => {
  const real = await importOriginal<typeof import("sonner")>();
  return {
    ...real,
    toast: Object.assign(vi.fn(), { ...real.toast, info: vi.fn(), error: vi.fn() }),
  };
});

import { toast } from "sonner";
import { useClipboardImagePaste } from "@/modules/communication/hooks/chat/useClipboardImagePaste";

function Harness({ onImage, disabled }: { onImage: (f: File) => void; disabled?: boolean }) {
  const onPaste = useClipboardImagePaste({ onImage, disabled });
  return <textarea aria-label="campo" onPaste={onPaste} />;
}

function clipboard({ images = [] as File[], text = "" } = {}) {
  return {
    items: images.map((f) => ({ kind: "file", type: f.type, getAsFile: () => f })),
    files: images,
    getData: (fmt: string) => (fmt === "text/plain" ? text : ""),
  };
}

function paste(el: HTMLElement, data: ReturnType<typeof clipboard>) {
  const event = createEvent.paste(el, { clipboardData: data });
  fireEvent(el, event);
  return event;
}

const PNG = () => new File(["x"], "image.png", { type: "image/png" });

describe("useClipboardImagePaste", () => {
  beforeEach(() => {
    vi.mocked(toast.info).mockClear();
  });

  it("imagem → preventDefault + onImage com o arquivo", () => {
    const onImage = vi.fn();
    render(<Harness onImage={onImage} />);
    const ev = paste(screen.getByLabelText("campo"), clipboard({ images: [PNG()] }));
    expect(ev.defaultPrevented).toBe(true);
    expect(onImage).toHaveBeenCalledTimes(1);
    expect(onImage.mock.calls[0][0]).toBeInstanceOf(File);
    expect((onImage.mock.calls[0][0] as File).name).toMatch(/^print-\d{8}-\d{6}\.png$/);
  });

  it("texto → não intercepta, onImage não é chamado", () => {
    const onImage = vi.fn();
    render(<Harness onImage={onImage} />);
    const ev = paste(screen.getByLabelText("campo"), clipboard({ text: "olá" }));
    expect(ev.defaultPrevented).toBe(false);
    expect(onImage).not.toHaveBeenCalled();
  });

  it("texto + imagem → texto ganha, não intercepta", () => {
    const onImage = vi.fn();
    render(<Harness onImage={onImage} />);
    const ev = paste(screen.getByLabelText("campo"), clipboard({ images: [PNG()], text: "A1" }));
    expect(ev.defaultPrevented).toBe(false);
    expect(onImage).not.toHaveBeenCalled();
  });

  it("disabled → não intercepta nem troca o anexo", () => {
    const onImage = vi.fn();
    render(<Harness onImage={onImage} disabled />);
    const ev = paste(screen.getByLabelText("campo"), clipboard({ images: [PNG()] }));
    expect(ev.defaultPrevented).toBe(false);
    expect(onImage).not.toHaveBeenCalled();
  });

  it("várias imagens → anexa a primeira e avisa", () => {
    const onImage = vi.fn();
    render(<Harness onImage={onImage} />);
    const a = new File(["a"], "a.png", { type: "image/png" });
    const b = new File(["b"], "b.png", { type: "image/png" });
    paste(screen.getByLabelText("campo"), clipboard({ images: [a, b] }));
    expect(onImage).toHaveBeenCalledWith(a);
    expect(toast.info).toHaveBeenCalledWith("Só uma imagem por vez — anexei a primeira.");
  });

  it("uma imagem só → sem aviso", () => {
    render(<Harness onImage={vi.fn()} />);
    paste(screen.getByLabelText("campo"), clipboard({ images: [PNG()] }));
    expect(toast.info).not.toHaveBeenCalled();
  });
});
