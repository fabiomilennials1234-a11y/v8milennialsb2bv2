import { Shield, ShieldOff, Key } from "lucide-react";
import type { ApiEndpoint } from "@/lib/api-docs/types";

interface ApiAuthSectionProps {
  endpoint: ApiEndpoint;
}

const AUTH_ICONS = {
  "api-key": <Key className="w-4 h-4 text-amber-400" />,
  bearer: <Shield className="w-4 h-4 text-blue-400" />,
  none: <ShieldOff className="w-4 h-4 text-zinc-400" />,
};

export function ApiAuthSection({ endpoint }: ApiAuthSectionProps) {
  const { auth } = endpoint;

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
        {AUTH_ICONS[auth.type]}
        Autenticacao
      </h4>
      <div className="p-3 rounded-lg border border-border bg-muted/20">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-mono px-2 py-0.5 rounded bg-muted/50 text-muted-foreground uppercase">
            {auth.type === "none" ? "Sem autenticacao" : auth.type}
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
