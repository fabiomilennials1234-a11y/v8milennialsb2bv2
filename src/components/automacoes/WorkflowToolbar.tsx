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
} from "lucide-react";
import type { WorkflowNodeType } from "@/types/workflow";

interface WorkflowToolbarProps {
  name: string;
  onNameChange: (name: string) => void;
  isActive: boolean;
  onToggleActive: () => void;
  onSave: () => void;
  isSaving: boolean;
  onAddNode: (type: WorkflowNodeType) => void;
  isNew: boolean;
  workflowId?: string;
  onExport?: () => void;
}

interface NodeOption {
  type: WorkflowNodeType;
  label: string;
  icon: React.ElementType;
  color: string;
}

interface NodeOptionGroup {
  label: string;
  options: NodeOption[];
}

const ADD_NODE_GROUPS: NodeOptionGroup[] = [
  {
    label: "Básico",
    options: [
      { type: "action", label: "Ação", icon: Play, color: "text-green-500" },
      { type: "condition", label: "Condição", icon: GitBranch, color: "text-yellow-500" },
      { type: "delay", label: "Delay", icon: Clock, color: "text-purple-500" },
      { type: "end", label: "Fim", icon: CircleStop, color: "text-gray-400" },
    ],
  },
  {
    label: "Controle de Fluxo",
    options: [
      { type: "wait_response", label: "Esperar Resposta", icon: MessageCircle, color: "text-orange-500" },
      { type: "wait_business_window", label: "Janela Comercial", icon: CalendarClock, color: "text-amber-500" },
      { type: "split_ab", label: "Split A/B", icon: Split, color: "text-pink-500" },
      { type: "goto", label: "Ir Para (Jump)", icon: CornerDownRight, color: "text-teal-500" },
    ],
  },
  {
    label: "Equipe",
    options: [
      { type: "assign_responsible", label: "Definir Responsável", icon: UserRoundPlus, color: "text-rose-500" },
    ],
  },
  {
    label: "Integrações",
    options: [
      { type: "copilot", label: "Copilot (Handoff)", icon: Bot, color: "text-cyan-500" },
      { type: "webhook_call", label: "Webhook Externo", icon: Globe, color: "text-indigo-500" },
    ],
  },
];

export function WorkflowToolbar({
  name,
  onNameChange,
  isActive,
  onToggleActive,
  onSave,
  isSaving,
  onAddNode,
  isNew,
  workflowId,
  onExport,
}: WorkflowToolbarProps) {
  const navigate = useNavigate();

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b bg-card">
      {/* Left */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/automacoes")}
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>

        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-primary" />
          <Input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className="h-8 w-64 text-base font-semibold border-transparent hover:border-border focus:border-border bg-transparent"
            placeholder="Nome do workflow"
          />
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center gap-3">
        {/* Add Node */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Plus className="w-4 h-4 mr-1" />
              Adicionar Nó
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {ADD_NODE_GROUPS.map((group, gi) => (
              <div key={group.label}>
                {gi > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-xs text-muted-foreground uppercase">
                  {group.label}
                </DropdownMenuLabel>
                {group.options.map((opt) => (
                  <DropdownMenuItem
                    key={opt.type}
                    onClick={() => onAddNode(opt.type)}
                    className="gap-2"
                  >
                    <opt.icon className={`w-4 h-4 ${opt.color}`} />
                    {opt.label}
                  </DropdownMenuItem>
                ))}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Export */}
        {!isNew && onExport && (
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="w-4 h-4 mr-1" />
            Exportar
          </Button>
        )}

        {/* Executions link */}
        {!isNew && workflowId && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/automacoes/${workflowId}/execucoes`)}
          >
            <History className="w-4 h-4 mr-1" />
            Execuções
          </Button>
        )}

        <div className="h-6 w-px bg-border" />

        {/* Active toggle */}
        <div className="flex items-center gap-2">
          <Label htmlFor="workflow-active" className="text-sm text-muted-foreground">
            {isActive ? "Ativo" : "Inativo"}
          </Label>
          <Switch
            id="workflow-active"
            checked={isActive}
            onCheckedChange={onToggleActive}
          />
        </div>

        {/* Save */}
        <Button onClick={onSave} disabled={isSaving} size="sm">
          {isSaving ? (
            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-1" />
          )}
          {isNew ? "Criar" : "Salvar"}
        </Button>
      </div>
    </div>
  );
}
