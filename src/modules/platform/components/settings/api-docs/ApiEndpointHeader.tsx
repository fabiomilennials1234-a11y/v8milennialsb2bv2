import { useState, useCallback } from "react";
import { Check, Copy } from "lucide-react";
import { MethodBadge } from "./MethodBadge";
import type { ApiEndpoint } from "@/lib/api-docs/types";

const PARTNER_API_BASE_URL = "https://api.torquecrm.com.br";
// REST API v1 pública: proxy do frontend (Nginx) reescreve /api/v1/* -> a edge
// function `api` do Supabase, deixando a URL limpa e branded (sem supabase.co).
const REST_API_BASE_URL = "https://torquecrm.com.br";

interface ApiEndpointHeaderProps {
  endpoint: ApiEndpoint;
  baseUrl: string;
}

export function ApiEndpointHeader({ endpoint, baseUrl }: ApiEndpointHeaderProps) {
  const [copied, setCopied] = useState(false);
  const resolvedBase =
    endpoint.category === "partner"
      ? PARTNER_API_BASE_URL
      : endpoint.category === "rest-api"
        ? REST_API_BASE_URL
        : baseUrl;
  const fullUrl = `${resolvedBase}${endpoint.path}`;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [fullUrl]);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-extrabold tracking-[-0.02em] text-foreground">{endpoint.name}</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
              v{endpoint.version}
            </span>
            {endpoint.deprecated && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning-strong">
                Descontinuado
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="group flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-3">
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
            <Check className="h-4 w-4 text-success-strong" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </button>
      </div>

      <p className="text-sm text-muted-foreground leading-relaxed">
        {endpoint.description}
      </p>
      {endpoint.deprecation_notice && (
        <p className="mt-1 text-xs text-warning-strong">{endpoint.deprecation_notice}</p>
      )}
    </div>
  );
}
