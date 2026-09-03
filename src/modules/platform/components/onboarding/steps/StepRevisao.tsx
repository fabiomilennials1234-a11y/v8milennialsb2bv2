import { CheckCircle, ArrowRight, MessageSquare, Users, UserPlus, GitBranch } from "lucide-react";
import type { OnboardingSuggestions } from "@/modules/platform/lib/onboarding-suggestions";

interface Props {
  suggestions: OnboardingSuggestions;
  onFinish: () => void;
}

const LAUNCH_ITEMS = [
  {
    icon: GitBranch,
    label: "Pipeline configurado",
    description: "Funil de vendas pronto para receber leads",
  },
  {
    icon: Users,
    label: "Equipe no sistema",
    description: "Membros adicionados e prontos para operar",
  },
  {
    icon: MessageSquare,
    label: "WhatsApp conectado",
    description: "Canal pronto para conversas e automações",
  },
  {
    icon: UserPlus,
    label: "Primeiro lead cadastrado",
    description: "Pipeline já tem seu primeiro contato",
  },
];

export function StepRevisao({ suggestions, onFinish }: Props) {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="flex justify-center">
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
              <CheckCircle className="w-10 h-10 text-primary" />
            </div>
            <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-primary flex items-center justify-center">
              <span className="text-[10px] font-bold text-primary-foreground">✓</span>
            </div>
          </div>
        </div>
        <div>
          <h3 className="text-2xl font-bold tracking-tight">Tudo pronto!</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto">
            Seu Torque está configurado para{" "}
            <strong className="text-foreground">{suggestions.profileLabel}</strong>. Hora de fechar negócios.
          </p>
        </div>
      </div>

      {/* What's set up */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
          O que foi configurado
        </p>
        <div className="space-y-2">
          {LAUNCH_ITEMS.map((item, i) => (
            <div
              key={i}
              className="flex items-center gap-3 p-3.5 rounded-xl bg-muted/20 border border-border/30"
            >
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <item.icon className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground truncate">{item.description}</p>
              </div>
              <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0 ml-auto" />
            </div>
          ))}
        </div>
      </div>

      {/* Configured pipelines from quiz */}
      {suggestions.pipelines.length > 0 && (
        <div className="space-y-1.5 bg-muted/20 rounded-xl p-4 border border-border/30">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Funis criados pelo quiz
          </p>
          {suggestions.pipelines.map((p, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
              <span className="text-muted-foreground">
                {p.name}{" "}
                <span className="text-muted-foreground/60">— {p.stages.length} etapas</span>
              </span>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={onFinish}
        className="w-full py-4 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-sm transition-all hover:opacity-90 flex items-center justify-center gap-2 shadow-lg shadow-primary/20"
      >
        Ir para o Torque
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}
