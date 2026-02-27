import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";
import { ParamsTable } from "./ParamsTable";
import type { ApiParam } from "@/lib/api-docs/types";

interface ResponseBlockProps {
  example: Record<string, unknown>;
  fields: ApiParam[];
}

export function ResponseBlock({ example, fields }: ResponseBlockProps) {
  const [copied, setCopied] = useState(false);
  const jsonString = JSON.stringify(example, null, 2);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [jsonString]);

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-semibold text-foreground">Resposta</h4>

      <div className="relative rounded-lg border border-border overflow-hidden">
        <div className="flex items-center justify-between bg-emerald-500/10 px-4 py-2 border-b border-border">
          <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
            200 OK — JSON
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 mr-1" />
                Copiado
              </>
            ) : (
              <>
                <Copy className="h-3 w-3 mr-1" />
                Copiar
              </>
            )}
          </Button>
        </div>
        <pre className="p-4 overflow-x-auto bg-[hsl(var(--muted)/0.3)]">
          <code className="text-xs font-mono text-foreground/90 leading-relaxed whitespace-pre">
            {jsonString}
          </code>
        </pre>
      </div>

      {fields.length > 0 && (
        <ParamsTable params={fields} title="Campos da Resposta" />
      )}
    </div>
  );
}
