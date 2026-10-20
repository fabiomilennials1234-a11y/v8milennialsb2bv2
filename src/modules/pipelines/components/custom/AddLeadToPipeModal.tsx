import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import {
  useAddLeadToCustomPipe,
  type CustomPipelineStage,
} from "@/modules/pipelines/hooks/custom/useCustomPipelines";
import { Loader2, Search, Building2, Phone, UserCheck, Plus, Info } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounce } from "@/shared/hooks/useDebounce";
import { LeadModal, buscarLeadIdsPorTelefoneSecundario } from "@/modules/leads";
import { notifyError, toAppError } from "@/shared/errors";
import {
  ETAPA_DE_PERDA_INDISPONIVEL,
  isEtapaDePerda,
  primeiraEtapaSemPerda,
} from "@/modules/pipelines/lib/loss-reason";

interface AddLeadToPipeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string;
  pipelineName: string;
  stages: CustomPipelineStage[];
  /** Etapa já escolhida ao abrir (o "+" ao pé da coluna). */
  defaultStageId?: string | null;
  /**
   * Move o card que o lead já tem neste funil para a etapa escolhida. Devolve
   * `false` quando não conseguiu (card fora do quadro): o modal então manda
   * arrastar o card. Sem a prop, o modal só avisa onde o lead está.
   */
  onMoverCardExistente?: (entryId: string, stageId: string) => boolean;
}

/** Card aberto, sem negócio, que o lead já tem neste funil. */
interface CardExistente {
  id: string;
  lead_id: string;
  stage_id: string;
}

interface LeadResult {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
}

