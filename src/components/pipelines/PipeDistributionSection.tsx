/**
 * PipeDistributionSection — configuração de distribuição de Responsáveis por pipe.
 * Modos: Manual, Aleatório, Rotativo, Pessoa específica.
 */

import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Shuffle, User, AlertTriangle, Save, Loader2, CheckCircle2 } from "lucide-react";
import { type PipelineType } from "@/hooks/usePipelineStages";
import { useResponsibleMembers } from "@/hooks/useTeamMembers";
import {
  usePipeDistributionRule,
  useSavePipeDistribution,
  type DistributionMode,
} from "@/hooks/usePipeDistribution";

interface PipeDistributionSectionProps {
  pipeType: PipelineType;
}

const MODE_OPTIONS = [
  { value: "none", label: "Manual (sem distribuição automática)" },
  { value: "random", label: "Aleatório" },
  { value: "round_robin", label: "Rotativo (round robin)" },
  { value: "single", label: "Pessoa específica" },
];

export function PipeDistributionSection({ pipeType }: PipeDistributionSectionProps) {
  const teamMembers = useResponsibleMembers();
  const { data: distData, isLoading } = usePipeDistributionRule(pipeType);
  const saveMutation = useSavePipeDistribution();

  // Local state — single "Responsável" distribution
  const [mode, setMode] = useState<string>("none");
  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const [memberIds, setMemberIds] = useState<string[]>([]);

  // Sync from fetched data (read sdr_mode for backward compat)
  useEffect(() => {
    if (distData?.rule) {
      setMode(distData.rule.sdr_mode ?? "none");
      setAssignedTo(distData.rule.sdr_assigned_to);

      const ids = distData.members.map((m) => m.team_member_id);
      setMemberIds(ids);
    } else if (distData === null) {
      setMode("none");
      setAssignedTo(null);
      setMemberIds([]);
    }
  }, [distData]);

  const handleSave = () => {
    saveMutation.mutate({
      pipeType,
      mode: mode === "none" ? null : (mode as DistributionMode),
      assignedTo: mode === "single" ? assignedTo : null,
      memberIds: mode === "round_robin" || mode === "random" ? memberIds : [],
    });
  };

  const toggleMember = (id: string) => {
    if (memberIds.includes(id)) {
      setMemberIds(memberIds.filter((x) => x !== id));
    } else {
      setMemberIds([...memberIds, id]);
    }
  };

  const needsPool =
    (mode === "round_robin" || mode === "random") &&
    memberIds.length === 0;

  if (isLoading) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Carregando...
      </div>
    );
  }

  const isActive = mode !== "none" && distData?.rule?.sdr_mode;
  const poolCount = distData?.members?.length ?? 0;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Configure como o responsável é atribuído automaticamente quando um
        lead entra neste funil.
      </p>

      {isActive && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30 px-4 py-2.5">
          <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" />
          <span className="text-sm text-green-700 dark:text-green-300">
            Distribuição automática ativa
            {poolCount > 0 && ` \u2014 ${poolCount} membro${poolCount > 1 ? "s" : ""} no pool`}
          </span>
        </div>
      )}

      {/* ─── Distribuição de Responsáveis ──────────────────── */}
      <div className="space-y-3">
        <Label className="flex items-center gap-2 text-base font-semibold">
          <Shuffle className="w-4 h-4" />
          Distribuição de Responsáveis
        </Label>
        <Select
          value={mode}
          onValueChange={(v) => {
            setMode(v);
            if (v !== "single") setAssignedTo(null);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Como distribuir responsáveis" />
          </SelectTrigger>
          <SelectContent>
            {MODE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {mode === "single" && (
          <Select
            value={assignedTo ?? ""}
            onValueChange={(v) => setAssignedTo(v || null)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione o responsável" />
            </SelectTrigger>
            <SelectContent>
              {teamMembers.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  <span className="flex items-center gap-2">
                    <User className="w-3 h-3" />
                    {m.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {(mode === "round_robin" || mode === "random") && (
          <div className="space-y-2 pl-1">
            <p className="text-sm text-muted-foreground">
              Pool de responsáveis — selecione quem participa da distribuição:
            </p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {teamMembers.map((m) => (
                <label
                  key={m.id}
                  className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 cursor-pointer"
                >
                  <Checkbox
                    checked={memberIds.includes(m.id)}
                    onCheckedChange={() => toggleMember(m.id)}
                  />
                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-sm">{m.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {needsPool && (
          <p className="text-sm text-amber-600 dark:text-amber-500 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Selecione ao menos um responsável para a distribuição funcionar.
          </p>
        )}
      </div>

      {/* ─── Save ──────────────────────────────────────────── */}
      <div className="pt-4 border-t flex justify-end">
        <Button onClick={handleSave} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          Salvar Configuração
        </Button>
      </div>
    </div>
  );
}
