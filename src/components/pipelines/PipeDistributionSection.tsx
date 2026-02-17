/**
 * PipeDistributionSection — configuração de distribuição de SDRs/Closers por pipe.
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
import { Shuffle, User, AlertTriangle, Save, Loader2 } from "lucide-react";
import { type PipelineType } from "@/hooks/usePipelineStages";
import { useTeamMembers } from "@/hooks/useTeamMembers";
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
  const { data: teamMembers } = useTeamMembers();
  const { data: distData, isLoading } = usePipeDistributionRule(pipeType);
  const saveMutation = useSavePipeDistribution();

  // Local state
  const [sdrMode, setSdrMode] = useState<string>("none");
  const [sdrAssignedTo, setSdrAssignedTo] = useState<string | null>(null);
  const [sdrMemberIds, setSdrMemberIds] = useState<string[]>([]);

  const [closerMode, setCloserMode] = useState<string>("none");
  const [closerAssignedTo, setCloserAssignedTo] = useState<string | null>(null);
  const [closerMemberIds, setCloserMemberIds] = useState<string[]>([]);

  const showCloser = pipeType === "confirmacao" || pipeType === "propostas";

  // Sync from fetched data
  useEffect(() => {
    if (distData?.rule) {
      setSdrMode(distData.rule.sdr_mode ?? "none");
      setSdrAssignedTo(distData.rule.sdr_assigned_to);
      setCloserMode(distData.rule.closer_mode ?? "none");
      setCloserAssignedTo(distData.rule.closer_assigned_to);

      const sdrIds = distData.members
        .filter((m) => m.role === "sdr")
        .map((m) => m.team_member_id);
      const closerIds = distData.members
        .filter((m) => m.role === "closer")
        .map((m) => m.team_member_id);
      setSdrMemberIds(sdrIds);
      setCloserMemberIds(closerIds);
    } else if (distData === null) {
      setSdrMode("none");
      setSdrAssignedTo(null);
      setSdrMemberIds([]);
      setCloserMode("none");
      setCloserAssignedTo(null);
      setCloserMemberIds([]);
    }
  }, [distData]);

  const handleSave = () => {
    saveMutation.mutate({
      pipeType,
      sdrMode: sdrMode === "none" ? null : (sdrMode as DistributionMode),
      sdrAssignedTo: sdrMode === "single" ? sdrAssignedTo : null,
      closerMode: showCloser && closerMode !== "none"
        ? (closerMode as DistributionMode)
        : null,
      closerAssignedTo:
        showCloser && closerMode === "single" ? closerAssignedTo : null,
      sdrMemberIds:
        sdrMode === "round_robin" || sdrMode === "random" ? sdrMemberIds : [],
      closerMemberIds:
        showCloser && (closerMode === "round_robin" || closerMode === "random")
          ? closerMemberIds
          : [],
    });
  };

  const toggleMember = (
    id: string,
    list: string[],
    setList: (ids: string[]) => void
  ) => {
    if (list.includes(id)) {
      setList(list.filter((x) => x !== id));
    } else {
      setList([...list, id]);
    }
  };

  const needsSdrPool =
    (sdrMode === "round_robin" || sdrMode === "random") &&
    sdrMemberIds.length === 0;
  const needsCloserPool =
    showCloser &&
    (closerMode === "round_robin" || closerMode === "random") &&
    closerMemberIds.length === 0;

  if (isLoading) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Carregando...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Configure como SDRs e Closers são atribuídos automaticamente quando um
        lead entra neste funil.
      </p>

      {/* ─── SDR Distribution ──────────────────────────────── */}
      <div className="space-y-3">
        <Label className="flex items-center gap-2 text-base font-semibold">
          <Shuffle className="w-4 h-4" />
          Distribuição de SDRs
        </Label>
        <Select
          value={sdrMode}
          onValueChange={(v) => {
            setSdrMode(v);
            if (v !== "single") setSdrAssignedTo(null);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Como distribuir SDRs" />
          </SelectTrigger>
          <SelectContent>
            {MODE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {sdrMode === "single" && (
          <Select
            value={sdrAssignedTo ?? ""}
            onValueChange={(v) => setSdrAssignedTo(v || null)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione o SDR" />
            </SelectTrigger>
            <SelectContent>
              {teamMembers?.map((m) => (
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

        {(sdrMode === "round_robin" || sdrMode === "random") && (
          <div className="space-y-2 pl-1">
            <p className="text-sm text-muted-foreground">
              Pool de SDRs — selecione quem participa da distribuição:
            </p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {teamMembers?.map((m) => (
                <label
                  key={m.id}
                  className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 cursor-pointer"
                >
                  <Checkbox
                    checked={sdrMemberIds.includes(m.id)}
                    onCheckedChange={() =>
                      toggleMember(m.id, sdrMemberIds, setSdrMemberIds)
                    }
                  />
                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-sm">{m.name}</span>
                  {m.role && (
                    <span className="text-xs text-muted-foreground ml-auto">
                      {m.role}
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>
        )}

        {needsSdrPool && (
          <p className="text-sm text-amber-600 dark:text-amber-500 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Selecione ao menos um SDR para a distribuição funcionar.
          </p>
        )}
      </div>

      {/* ─── Closer Distribution ───────────────────────────── */}
      {showCloser && (
        <div className="space-y-3 pt-4 border-t">
          <Label className="flex items-center gap-2 text-base font-semibold">
            <Shuffle className="w-4 h-4" />
            Distribuição de Closers
          </Label>
          <Select
            value={closerMode}
            onValueChange={(v) => {
              setCloserMode(v);
              if (v !== "single") setCloserAssignedTo(null);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Como distribuir Closers" />
            </SelectTrigger>
            <SelectContent>
              {MODE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {closerMode === "single" && (
            <Select
              value={closerAssignedTo ?? ""}
              onValueChange={(v) => setCloserAssignedTo(v || null)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione o Closer" />
              </SelectTrigger>
              <SelectContent>
                {teamMembers?.map((m) => (
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

          {(closerMode === "round_robin" || closerMode === "random") && (
            <div className="space-y-2 pl-1">
              <p className="text-sm text-muted-foreground">
                Pool de Closers — selecione quem participa da distribuição:
              </p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {teamMembers?.map((m) => (
                  <label
                    key={m.id}
                    className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={closerMemberIds.includes(m.id)}
                      onCheckedChange={() =>
                        toggleMember(
                          m.id,
                          closerMemberIds,
                          setCloserMemberIds
                        )
                      }
                    />
                    <User className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-sm">{m.name}</span>
                    {m.role && (
                      <span className="text-xs text-muted-foreground ml-auto">
                        {m.role}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}

          {needsCloserPool && (
            <p className="text-sm text-amber-600 dark:text-amber-500 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Selecione ao menos um Closer para a distribuição funcionar.
            </p>
          )}
        </div>
      )}

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
