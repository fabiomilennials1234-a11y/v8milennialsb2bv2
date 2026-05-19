import { useState } from "react";
import { ArrowRight, ArrowLeft, Loader2 } from "lucide-react";
import { useOnboardingAdvance } from "@/hooks/useOnboardingAdvance";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface QuestionConfig {
  key: string;
  title: string;
  subtitle: string;
  options: { value: string; label: string; description?: string }[];
}

const QUESTIONS: QuestionConfig[] = [
  {
    key: "perfil.sells",
    title: "O que você vende?",
    subtitle: "Isso nos ajuda a configurar seus pipelines",
    options: [
      { value: "produto", label: "Produto", description: "Venda de produtos físicos ou digitais" },
      { value: "servico", label: "Serviço", description: "Prestação de serviços ou consultoria" },
      { value: "ambos", label: "Ambos", description: "Produtos e serviços" },
    ],
  },
  {
    key: "perfil.segment",
    title: "Qual o segmento?",
    subtitle: "Vamos personalizar a experiência",
    options: [
      { value: "industria", label: "Indústria" },
      { value: "distribuidora", label: "Distribuição" },
      { value: "saas", label: "SaaS / Tecnologia" },
      { value: "consultoria", label: "Consultoria / Serviços" },
      { value: "agencia", label: "Agência" },
      { value: "outro", label: "Outro" },
    ],
  },
  {
    key: "estrutura",
    title: "Como é seu time comercial?",
    subtitle: "Isso define quais pipelines e permissões ativar",
    options: [
      { value: "solo", label: "Eu sozinho", description: "Operação solo, sem time" },
      { value: "team_no_sdr", label: "Time sem SDR", description: "Vendedores fazem prospecção e fechamento" },
      { value: "team_sdr_closer", label: "Time com SDR + Closer", description: "SDR qualifica, Closer fecha" },
    ],
  },
  {
    key: "processo",
    title: "Como funciona sua venda?",
    subtitle: "Marque o que se aplica",
    options: [
      { value: "meetings_proposals", label: "Reuniões + Propostas", description: "Agendo reuniões e envio propostas formais" },
      { value: "meetings_only", label: "Só reuniões", description: "Agendo reuniões mas fecho pelo WhatsApp" },
      { value: "direct", label: "Direto pelo WhatsApp", description: "Negocio e fecho tudo por mensagem" },
    ],
  },
];

function buildAnswers(selections: Record<string, string>): Record<string, Record<string, unknown>> {
  const answers: Record<string, Record<string, unknown>> = {
    perfil: {},
    estrutura: {},
    processo: {},
  };

  if (selections["perfil.sells"]) {
    answers.perfil.sells = selections["perfil.sells"];
  }
  if (selections["perfil.segment"]) {
    answers.perfil.segment = selections["perfil.segment"];
  }

  const estrutura = selections["estrutura"];
  if (estrutura === "solo") {
    answers.estrutura = { has_sdr: "false", has_closer: "false", team_size: "1" };
  } else if (estrutura === "team_no_sdr") {
    answers.estrutura = { has_sdr: "false", has_closer: "false", team_size: "2+" };
  } else if (estrutura === "team_sdr_closer") {
    answers.estrutura = { has_sdr: "true", has_closer: "true", team_size: "2+" };
  }

  const processo = selections["processo"];
  if (processo === "meetings_proposals") {
    answers.processo = { schedules_meeting: "true", uses_proposal: "true" };
  } else if (processo === "meetings_only") {
    answers.processo = { schedules_meeting: "true", uses_proposal: "false" };
  } else if (processo === "direct") {
    answers.processo = { schedules_meeting: "false", uses_proposal: "false" };
  }

  return answers;
}

export function OnbStepPerfil() {
  const advance = useOnboardingAdvance();
  const [currentQ, setCurrentQ] = useState(0);
  const [selections, setSelections] = useState<Record<string, string>>({});

  const question = QUESTIONS[currentQ];
  const selected = selections[question.key];
  const isLast = currentQ === QUESTIONS.length - 1;

  const handleSelect = (value: string) => {
    setSelections((prev) => ({ ...prev, [question.key]: value }));
  };

  const handleNext = async () => {
    if (!selected) return;

    if (isLast) {
      const answers = buildAnswers(selections);
      try {
        await advance.mutateAsync({ action: "advance_profile", payload: { answers } });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao salvar perfil");
      }
      return;
    }

    setCurrentQ((prev) => prev + 1);
  };

  return (
    <div className="space-y-6 max-w-md w-full">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-semibold text-amber-500">{currentQ + 1}</span>
        <span>de {QUESTIONS.length}</span>
      </div>

      <div>
        <h3 className="text-xl font-bold tracking-tight">{question.title}</h3>
        <p className="text-sm text-muted-foreground mt-1">{question.subtitle}</p>
      </div>

      <div className="space-y-2">
        {question.options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handleSelect(opt.value)}
            className={cn(
              "w-full text-left p-4 rounded-xl border transition-all",
              selected === opt.value
                ? "border-amber-500 bg-amber-500/5 ring-1 ring-amber-500/20"
                : "border-border/60 hover:border-border hover:bg-muted/30",
            )}
          >
            <span className="text-sm font-medium">{opt.label}</span>
            {opt.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
            )}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        {currentQ > 0 && (
          <button
            onClick={() => setCurrentQ((prev) => prev - 1)}
            className="px-4 py-2.5 rounded-xl border border-border/60 text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Voltar
          </button>
        )}
        <button
          onClick={handleNext}
          disabled={!selected || advance.isPending}
          className="flex-1 py-2.5 px-4 rounded-xl bg-amber-500 text-white font-medium text-sm flex items-center justify-center gap-2 hover:bg-amber-600 disabled:opacity-50 transition-all"
        >
          {advance.isPending ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</>
          ) : isLast ? (
            <>Confirmar</>
          ) : (
            <>Próximo <ArrowRight className="w-3.5 h-3.5" /></>
          )}
        </button>
      </div>
    </div>
  );
}
