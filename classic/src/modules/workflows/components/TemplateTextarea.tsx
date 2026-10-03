import { useRef, forwardRef, useImperativeHandle } from "react";
import { Textarea } from "@/components/ui/textarea";

/** Valores de exemplo para cada variável — usados na prévia em tempo real. */
const PREVIEW_EXAMPLES: Record<string, string> = {
  "{{nome}}":               "João Silva",
  "{{primeiro_nome}}":      "João",
  "{{empresa}}":            "Tech Corp",
  "{{email}}":              "joao@techcorp.com",
  "{{telefone}}":           "(11) 99999-9999",
  "{{faturamento}}":        "R$ 50.000",
  "{{segmento}}":           "Software",
  "{{score}}":              "85",
  "{{rating}}":             "8",
  "{{origem}}":             "Site",
  "{{urgencia}}":           "Alta",
  "{{observacoes}}":        "Interessado no plano premium",
  "{{estagio}}":            "Novo lead",
  "{{data_reuniao}}":       "15/03/2026",
  "{{valor_proposta}}":     "R$ 2.500",
  "{{responsavel}}":        "Maria Santos",
  "{{responsavel_telefone}}": "(11) 98888-8888",
  "{{sdr}}":                "Carlos (SDR)",
  "{{closer}}":             "Ana (Vendedor)",
  "{{data_hoje}}":          new Date().toLocaleDateString("pt-BR"),
  "{{hora_atual}}":         new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
  "{{nome_empresa_crm}}":   "Minha Empresa",
};

export interface TemplateTextareaHandle {
  insertAtCursor: (text: string) => void;
}

interface TemplateTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}

export const TemplateTextarea = forwardRef<TemplateTextareaHandle, TemplateTextareaProps>(
  ({ value, onChange, placeholder, rows = 4 }, ref) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useImperativeHandle(ref, () => ({
      insertAtCursor(text: string) {
        const ta = textareaRef.current;
        if (!ta) {
          onChange(value + text);
          return;
        }
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const newValue = value.slice(0, start) + text + value.slice(end);
        onChange(newValue);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + text.length;
          ta.focus();
        });
      },
    }));

    /** Aceita drop de variáveis arrastadas do VariableInserter. */
    const handleDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
      e.preventDefault();
      const text = e.dataTransfer.getData("text/plain");
      if (!text.startsWith("{{")) return;
      const ta = textareaRef.current;
      if (!ta) return;
      const pos = ta.selectionStart;
      const newValue = value.slice(0, pos) + text + value.slice(pos);
      onChange(newValue);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = pos + text.length;
        ta.focus();
      });
    };

    /** Renderiza o template com variáveis destacadas em badges. */
    const renderHighlighted = () => {
      const parts = value.split(/(\{\{[^}]+\}\})/g);
      return parts.map((part, i) =>
        /^\{\{[^}]+\}\}$/.test(part) ? (
          <span
            key={i}
            className="inline-flex items-center bg-primary/15 text-primary border border-primary/30 rounded px-1 text-xs font-mono mx-0.5 leading-tight"
          >
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      );
    };

    /** Preview com valores de exemplo substituídos. */
    const previewText = value.replace(
      /\{\{([^}]+)\}\}/g,
      (match) => PREVIEW_EXAMPLES[match] ?? match,
    );

    return (
      <div className="space-y-2">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="font-mono text-sm resize-none"
        />

        {value && (
          <div className="rounded-md border bg-muted/20 p-2 space-y-2 text-sm">
            {/* Variáveis destacadas */}
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Variáveis detectadas
              </p>
              <div className="leading-relaxed break-words">{renderHighlighted()}</div>
            </div>
            {/* Prévia com valores de exemplo */}
            <div className="border-t pt-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Prévia (valores de exemplo)
              </p>
              <p className="text-foreground/80 leading-relaxed break-words">{previewText}</p>
            </div>
          </div>
        )}
      </div>
    );
  },
);

TemplateTextarea.displayName = "TemplateTextarea";
