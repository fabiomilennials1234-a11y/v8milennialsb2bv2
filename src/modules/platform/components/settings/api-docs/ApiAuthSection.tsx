import { Shield, ShieldOff, Key } from "lucide-react";
import type { ApiEndpoint } from "@/lib/api-docs/types";

interface ApiAuthSectionProps {
  endpoint: ApiEndpoint;
}

const AUTH_ICONS = {
  "api-key": <Key className="h-4 w-4 text-warning-strong" />,
  bearer: <Shield className="h-4 w-4 text-insights" />,
  none: <ShieldOff className="h-4 w-4 text-muted-foreground" />,
};

export function ApiAuthSection({ endpoint }: ApiAuthSectionProps) {
  const { auth } = endpoint;

  return (
    <div className="space-y-2">
      <h4 className="flex items-center gap-2 text-sm font-bold text-foreground">
        {AUTH_ICONS[auth.type]}
        Autenticação
      </h4>
      <div className="rounded-xl border border-border bg-muted/40 p-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs uppercase text-muted-foreground">
            {auth.type === "none" ? "Sem autenticação" : auth.type}
          </span>
          {auth.header && (
            <code className="text-xs font-mono text-foreground/70">{auth.header}</code>
          )}
        </div>
        <p className="text-[13px] text-muted-foreground leading-relaxed">
          {auth.description}
        </p>
      </div>
    </div>
  );
}
