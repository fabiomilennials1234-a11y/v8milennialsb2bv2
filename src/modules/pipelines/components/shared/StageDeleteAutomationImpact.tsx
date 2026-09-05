import { AlertTriangle } from "lucide-react";

interface StageDeleteAutomationImpactProps {
  automations: number;
}

export function StageDeleteAutomationImpact({ automations }: StageDeleteAutomationImpactProps) {
  if (automations <= 0) return null;

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex items-start gap-2 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <span>
          <strong>
            {automations} {automations === 1 ? "automação será desativada" : "automações serão desativadas"}.
          </strong>{" "}
          A etapa continuará salva no histórico, mas deixará de ser um filtro válido.
          Revise cada configuração antes de reativar.
        </span>
      </div>
    </div>
  );
}
