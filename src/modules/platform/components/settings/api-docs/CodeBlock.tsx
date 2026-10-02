import { useState, useCallback } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
}

export function CodeBlock({ code, language = "bash", className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <div className={cn("group relative overflow-hidden rounded-xl border border-tinta-line", className)}>
      <div className="flex items-center justify-between border-b border-tinta-line bg-tinta-3 px-4 py-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-tinta-muted">
          {language}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-[11px] text-tinta-muted transition-colors hover:text-tinta-foreground"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-success" />
              <span className="text-success">Copiado</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copiar</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto bg-tinta-2 p-4 text-[13px] leading-relaxed">
        <code className="whitespace-pre font-mono text-tinta-foreground/90">{code}</code>
      </pre>
    </div>
  );
}
