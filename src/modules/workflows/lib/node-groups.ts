import type { ElementType } from "react";
import {
  Play,
  GitBranch,
  Clock,
  CircleStop,
  MessageCircle,
  CalendarClock,
  Split,
  CornerDownRight,
  UserRoundPlus,
  Bot,
  Globe,
  Braces,
  SquareCode,
  Network,
} from "lucide-react";
import type { WorkflowNodeType } from "@/types/workflow";

export interface NodeOption {
  type: WorkflowNodeType;
  label: string;
  icon: ElementType;
}

export interface NodeOptionGroup {
  label: string;
  options: NodeOption[];
}

/**
 * Os blocos que o autor pode adicionar — a MESMA lista serve o menu
 * "Adicionar Nó" (telas estreitas) e a paleta fixa do editor (`WorkflowPalette`).
 */
export const ADD_NODE_GROUPS: NodeOptionGroup[] = [
  {
    label: "Básico",
    options: [
      { type: "action", label: "Ação", icon: Play },
      { type: "condition", label: "Condição", icon: GitBranch },
      { type: "delay", label: "Delay", icon: Clock },
      { type: "end", label: "Fim", icon: CircleStop },
    ],
  },
  {
    label: "Controle de Fluxo",
    options: [
      { type: "wait_response", label: "Esperar Resposta", icon: MessageCircle },
      { type: "wait_business_window", label: "Janela Comercial", icon: CalendarClock },
      { type: "split_ab", label: "Split A/B", icon: Split },
      { type: "goto", label: "Ir Para (Jump)", icon: CornerDownRight },
    ],
  },
  {
    label: "Equipe",
    options: [
      { type: "assign_responsible", label: "Definir Responsável", icon: UserRoundPlus },
    ],
  },
  {
    label: "Integrações",
    options: [
      { type: "copilot", label: "Copilot (Handoff)", icon: Bot },
      { type: "webhook_call", label: "Webhook Externo", icon: Globe },
    ],
  },
  {
    label: "Código",
    options: [
      { type: "code_json", label: "JSON", icon: Braces },
      { type: "code_javascript", label: "JavaScript", icon: SquareCode },
      // `Network` e não `Globe`: o Globe já é o Webhook Externo, logo acima.
      { type: "code_https", label: "HTTPS", icon: Network },
    ],
  },
];

/**
 * Grupos visíveis: tira o que está oculto (ex.: JavaScript sem sandbox) e o que
 * depende de flag. Um grupo que perdeu todas as opções some inteiro — sobraria
 * um cabeçalho solto.
 */
export function visibleNodeGroups(hiddenNodeTypes: WorkflowNodeType[] = [], questionButtonsEnabled = false): NodeOptionGroup[] {
  return ADD_NODE_GROUPS
    .map((group) => ({
      ...group,
      options: group.options.filter((opt) => !hiddenNodeTypes.includes(opt.type) && (opt.type !== "question_buttons" || questionButtonsEnabled)),
    }))
    .filter((group) => group.options.length > 0);
}
