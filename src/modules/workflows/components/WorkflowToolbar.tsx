import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  Save,
  Loader2,
  Plus,
  Zap,
  Play,
  GitBranch,
  Clock,
  Bot,
  CircleStop,
  MessageCircle,
  Split,
  Globe,
  CornerDownRight,
  History,
  Download,
  CalendarClock,
  UserRoundPlus,
  BarChart3,
  Repeat,
  Rocket,
  Braces,
  SquareCode,
  Network,
} from "lucide-react";
import type { WorkflowNodeType } from "@/types/workflow";
import { NODE_COLORS } from "@/types/workflow";
import { cn } from "@/lib/utils";

interface WorkflowToolbarProps {
  name: string;
  onNameChange: (name: string) => void;
  isActive: boolean;
  onToggleActive: () => void;
  isToggleDisabled?: boolean;
  onSave: () => void;
  isSaving: boolean;
  onPublish?: () => void;
  isPublishing?: boolean;
  onAddNode: (type: WorkflowNodeType) => void;
  isNew: boolean;
  workflowId?: string;
  onExport?: () => void;
  /** Abre o Sheet de configurações já na aba pedida. */
  onOpenSettings?: (tab: "reenrollment" | "analytics") => void;
  /** Tipos que não devem aparecer no menu (ex.: nó gateado por feature flag). */
  hiddenNodeTypes?: WorkflowNodeType[];
  questionButtonsEnabled?: boolean;
}

export interface NodeOption {
  type: WorkflowNodeType;
  label: string;
  icon: React.ElementType;
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

export function WorkflowToolbar({
  name,
  onNameChange,
  isActive,
  onToggleActive,
  isToggleDisabled = false,
  onSave,
  isSaving,
  onPublish,
  isPublishing = false,
  onAddNode,
  isNew,
  workflowId,
  onExport,
  onOpenSettings,
  hiddenNodeTypes = [],
  questionButtonsEnabled = false,
}: WorkflowToolbarProps) {
  const navigate = useNavigate();

  const visibleGroups = visibleNodeGroups(hiddenNodeTypes, questionButtonsEnabled);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-card border border-card-border bg-card px-3 py-2.5 shadow-relevo">
      {/* Left */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <button
          type="button"
          onClick={() => navigate("/automacoes")}
          aria-label="Voltar"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-card-border bg-card text-foreground shadow-relevo transition-transform hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-tinta text-primary">
            <Zap className="h-4 w-4" />
          </span>
          <Input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            aria-label="Nome do workflow"
            className="h-9 w-64 max-w-full rounded-full border-input bg-card text-[15px] font-bold tracking-[-0.01em]"
            placeholder="Nome do workflow"
          />
        </div>

        {/* Active toggle — pílula com o switch */}
        <div className="flex h-9 shrink-0 items-center gap-2 rounded-full border border-input bg-muted/40 pl-3 pr-1.5">
          <Label htmlFor="workflow-active" className="text-[13px] font-bold text-foreground/80">
            {isActive ? "Ativo" : "Inativo"}
          </Label>
          <Switch
            id="workflow-active"
            disabled={isToggleDisabled}
            checked={isActive}
            onCheckedChange={onToggleActive}
          />
        </div>
      </div>

      {/* Right */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Add Node — a paleta fixa cobre isto a partir de xl */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ink" size="sm" className="xl:hidden">
              <Plus />
              Adicionar Nó
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {visibleGroups.map((group, gi) => (
              <div key={group.label}>
                {gi > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
                  {group.label}
                </DropdownMenuLabel>
                {group.options.map((opt) => (
                  <DropdownMenuItem
                    key={opt.type}
                    onClick={() => onAddNode(opt.type)}
                    className="gap-2.5"
                  >
                    <span
                      className={cn(
                        "grid h-6 w-6 shrink-0 place-items-center rounded-lg [&_svg]:h-3.5 [&_svg]:w-3.5",
                        NODE_COLORS[opt.type].chip,
                      )}
                    >
                      <opt.icon />
                    </span>
                    {opt.label}
                  </DropdownMenuItem>
                ))}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Configurações — as duas abas do Sheet, cada uma com seu botão */}
        {onOpenSettings && !isNew && workflowId && (
          <Button variant="outline" size="sm" onClick={() => onOpenSettings("analytics")}>
            <BarChart3 />
            Analytics
          </Button>
        )}
        {onOpenSettings && (
          <Button variant="outline" size="sm" onClick={() => onOpenSettings("reenrollment")}>
            <Repeat />
            Re-inscrição
          </Button>
        )}

        {/* Executions link */}
        {!isNew && workflowId && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/automacoes/${workflowId}/execucoes`)}
          >
            <History />
            Execuções
          </Button>
        )}

        {/* Export */}
        {!isNew && onExport && (
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download />
            Exportar
          </Button>
        )}

        <div className="mx-0.5 h-6 w-px bg-border" />

        {/* Save */}
        <Button onClick={onSave} disabled={isSaving || isPublishing} size="sm" variant={onPublish ? "outline" : "default"}>
          {isSaving ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Save />
          )}
          {isNew ? "Criar" : onPublish ? "Salvar rascunho" : "Salvar"}
        </Button>
        {/* Um primário só: com publicação, Publicar é o ouro e Salvar (rascunho) vira contorno. */}
        {onPublish && <Button onClick={onPublish} disabled={isSaving || isPublishing} size="sm">
          {isPublishing ? <Loader2 className="animate-spin" /> : <Rocket />}
          Publicar
        </Button>}
      </div>
    </div>
  );
}
