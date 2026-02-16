/**
 * Step: Funil de Confirmação
 *
 * Configura o comportamento do confirmador em cada etapa do pipe de Confirmação.
 * Cada etapa (D-5, D-3, D-1, D-0) tem objetivo, comportamento e ações configuráveis.
 * O usuário pode selecionar em quais etapas o copilot vai atuar de fato.
 *
 * Internamente gera kanbanRules apenas para as etapas habilitadas.
 */

import { useFormContext } from "react-hook-form";
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ToggleLeft,
} from "lucide-react";
import type { CopilotWizardData } from "@/types/copilot";

/** Etapas do funil de confirmação com metadata */
const CONFIRMATION_STAGES = [
  {
    stageName: "reuniao_marcada",
    label: "Reunião Marcada",
    timing: "Assim que agendar",
    icon: Calendar,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    defaultGoal: "Enviar mensagem de boas-vindas com os detalhes da reunião (data, hora, link). Confirmar que o lead recebeu.",
    defaultBehavior: "Seja caloroso e objetivo. Envie os dados da reunião de forma clara. Pergunte se o lead tem alguma dúvida sobre a preparação.",
  },
  {
    stageName: "confirmar_d5",
    label: "Confirmar D-5",
    timing: "5 dias antes",
    icon: Clock,
    color: "text-cyan-400",
    bgColor: "bg-cyan-500/10",
    defaultGoal: "Primeiro lembrete. Confirmar que a reunião continua de pé. Identificar possíveis conflitos.",
    defaultBehavior: "Abordagem leve e amigável. Pergunte se o horário ainda funciona. Se o lead não responder, não insista nesta etapa.",
  },
  {
    stageName: "confirmar_d3",
    label: "Confirmar D-3",
    timing: "3 dias antes",
    icon: Clock,
    color: "text-green-400",
    bgColor: "bg-green-500/10",
    defaultGoal: "Segundo lembrete com mais urgência. Reenviar dados da reunião. Confirmar presença.",
    defaultBehavior: "Seja direto mas cordial. Reforce o valor da reunião. Reenvie o link e horário. Se lead pedir reagendamento, ofereça novas opções.",
  },
  {
    stageName: "confirmar_d1",
    label: "Confirmar D-1",
    timing: "1 dia antes",
    icon: AlertTriangle,
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/10",
    defaultGoal: "Confirmação final. Garantir que o lead está ciente e preparado. Último momento para reagendar.",
    defaultBehavior: "Tom mais urgente. Peça confirmação explícita ('Pode confirmar?'). Se não responder, considere risco de no-show.",
  },
  {
    stageName: "confirmacao_no_dia",
    label: "No Dia",
    timing: "Dia da reunião",
    icon: CheckCircle2,
    color: "text-millennials-yellow",
    bgColor: "bg-millennials-yellow/10",
    defaultGoal: "Lembrete final no dia. Enviar link novamente. Confirmar que vai participar.",
    defaultBehavior: "Mensagem curta e direta. Envie o link da reunião. Se não responder até X minutos antes, marcar como risco.",
  },
  {
    stageName: "remarcar",
    label: "Remarcar",
    timing: "Quando precisa reagendar",
    icon: RefreshCw,
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
    defaultGoal: "Facilitar o reagendamento rápido. Oferecer novas opções de horário. Não perder o lead.",
    defaultBehavior: "Seja compreensivo. Ofereça 2-3 opções de novo horário. Confirme o novo agendamento imediatamente. Não julgue o motivo.",
  },
  {
    stageName: "perdido",
    label: "Perdido / No-Show",
    timing: "Quando não compareceu",
    icon: XCircle,
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    defaultGoal: "Tentar recuperar o lead com reagendamento. Se não responder após tentativas, encerrar.",
    defaultBehavior: "Pergunte se aconteceu algo. Ofereça reagendamento. Se após 2-3 tentativas não responder, agradeça e encerre educadamente.",
  },
];

interface StageConfigCardProps {
  stage: typeof CONFIRMATION_STAGES[number];
  ruleIndex: number;
  isOpen: boolean;
  isEnabled: boolean;
  onToggle: () => void;
  onToggleEnabled: () => void;
}

