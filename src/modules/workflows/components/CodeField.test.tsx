import { createRef, useState } from "react";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CodeField, type CodeFieldHandle } from "./CodeField";
import { CODE_SOURCE_MAX_BYTES } from "@/types/workflow";

/**
 * O CodeField é controlado: sem um dono do estado, o `insertAtCursor` não teria
 * como provar que o valor novo volta para o campo.
 */
function Harness({
  inicial,
  fieldRef,
}: {
  inicial: string;
  fieldRef: React.Ref<CodeFieldHandle>;
}) {
  const [value, setValue] = useState(inicial);
  return <CodeField ref={fieldRef} language="json" value={value} onChange={setValue} />;
}

function renderField(inicial: string) {
  const fieldRef = createRef<CodeFieldHandle>();
  render(<Harness inicial={inicial} fieldRef={fieldRef} />);
  const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
  return { fieldRef, textarea };
}

describe("CodeField", () => {
  it("insere no ponto do cursor, não no fim, e reposiciona o cursor", async () => {
    // 0:{  1:"  2:a  3:"  4::  5:(espaço)  6:1  7:}
    const { fieldRef, textarea } = renderField('{"a": 1}');
    textarea.setSelectionRange(6, 6);

    act(() => fieldRef.current!.insertAtCursor("{{nome}}"));

    expect(textarea.value).toBe('{"a": {{nome}}1}');
    await waitFor(() => expect(textarea.selectionStart).toBe(14));
    expect(textarea.selectionEnd).toBe(14);
  });

  it("substitui a seleção quando há texto selecionado", () => {
    const { fieldRef, textarea } = renderField('{"a": 1}');
    textarea.setSelectionRange(6, 7);

    act(() => fieldRef.current!.insertAtCursor("{{score}}"));

    expect(textarea.value).toBe('{"a": {{score}}}');
  });

  it("aceita o drop de uma variável arrastada do VariableInserter", () => {
    const { textarea } = renderField('{"a": }');
    textarea.setSelectionRange(6, 6);

    fireEvent.drop(textarea, {
      dataTransfer: { getData: () => "{{telefone}}" },
    });

    expect(textarea.value).toBe('{"a": {{telefone}}}');
  });

  it("ignora o drop de texto que não é variável", () => {
    const { textarea } = renderField('{"a": 1}');
    textarea.setSelectionRange(6, 6);

    fireEvent.drop(textarea, {
      dataTransfer: { getData: () => "https://exemplo.com/pedidos" },
    });

    expect(textarea.value).toBe('{"a": 1}');
  });

  it("conta os caracteres em tom neutro abaixo do teto", () => {
    render(<CodeField language="json" value={"a".repeat(100)} onChange={vi.fn()} />);

    const contador = screen.getByText(/caracteres/);
    expect(contador.className).toContain("text-muted-foreground");
    expect(contador.className).not.toContain("text-destructive");
  });

  it("marca o contador em destructive acima do teto por nó", () => {
    render(
      <CodeField
        language="json"
        value={"a".repeat(CODE_SOURCE_MAX_BYTES + 1)}
        onChange={vi.fn()}
      />,
    );

    const contador = screen.getByText(/caracteres/);
    expect(contador.className).toContain("text-destructive");
    expect(contador.textContent).toContain("64 KB");
  });

  it("mede o teto em bytes UTF-8, não em caracteres", () => {
    // 40.000 caracteres acentuados = 80.000 bytes: passa do teto mesmo com
    // `length` bem abaixo dele.
    render(<CodeField language="json" value={"é".repeat(40_000)} onChange={vi.fn()} />);

    expect(screen.getByText(/caracteres/).className).toContain("text-destructive");
  });

  it("rotula e placeholda cada linguagem — o HTTPS escreve a requisição em JSON", () => {
    const { unmount } = render(<CodeField language="javascript" value="" onChange={vi.fn()} />);
    expect(screen.getByLabelText("Código JavaScript")).toBeInTheDocument();
    unmount();

    render(<CodeField language="https" value="" onChange={vi.fn()} />);
    const campo = screen.getByLabelText("Código HTTPS") as HTMLTextAreaElement;
    expect(campo.dataset.language).toBe("https");
    expect(campo.placeholder).toContain('"url": "https://');
  });

  it("um placeholder explícito vence o da linguagem", () => {
    render(
      <CodeField language="json" value="" onChange={vi.fn()} placeholder="meu placeholder" />,
    );

    expect((screen.getByRole("textbox") as HTMLTextAreaElement).placeholder).toBe(
      "meu placeholder",
    );
  });
});