export function AddLeadToPipeModal({
  open,
  onOpenChange,
  pipelineId,
  pipelineName,
  stages,
  defaultStageId,
  onMoverCardExistente,
}: AddLeadToPipeModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  // Entrar no funil já perdido gravaria a perda sem motivo: a etapa de perda
  // não é selecionável aqui, e o default nunca cai nela (inclusive pelo "+" da
  // própria coluna de perda) — vai para a primeira etapa não-perda.
  const etapaPadrao = (preferida?: string | null): string => {
    const escolhida = preferida ? stages.find((s) => s.id === preferida) : undefined;
    if (escolhida && !isEtapaDePerda(escolhida)) return escolhida.id;
    return primeiraEtapaSemPerda(stages)?.id ?? "";
  };
  const [selectedStageId, setSelectedStageId] = useState<string>(() => etapaPadrao(defaultStageId));
  // Abrir pelo "+" de uma coluna traz a etapa daquela coluna.
  useEffect(() => {
    if (open && defaultStageId) setSelectedStageId(etapaPadrao(defaultStageId));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `etapaPadrao` lê `stages`, estável enquanto aberto
  }, [open, defaultStageId]);
  const selecionadaEhPerda = isEtapaDePerda(stages.find((s) => s.id === selectedStageId));
  const [isLeadModalOpen, setIsLeadModalOpen] = useState(false);
  const debouncedSearch = useDebounce(searchQuery, 300);
  const queryClient = useQueryClient();

  const { data: teamMember } = useCurrentTeamMember();
  const addLead = useAddLeadToCustomPipe();

  // Buscar leads por nome/empresa/telefone
  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ["lead_search_for_pipe", debouncedSearch, teamMember?.organization_id],
    queryFn: async () => {
      if (!teamMember?.organization_id || !debouncedSearch.trim()) return [];

      const query = `%${debouncedSearch.trim()}%`;
      // Telefone secundário do lead (lead_phones) também acha — Chamado 82c50502.
      const secundarios = await buscarLeadIdsPorTelefoneSecundario(
        queryClient,
        teamMember.organization_id,
        debouncedSearch,
      );
      const clauses = [`name.ilike.${query}`, `company.ilike.${query}`, `phone.ilike.${query}`];
      if (secundarios.length > 0) clauses.push(`id.in.(${secundarios.join(",")})`);
      const { data, error } = await supabase
        .from("leads")
        .select("id, name, company, phone, email")
        .eq("organization_id", teamMember.organization_id)
        .or(clauses.join(","))
        .limit(20);

      if (error) throw error;
      return (data || []) as LeadResult[];
    },
    enabled: !!teamMember?.organization_id && debouncedSearch.trim().length >= 2,
  });

  // Uma consulta para a busca inteira (nunca uma por lead): quem já tem card
  // aberto sem negócio neste funil — o mesmo recorte do índice que recusa o insert.
  const idsDaBusca = (searchResults ?? []).map((l) => l.id);
  const { data: cardsExistentes } = useQuery({
    queryKey: ["lead_search_for_pipe_cards", pipelineId, idsDaBusca],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_entries")
        .select("id, lead_id, stage_id")
        .eq("pipeline_id", pipelineId)
        .is("closed_at", null)
        .is("deal_id", null)
        .in("lead_id", idsDaBusca)
        .limit(1000);
      if (error) throw error;
      return (data || []) as CardExistente[];
    },
    enabled: open && idsDaBusca.length > 0,
  });
  const cardPorLead = new Map((cardsExistentes ?? []).map((c) => [c.lead_id, c]));
  const nomeDaEtapa = (stageId: string) => stages.find((s) => s.id === stageId)?.name ?? "outra etapa";

  const selectedLead = searchResults?.find((l) => l.id === selectedLeadId);
  const cardDoSelecionado = selectedLeadId ? cardPorLead.get(selectedLeadId) : undefined;
  const etapaAtual = cardDoSelecionado ? nomeDaEtapa(cardDoSelecionado.stage_id) : "";
  const etapaEscolhida = stages.find((s) => s.id === selectedStageId);
  const [moverFalhou, setMoverFalhou] = useState(false);

  const handleMover = () => {
    if (!cardDoSelecionado || !selectedStageId || selecionadaEhPerda || !onMoverCardExistente) return;
    if (onMoverCardExistente(cardDoSelecionado.id, selectedStageId)) handleClose();
    else setMoverFalhou(true);
  };

  const handleAdd = async () => {
    if (!selectedLeadId || !selectedStageId || selecionadaEhPerda) return;

    try {
      await addLead.mutateAsync({
        pipeline_id: pipelineId,
        lead_id: selectedLeadId,
        stage_id: selectedStageId,
      });

      toast.success(`Lead adicionado ao funil "${pipelineName}"`);
      handleClose();
    } catch (error: unknown) {
      // O lead já tem card aqui (outra aba, busca antiga): é aviso, não defeito.
      if (toAppError(error).code === "record.duplicate") {
        toast.info("Este lead já está neste funil.");
        void queryClient.invalidateQueries({ queryKey: ["lead_search_for_pipe_cards", pipelineId] });
        return;
      }
      notifyError(error, { fallback: "Não foi possível adicionar lead." });
    }
  };

  const handleNewLeadCreated = async (newLeadId?: string) => {
    if (!newLeadId) return;
    const stageId = selectedStageId && !selecionadaEhPerda ? selectedStageId : etapaPadrao(null);
    if (!stageId) return;

    try {
      await addLead.mutateAsync({
        pipeline_id: pipelineId,
        lead_id: newLeadId,
        stage_id: stageId,
      });
      toast.success(`Lead criado e adicionado ao funil "${pipelineName}"`);
      handleClose();
    } catch (error: any) {
      notifyError(error, { fallback: "Não foi possível adicionar lead ao funil." });
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setSearchQuery("");
    setSelectedLeadId(null);
    setMoverFalhou(false);
    setSelectedStageId(etapaPadrao(null));
    setIsLeadModalOpen(false);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar lead ao funil</DialogTitle>
          <DialogDescription>
            Busque um lead existente ou cadastre um novo para adicionar ao funil "{pipelineName}".
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Busca */}
          <div className="space-y-2">
            <Label>Buscar lead</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSelectedLeadId(null);
                }}
                placeholder="Nome, empresa ou telefone..."
                className="pl-9"
                autoFocus
              />
            </div>
          </div>

          {/* CTA para criar novo lead */}
          <Button
            variant="outline"
            className="w-full justify-center gap-2 border-dashed"
            onClick={() => setIsLeadModalOpen(true)}
          >
            <Plus className="w-4 h-4" />
            Cadastrar novo lead
          </Button>

          {/* Resultados da busca */}
          {debouncedSearch.trim().length >= 2 && (
            <div className="max-h-[200px] overflow-y-auto space-y-1 border rounded-lg p-1">
              {isSearching ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              ) : searchResults && searchResults.length > 0 ? (
                searchResults.map((lead) => (
                  <button
                    key={lead.id}
                    onClick={() => {
                      setSelectedLeadId(lead.id);
                      setMoverFalhou(false);
                    }}
                    className={cn(
                      "w-full text-left p-2 rounded-md transition-colors",
                      selectedLeadId === lead.id
                        ? "bg-primary-soft border border-primary/30"
                        : "hover:bg-muted"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-sm">{lead.name}</div>
                      {cardPorLead.has(lead.id) && (
                        <span className="shrink-0 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning-strong">
                          Já neste funil · {nomeDaEtapa(cardPorLead.get(lead.id)!.stage_id)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      {lead.company && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Building2 className="w-3 h-3" />
                          {lead.company}
                        </span>
                      )}
                      {lead.phone && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Phone className="w-3 h-3" />
                          {lead.phone}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              ) : (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  Nenhum lead encontrado
                </div>
              )}
            </div>
          )}

          {/* Lead selecionado */}
          {selectedLead && (
            <div className="flex items-center gap-2 rounded-xl border border-primary/25 bg-primary-soft p-2">
              <UserCheck className="w-4 h-4 text-primary-soft-foreground shrink-0" />
              <div className="text-sm">
                <span className="font-medium">{selectedLead.name}</span>
                {selectedLead.company && (
                  <span className="text-muted-foreground"> — {selectedLead.company}</span>
                )}
              </div>
            </div>
          )}

          {cardDoSelecionado && (
            <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-2 text-sm">
              <Info className="w-4 h-4 text-warning-strong shrink-0 mt-0.5" />
              <div>
                <p>Este lead já está neste funil, na etapa {etapaAtual}.</p>
                {onMoverCardExistente && moverFalhou && (
                  <p className="mt-1 text-muted-foreground">Arraste o card no quadro para mudar de etapa.</p>
                )}
              </div>
            </div>
          )}

          {/* Etapa inicial */}
          <div className="space-y-2">
            <Label>{cardDoSelecionado ? "Etapa" : "Etapa inicial"}</Label>
            <Select
              value={selectedStageId}
              onValueChange={setSelectedStageId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione a etapa..." />
              </SelectTrigger>
              <SelectContent>
                {stages.map((stage) => (
                  <SelectItem
                    key={stage.id}
                    value={stage.id}
                    disabled={isEtapaDePerda(stage)}
                    title={isEtapaDePerda(stage) ? ETAPA_DE_PERDA_INDISPONIVEL : undefined}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: stage.color || "#64748b" }}
                      />
                      {stage.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancelar
          </Button>
          {cardDoSelecionado ? (
            onMoverCardExistente &&
            !moverFalhou && (
              <Button
                onClick={handleMover}
                disabled={
                  !selectedStageId ||
                  selecionadaEhPerda ||
                  selectedStageId === cardDoSelecionado.stage_id
                }
              >
                Mover para {etapaEscolhida?.name ?? "a etapa"}
              </Button>
            )
          ) : (
            <Button
              onClick={handleAdd}
              disabled={!selectedLeadId || !selectedStageId || selecionadaEhPerda || addLead.isPending}
            >
              {addLead.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Adicionar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <LeadModal
      open={isLeadModalOpen}
      onOpenChange={setIsLeadModalOpen}
      skipPipeSelector
      onSuccess={handleNewLeadCreated}
    />
    </>
  );
}
