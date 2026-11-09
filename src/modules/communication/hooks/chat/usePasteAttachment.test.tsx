import { render } from "@testing-library/react";
import { useRef } from "react";
import { usePasteAttachment } from "./usePasteAttachment";

const onFile = vi.fn();

function Harness({ enabled = true }: { enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  usePasteAttachment(ref, enabled, onFile);
  return (
    <div>
      <div ref={ref}>
        <textarea data-testid="campo" />
      </div>
      <input data-testid="outro-campo" />
      <ul data-testid="lista" />
    </div>
  );
}

function paste(target: Element, { files = [] as File[], text = "" } = {}) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { files, items: [], getData: (t: string) => (t === "text/plain" ? text : "") },
  });
  target.dispatchEvent(event);
  return event;
}

const print = () => new File([new Uint8Array([1])], "image.png", { type: "image/png" });

beforeEach(() => onFile.mockClear());

describe("usePasteAttachment", () => {
  it("Ctrl+V de print no campo do composer anexa e não cola nada no texto", () => {
    const { getByTestId } = render(<Harness />);
    const event = paste(getByTestId("campo"), { files: [print()] });
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][0].type).toBe("image/png");
    expect(event.defaultPrevented).toBe(true);
  });

  it("foco solto na lista de mensagens também anexa", () => {
    const { getByTestId } = render(<Harness />);
    paste(getByTestId("lista"), { files: [print()] });
    expect(onFile).toHaveBeenCalledTimes(1);
  });

  it("texto colado segue normal: não anexa e não bloqueia", () => {
    const { getByTestId } = render(<Harness />);
    const event = paste(getByTestId("campo"), { text: "olá" });
    expect(onFile).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("imagem + texto (Excel/Word): cola o texto", () => {
    const { getByTestId } = render(<Harness />);
    const event = paste(getByTestId("campo"), { files: [print()], text: "A1\tB1" });
    expect(onFile).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("outro campo de texto da página não é sequestrado", () => {
    const { getByTestId } = render(<Harness />);
    paste(getByTestId("outro-campo"), { files: [print()] });
    expect(onFile).not.toHaveBeenCalled();
  });

  it("desabilitado (sem permissão de responder, gravando áudio): não ouve", () => {
    const { getByTestId } = render(<Harness enabled={false} />);
    paste(getByTestId("campo"), { files: [print()] });
    expect(onFile).not.toHaveBeenCalled();
  });

  it("desmontar remove o ouvinte", () => {
    const { getByTestId, unmount } = render(<Harness />);
    const alvo = getByTestId("lista");
    unmount();
    document.body.appendChild(alvo);
    paste(alvo, { files: [print()] });
    expect(onFile).not.toHaveBeenCalled();
  });
});
