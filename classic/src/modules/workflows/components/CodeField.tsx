/**
 * CodeField — o campo de fonte dos nós de código (JSON / JavaScript / HTTPS).
 *
 * É o `TemplateTextarea` sem a prévia. Lá, trocar `{{nome}}` por "João Silva"
 * ajuda a ler uma mensagem; aqui o valor é um programa, e a mesma troca mostra
 * um código que não é o que vai rodar. O realce de variável também fica de
 * fora: ele só entende `{{…}}` e picotaria a sintaxe da linguagem.
 *
 * Realce de sintaxe é `font-mono`, e é o que temos: o repo não carrega editor
 * de código, e Monaco (~2 MB + workers) num sidebar de 360 px é desproporcional.
 *
 * Sem `resize-none` de propósito — 10 linhas não mostram um payload de pedido
 * inteiro, e esticar o campo é o único jeito de ver o fonte sem sair do sidebar.
 *
 * É a **única** entrada de código do nó — o que está escrito aqui é o que roda.
 */

import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { CODE_SOURCE_MAX_BYTES } from "@/types/workflow";
import { cn } from "@/lib/utils";

export interface CodeFieldHandle {
  insertAtCursor(text: string): void;
}

export interface CodeFieldProps {
  value: string;
  onChange: (v: string) => void;
  /** `https` é o JSON que descreve a requisição inteira do nó HTTPS. */
  language: "json" | "javascript" | "https";
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}

const LANGUAGE_LABELS: Record<CodeFieldProps["language"], string> = {
  json: "JSON",
  javascript: "JavaScript",
  https: "HTTPS",
};

const PLACEHOLDERS: Record<CodeFieldProps["language"], string> = {
  json: '{\n  "nome": "{{nome}}",\n  "telefone": "{{telefone}}"\n}',
  javascript: "// O nó guarda o código, mas ainda não o executa.\nconst total = 0;",
  https:
    '{\n  "method": "POST",\n  "url": "https://api.exemplo.com/pedidos",\n  "headers": { "Authorization": "Bearer {{token}}" },\n  "body": { "lead": "{{nome}}" }\n}',
};

const MAX_KB = CODE_SOURCE_MAX_BYTES / 1024;

export const CodeField = forwardRef<CodeFieldHandle, CodeFieldProps>(
  ({ value, onChange, language, placeholder, rows = 10, disabled }, ref) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    /** Insere no ponto do cursor e devolve o cursor para depois do texto inserido. */
    const inserirEm = (pos: number, fim: number, text: string) => {
      onChange(value.slice(0, pos) + text + value.slice(fim));
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.selectionStart = ta.selectionEnd = pos + text.length;
        ta.focus();
      });
    };

    useImperativeHandle(ref, () => ({
      insertAtCursor(text: string) {
        const ta = textareaRef.current;
        if (!ta) {
          onChange(value + text);
          return;
        }
        inserirEm(ta.selectionStart, ta.selectionEnd, text);
      },
    }));

    /** Aceita os chips arrastados do VariableInserter. */
    const handleDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
      e.preventDefault();
      const text = e.dataTransfer.getData("text/plain");
      if (!text.startsWith("{{")) return;
      const ta = textareaRef.current;
      if (!ta) return;
      inserirEm(ta.selectionStart, ta.selectionStart, text);
    };

    // O teto é medido em bytes UTF-8, e não em caracteres: um fonte de 40.000
    // caracteres acentuados já passa de 64 KB com `length` bem abaixo dele.
    const bytes = useMemo(() => new TextEncoder().encode(value).length, [value]);
    const excedeu = bytes > CODE_SOURCE_MAX_BYTES;

    return (
      <div className="space-y-1">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? PLACEHOLDERS[language]}
          rows={rows}
          disabled={disabled}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          aria-label={`Código ${LANGUAGE_LABELS[language]}`}
          data-language={language}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="font-mono text-xs"
        />

        <p className={cn("text-[11px]", excedeu ? "text-destructive" : "text-muted-foreground")}>
          {value.length} caracteres
          {excedeu && ` · passa do limite de ${MAX_KB} KB por nó`}
        </p>
      </div>
    );
  },
);

CodeField.displayName = "CodeField";