function StageConfigCard({ stage, ruleIndex, isOpen, isEnabled, onToggle, onToggleEnabled }: StageConfigCardProps) {
  const { watch, setValue } = useFormContext<CopilotWizardData>();
  const rules = watch("kanbanRules") || [];
  const rule = rules[ruleIndex];

  if (!rule) return null;

  const updateField = (field: string, value: any) => {
    const newRules = [...rules];
    newRules[ruleIndex] = { ...newRules[ruleIndex], [field]: value };
    setValue("kanbanRules", newRules as any);
  };

  const Icon = stage.icon;

  return (
    <Card className={`transition-all ${!isEnabled ? "opacity-50 grayscale" : !isOpen ? "opacity-80" : ""}`}>
      <Collapsible open={isEnabled && isOpen} onOpenChange={isEnabled ? onToggle : undefined}>
        <CardHeader className={`pb-3 ${isEnabled ? "cursor-pointer" : ""}`} onClick={isEnabled ? onToggle : undefined}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${stage.bgColor}`}>
                <Icon className={`w-4 h-4 ${stage.color}`} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-semibold text-sm">{stage.label}</h4>
                  <Badge variant="outline" className="text-xs">
                    {stage.timing}
                  </Badge>
                  {!isEnabled && (
                    <Badge variant="secondary" className="text-xs">
                      Desativada
                    </Badge>
                  )}
                </div>
                {isEnabled && !isOpen && rule.goal && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                    {rule.goal}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={isEnabled}
                onCheckedChange={onToggleEnabled}
                onClick={(e) => e.stopPropagation()}
              />
              {isEnabled && (
                <CollapsibleTrigger asChild>
                  <button type="button" className="p-1 rounded hover:bg-muted">
                    {isOpen ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>
                </CollapsibleTrigger>
              )}
            </div>
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">
            <div className="space-y-2">
              <Label>Objetivo nesta etapa</Label>
              <Textarea
                value={rule.goal || ""}
                onChange={(e) => updateField("goal", e.target.value)}
                placeholder={stage.defaultGoal}
                rows={2}
                className="resize-none"
              />
            </div>

            <div className="space-y-2">
              <Label>Como o agente deve se comportar</Label>
              <Textarea
                value={rule.behavior || ""}
                onChange={(e) => updateField("behavior", e.target.value)}
                placeholder={stage.defaultBehavior}
                rows={3}
                className="resize-none"
              />
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

export function ConfirmationFunnelStep() {
  const { watch, setValue } = useFormContext<CopilotWizardData>();
  const [openStages, setOpenStages] = useState<Record<string, boolean>>({
    reuniao_marcada: true,
  });

  // Todas as etapas habilitadas por padrão na primeira renderização
  const [enabledStages, setEnabledStages] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    CONFIRMATION_STAGES.forEach((s) => {
      initial[s.stageName] = true;
    });
    return initial;
  });

  const rules = watch("kanbanRules") || [];

  // Garantir que temos regras para todas as etapas do funil
  const ensureRules = useCallback(() => {
    if (rules.length >= CONFIRMATION_STAGES.length) return;

    const newRules = CONFIRMATION_STAGES.map((stage) => {
      const existing = rules.find(
        (r: any) => r.stageName === stage.stageName && r.pipeType === "confirmacao"
      );
      return existing || {
        pipeType: "confirmacao",
        stageName: stage.stageName,
        goal: stage.defaultGoal,
        behavior: stage.defaultBehavior,
        allowedActions: ["transfer_to_human"],
        forbiddenActions: ["create_lead"],
      };
    });

    setValue("kanbanRules", newRules as any);
  }, [rules, setValue]);

  // Inicializar regras se necessário
  if (rules.length < CONFIRMATION_STAGES.length) {
    ensureRules();
  }

  // Sincronizar enabledStages com as regras existentes (caso edite um agente salvo)
  useEffect(() => {
    if (rules.length > 0) {
      const hasDisabled = rules.some((r: any) => r.pipeType === "confirmacao" && r._disabled);
      if (hasDisabled) {
        const restored: Record<string, boolean> = {};
        CONFIRMATION_STAGES.forEach((s) => {
          const rule = rules.find((r: any) => r.stageName === s.stageName && r.pipeType === "confirmacao");
          restored[s.stageName] = rule ? !rule._disabled : true;
        });
        setEnabledStages(restored);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleStage = (stageName: string) => {
    setOpenStages((prev) => ({ ...prev, [stageName]: !prev[stageName] }));
  };

  const toggleEnabled = (stageName: string) => {
    setEnabledStages((prev) => {
      const next = { ...prev, [stageName]: !prev[stageName] };

      // Não permitir desabilitar todas — no mínimo 1
      const enabledCount = Object.values(next).filter(Boolean).length;
      if (enabledCount === 0) return prev;

      // Marcar a regra como _disabled para que o salvamento filtre
      const newRules = rules.map((r: any) => {
        if (r.stageName === stageName && r.pipeType === "confirmacao") {
          return { ...r, _disabled: !next[stageName] };
        }
        return r;
      });
      setValue("kanbanRules", newRules as any);

      return next;
    });
  };

  const enabledCount = Object.values(enabledStages).filter(Boolean).length;
  const totalCount = CONFIRMATION_STAGES.length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <Calendar className="w-6 h-6 text-millennials-yellow" />
          Funil de Confirmação
        </h2>
        <p className="text-muted-foreground">
          Selecione em quais etapas do funil o agente vai atuar e configure o comportamento de cada uma.
        </p>
      </div>

      {/* Contador de etapas ativas */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <ToggleLeft className="w-4 h-4" />
        <span>
          <strong className="text-foreground">{enabledCount}</strong> de {totalCount} etapas ativas
        </span>
        {enabledCount < totalCount && (
          <Badge variant="outline" className="text-xs">
            {totalCount - enabledCount} desativada{totalCount - enabledCount > 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      {/* Visual do funil — só mostra etapas habilitadas na trilha visual */}
      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {CONFIRMATION_STAGES.map((stage, i) => {
          const Icon = stage.icon;
          const enabled = enabledStages[stage.stageName];
          return (
            <div key={stage.stageName} className="flex items-center">
              <button
                type="button"
                onClick={() => enabled && toggleStage(stage.stageName)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  !enabled
                    ? "bg-muted/50 text-muted-foreground/50 line-through"
                    : openStages[stage.stageName]
                    ? `${stage.bgColor} ${stage.color} ring-1 ring-current`
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                <Icon className="w-3 h-3" />
                {stage.label}
              </button>
              {i < CONFIRMATION_STAGES.length - 1 && (
                <span className={`mx-1 ${!enabled ? "text-muted-foreground/30" : "text-muted-foreground"}`}>→</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Cards por etapa */}
      <div className="space-y-3">
        <AnimatePresence>
          {CONFIRMATION_STAGES.map((stage, index) => (
            <motion.div
              key={stage.stageName}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <StageConfigCard
                stage={stage}
                ruleIndex={index}
                isOpen={!!openStages[stage.stageName]}
                isEnabled={!!enabledStages[stage.stageName]}
                onToggle={() => toggleStage(stage.stageName)}
                onToggleEnabled={() => toggleEnabled(stage.stageName)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Dica */}
      <div className="bg-millennials-yellow/10 border border-millennials-yellow/30 rounded-lg p-4">
        <h4 className="font-semibold text-millennials-yellow mb-2">Como funciona o funil?</h4>
        <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
          <li>Quando o qualificador/SDR agenda uma reunião, o lead entra no pipe de Confirmação</li>
          <li>O confirmador atua <strong>apenas nas etapas ativas</strong> com mensagens progressivas</li>
          <li>Desative etapas que não fazem sentido para o seu processo (ex: se não usa D-5)</li>
          <li>Se o lead confirma, avança no funil até "Compareceu"</li>
          <li>Se precisa reagendar, vai para "Remarcar" e volta ao fluxo</li>
        </ul>
      </div>
    </div>
  );
}
