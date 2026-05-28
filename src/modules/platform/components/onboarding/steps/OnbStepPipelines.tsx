import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, ArrowRight, Workflow } from "lucide-react";
import { useOnboardingAdvance } from "@/modules/platform/hooks/useOnboardingAdvance";
import { toast } from "sonner";

interface PipelineResult {
  type: string;
  name: string;
  config?: Record<string, unknown>;
  stages?: { name: string; color: string }[];
  id?: string;
}

export function OnbStepPipelines() {
  const advance = useOnboardingAdvance();
  const [pipelines, setPipelines] = useState<PipelineResult[]>([]);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    applyPipelines();
  }, []);

  const applyPipelines = async () => {
    try {
      const result = await advance.mutateAsync({ action: "apply_pipelines" });
      setPipelines(result.pipelines ?? []);
      setApplied(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao aplicar pipelines");
    }
  };

  if (!applied) {
    return (
      <div className="space-y-4 text-center max-w-sm">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-amber-500" />
        <div>
          <h3 className="text-lg font-semibold">Configurando pipelines...</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Criando a estrutura ideal para sua operação.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-md w-full">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
          <Workflow className="w-5 h-5 text-amber-500" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Pipelines configurados!</h3>
          <p className="text-sm text-muted-foreground">
            Baseado no seu perfil, criamos esses pipelines:
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {pipelines.map((p, i) => (
          <div key={i} className="p-4 rounded-xl border border-border/60 bg-muted/20">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span className="text-sm font-medium">{p.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                {p.type === "custom_pipeline" ? "Custom" : "Padrão"}
              </span>
            </div>
            {p.stages && (
              <div className="flex flex-wrap gap-1.5">
                {p.stages.map((s, j) => (
                  <span
                    key={j}
                    className="text-[10px] px-2 py-0.5 rounded-full border"
                    style={{ borderColor: s.color, color: s.color }}
                  >
                    {s.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {pipelines.length === 0 && (
          <div className="p-4 rounded-xl border border-border/60 bg-muted/20 text-center">
            <p className="text-sm text-muted-foreground">Pipelines padrão aplicados.</p>
          </div>
        )}
      </div>

      <button
        onClick={() => {
          // State already advanced by apply_pipelines — just trigger refetch
          advance.reset();
        }}
        className="w-full py-3 px-4 rounded-xl bg-amber-500 text-white font-medium text-sm flex items-center justify-center gap-2 hover:bg-amber-600 transition-all"
      >
        Continuar
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}
