import { useState, useCallback } from "react";
import { Check, Copy } from "lucide-react";
import { MethodBadge } from "./MethodBadge";
import type { ApiEndpoint } from "@/lib/api-docs/types";

interface ApiEndpointHeaderProps {
  endpoint: ApiEndpoint;
  baseUrl: string;
}

export function ApiEndpointHeader({ endpoint, baseUrl }: ApiEndpointHeaderProps) {
  const [copied, setCopied] = useState(false);
  const fullUrl = `${baseUrl}${endpoint.path}`;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [fullUrl]);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-foreground">{endpoint.name}</h2>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono text-muted-foreground bg-muted/40">
            v{endpoint.version}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 border border-border group">
        <MethodBadge method={endpoint.method} />
        <code className="flex-1 text-sm font-mono text-foreground truncate">
          {fullUrl}
        </code>
        <button
          onClick={handleCopy}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Copiar URL"
        >
          {copied ? (
            <Check className="w-4 h-4 text-emerald-400" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </button>
      </div>

      <p className="text-sm text-muted-foreground leading-relaxed">
        {endpoint.description}
      </p>
    </div>
  );
}
