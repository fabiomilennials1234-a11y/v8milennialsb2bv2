import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCampanhaPipeAutomations,
  useCreateCampanhaPipeAutomation,
  useDeleteCampanhaPipeAutomation,
  type CampanhaStage,
  type CampanhaPipeAutomation,
  type CampanhaPipeAutomationTarget,
} from "@/modules/campaigns/hooks/useCampanhas";
import { usePipelineStages, type PipelineType } from "@/modules/pipelines/hooks/usePipelineStages";
import { MessageSquare, CalendarCheck, FileText, ChevronDown, Plus, Trash2, Loader2, Zap } from "lucide-react";
import { toast } from "sonner";

const PIPE_OPTIONS: {
  target: CampanhaPipeAutomationTarget;
  label: string;
  pipelineType: PipelineType;
  icon: typeof MessageSquare;
}[] = [
  { target: "pipe_whatsapp", label: "Pipe de Qualificação", pipelineType: "whatsapp", icon: MessageSquare },
  { target: "pipe_confirmacao", label: "Pipe Confirmação", pipelineType: "confirmacao", icon: CalendarCheck },
  { target: "pipe_propostas", label: "Pipe de Propostas", pipelineType: "propostas", icon: FileText },
];

interface CampanhaPipeAutomationsSectionProps {
  campanhaId: string;
  stages: CampanhaStage[];
  embedded?: boolean;
}

export function CampanhaPipeAutomationsSection({ campanhaId, stages, embedded }: CampanhaPipeAutomationsSectionProps) {
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedCampanhaStageId, setSelectedCampanhaStageId] = useState<string>("");
  const [selectedPipe, setSelectedPipe] = useState<CampanhaPipeAutomationTarget | "">("");
  const [selectedPipeStage, setSelectedPipeStage] = useState<string>("");

  const { data: automations = [], isLoading } = useCampanhaPipeAutomations(campanhaId);
  const createAutomation = useCreateCampanhaPipeAutomation();
  const deleteAutomation = useDeleteCampanhaPipeAutomation();

  const pipeOption = PIPE_OPTIONS.find((o) => o.target === selectedPipe);
  const pipelineType = pipeOption?.pipelineType ?? "whatsapp";
  const { data: pipelineStages = [] } = usePipelineStages(pipelineType);

  const stagesWithoutAutomation = stages.filter(
    (s) => !automations.some((a) => a.campanha_stage_id === s.id)
  );

  const handleAdd = async () => {
    if (!selectedCampanhaStageId || !selectedPipe || !selectedPipeStage) {
      toast.error("Selecione a etapa da campanha, o pipe e a etapa do pipe");
      return;
    }
    try {
      await createAutomation.mutateAsync({
        campanha_id: campanhaId,
        campanha_stage_id: selectedCampanhaStageId,
        target_pipe: selectedPipe,
        pipe_stage: selectedPipeStage,
      });
      toast.success("Automação adicionada");
      setAddOpen(false);
      setSelectedCampanhaStageId("");
      setSelectedPipe("");
      setSelectedPipeStage("");
    } catch (e) {
      console.error(e);
      toast.error("Erro ao criar automação");
    }
  };

  const handleDelete = async (a: CampanhaPipeAutomation) => {
    try {
      await deleteAutomation.mutateAsync({ id: a.id, campanha_id: campanhaId });
      toast.success("Automação removida");
    } catch (e) {
      toast.error("Erro ao remover automação");
    }
  };

  const getStageName = (stageId: string) => stages.find((s) => s.id === stageId)?.name ?? stageId;
  const getPipeLabel = (target: CampanhaPipeAutomationTarget) =>
    PIPE_OPTIONS.find((o) => o.target === target)?.label ?? target;

  const innerContent = (
    <>
      <p className="text-xs text-muted-foreground">
        Quando um lead for movido para uma etapa que tiver regra abaixo, ele sairá da campanha e entrará na etapa escolhida do pipe.
      </p>
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Carregando…
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {automations.length === 0 ? (
              <li className="text-sm text-muted-foreground">Nenhuma automação configurada.</li>
            ) : (
              automations.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-sm"
                >
                  <span className="text-muted-foreground">
                    Quando chegar em <strong className="text-foreground">{getStageName(a.campanha_stage_id)}</strong>
                    {" → "}
                    enviar para <strong className="text-foreground">{getPipeLabel(a.target_pipe)}</strong>
                    {" "}na etapa <strong className="text-foreground">{a.pipe_stage}</strong>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(a)}
                    disabled={deleteAutomation.isPending}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </li>
              ))
            )}
          </ul>
          {stagesWithoutAutomation.length === 0 && stages.length > 0 ? (
            <p className="text-xs text-muted-foreground">Todas as etapas já possuem uma automação.</p>
          ) : stages.length > 0 && (
            <>
              {!addOpen ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Adicionar automação
                </Button>
              ) : (
                <div className="space-y-3 rounded-md border border-dashed p-3">
                  <div className="grid gap-2">
                    <Label>Etapa da campanha</Label>
                    <Select
                      value={selectedCampanhaStageId}
                      onValueChange={(v) => {
                        setSelectedCampanhaStageId(v);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione a etapa" />
                      </SelectTrigger>
                      <SelectContent>
                        {stagesWithoutAutomation.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Pipe destino</Label>
                    <Select
                      value={selectedPipe}
                      onValueChange={(v) => {
                        setSelectedPipe(v as CampanhaPipeAutomationTarget);
                        setSelectedPipeStage("");
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o pipe" />
                      </SelectTrigger>
                      <SelectContent>
                        {PIPE_OPTIONS.map(({ target, label, icon: Icon }) => (
                          <SelectItem key={target} value={target}>
                            <span className="flex items-center gap-2">
                              <Icon className="w-4 h-4 shrink-0" />
                              {label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedPipe && (
                    <div className="grid gap-2">
                      <Label>Etapa no pipe</Label>
                      <Select
                        value={selectedPipeStage}
                        onValueChange={setSelectedPipeStage}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione a etapa no pipe" />
                        </SelectTrigger>
                        <SelectContent>
                          {pipelineStages.map((s) => {
                            const key = s.stage_key ?? s.id;
                            return (
                              <SelectItem key={key} value={key}>
                                <span className="flex items-center gap-2">
                                  {s.color && (
                                    <span
                                      className="w-2.5 h-2.5 rounded-full shrink-0"
                                      style={{ backgroundColor: s.color }}
                                    />
                                  )}
                                  {s.name}
                                </span>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setAddOpen(false);
                        setSelectedCampanhaStageId("");
                        setSelectedPipe("");
                        setSelectedPipeStage("");
                      }}
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleAdd}
                      disabled={
                        !selectedCampanhaStageId ||
                        !selectedPipe ||
                        !selectedPipeStage ||
                        createAutomation.isPending
                      }
                    >
                      {createAutomation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      ) : null}
                      Salvar automação
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );

  if (embedded) {
    return <div className="space-y-4">{innerContent}</div>;
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <Zap className="w-4 h-4" />
          Automações de envio para pipe
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="rounded-lg border bg-muted/30 p-4 mt-2 space-y-4">
          {innerContent}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
