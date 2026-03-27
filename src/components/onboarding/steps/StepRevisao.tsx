import { CheckCircle, ArrowRight } from "lucide-react";
import type { OnboardingSuggestions } from "@/lib/onboarding-suggestions";

interface Props {
  suggestions: OnboardingSuggestions;
  onFinish: () => void;
}

export function StepRevisao({ suggestions, onFinish }: Props) {
  return (
    <div className="space-y-8 text-center">
      <div className="flex justify-center">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
          <CheckCircle className="w-8 h-8 text-primary" />
        </div>
      </div>

      <div>
        <h3 className="text-xl font-bold tracking-tight">Tudo pronto!</h3>
        <p className="text-sm text-muted-foreground mt-2">
          Configuramos o sistema para o perfil: <strong>{suggestions.profileLabel}</strong>
        </p>
      </div>

      <div className="text-left space-y-3 bg-muted/30 rounded-xl p-5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">O que foi configurado</p>
        <ul className="space-y-2">
          {suggestions.pipelines.map((p, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
              <span>Funil: <strong>{p.name}</strong> ({p.stages.length} etapas)</span>
            </li>
          ))}
          {suggestions.automations.filter((a) => a.enabled).map((a, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <div className="w-2 h-2 rounded-full bg-primary" />
              <span>Automação: <strong>{a.name}</strong></span>
            </li>
          ))}
        </ul>
      </div>

      <button
        onClick={onFinish}
        className="w-full py-3.5 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-sm transition-all hover:opacity-90 flex items-center justify-center gap-2"
      >
        Ir para a Central de Comando
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}
