import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AssignResponsibleNodeData, AssignMode, AssignTarget } from "@/types/workflow";
import { useTeamMembers } from "@/modules/identity";
import { cn } from "@/lib/utils";

interface AssignResponsiblePanelProps {
  data: AssignResponsibleNodeData;
  onUpdate: (updates: Partial<AssignResponsibleNodeData>) => void;
}

const MODE_OPTIONS: { value: AssignMode; label: string; description: string }[] = [
  { value: "round_robin", label: "Rotativo", description: "Distribui em sequência (A→B→C→A→B→C)" },
  { value: "random", label: "Aleatório", description: "Sorteia um membro aleatoriamente" },
  { value: "manual", label: "Manual", description: "Sempre atribui para um membro fixo" },
];

const TARGET_OPTIONS: { value: AssignTarget; label: string }[] = [
  { value: "responsible", label: "Responsável" },
  { value: "sdr", label: "Pré-Venda" },
  { value: "sale", label: "Vendedor" },
];

export function AssignResponsiblePanel({ data, onUpdate }: AssignResponsiblePanelProps) {
  const { data: members = [] } = useTeamMembers();
  const activeMembers = members.filter((m) => m.is_active);
  const selectedMemberIds = data.memberIds || [];

  const toggleMember = (memberId: string) => {
    const updated = selectedMemberIds.includes(memberId)
      ? selectedMemberIds.filter(id => id !== memberId)
      : [...selectedMemberIds, memberId];
    onUpdate({ memberIds: updated });
  };

  return (
    <div className="space-y-4">
      {/* Label */}
      <div className="space-y-2">
        <Label>Nome</Label>
        <Input
          value={data.label || ""}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Ex: Distribuir para equipe"
        />
      </div>

      {/* Mode selector */}
      <div className="space-y-2">
        <Label>Modo de distribuição</Label>
        <div className="space-y-2">
          {MODE_OPTIONS.map((opt) => (
            <div
              key={opt.value}
              onClick={() => onUpdate({ assignMode: opt.value })}
              className={cn(
                "flex flex-col gap-0.5 rounded-lg border p-3 cursor-pointer transition-colors",
                data.assignMode === opt.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/50"
              )}
            >
              <span className="text-sm font-medium">{opt.label}</span>
              <span className="text-xs text-muted-foreground">{opt.description}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Target selector */}
      <div className="space-y-2">
        <Label>Atribuir como</Label>
        <Select
          value={data.assignTarget || "responsible"}
          onValueChange={(v) => onUpdate({ assignTarget: v as AssignTarget })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TARGET_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Manual mode: single member select */}
      {data.assignMode === "manual" && (
        <div className="space-y-2">
          <Label>Responsável fixo</Label>
          <Select
            value={data.assigneeId || ""}
            onValueChange={(v) => {
              const member = activeMembers.find((m) => m.id === v);
              onUpdate({
                assigneeId: v,
                assigneeName: member?.name || "",
              });
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione o responsável" />
            </SelectTrigger>
            <SelectContent>
              {activeMembers.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}{m.role ? ` (${m.role})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Round-robin / Random: optional member filter */}
      {(data.assignMode === "round_robin" || data.assignMode === "random") && (
        <div className="space-y-2">
          <Label>Membros participantes</Label>
          <p className="text-xs text-muted-foreground">
            Selecione os membros que participam da distribuição. Vazio = todos os ativos.
          </p>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {activeMembers.map((m) => (
              <Badge
                key={m.id}
                variant={selectedMemberIds.includes(m.id) ? "default" : "outline"}
                className={cn(
                  "cursor-pointer select-none px-2.5 py-1 text-xs",
                  selectedMemberIds.includes(m.id)
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                )}
                onClick={() => toggleMember(m.id)}
              >
                {m.name}
              </Badge>
            ))}
          </div>
          {selectedMemberIds.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {selectedMemberIds.length} de {activeMembers.length} selecionados
            </p>
          )}
        </div>
      )}
    </div>
  );
}
