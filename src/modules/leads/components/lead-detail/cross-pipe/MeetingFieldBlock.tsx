import { memo, useState, useEffect } from "react";
import { Calendar as CalendarIcon, Lock, Loader2, RefreshCw, Save, Plus, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import {
  type PipeConfirmacaoStatus,
  confirmacaoStatusColumns as statusColumns,
} from "@/contracts/pipe";
import type { Tables } from "@/integrations/supabase/types";
import { usePipeOps } from "../../../pipe-ops";
import { useNomeDoPipeDeSistema } from "../../../hooks/useNomeDoPipeDeSistema";
import { useQueryClient } from "@tanstack/react-query";
import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";
import { CompareceuModal } from "../../leads/funnel-contexts/modals/CompareceuModal";
import { cn } from "@/lib/utils";

type PipeConfirmacao = Tables<"pipe_confirmacao">;

/**
 * Cross-pipe field block for "Reunião" (meeting / confirmação pipeline).
 *
 * Renders one of three states based on props:
 *   - empty:     lead has no pipe_confirmacao entry → CTA "Adicionar à Confirmação"
 *   - editable:  pipeData present + locked=false → full inline editor
 *   - locked:    pipeData present + locked=true  → read-only with lock indicator
 */
interface MeetingFieldBlockProps {
  leadId: string;
  organizationId: string;
  pipeData: PipeConfirmacao | null;
  locked: boolean;
  onSuccess?: () => void;
  /**
   * When `true`, render without the outer rounded card wrapper. Used by
   * the CrossPipePanel's ActionPanel, which already provides the card
   * chrome. Default `false` keeps backward compatibility.
   */
  bare?: boolean;
}

export const MeetingFieldBlock = memo(function MeetingFieldBlock({
  leadId,
  pipeData,
  locked,
  onSuccess,
  bare = false,
}: MeetingFieldBlockProps) {
  const { useCreatePipeConfirmacao, useUpdatePipeConfirmacao, RescheduleModal, usePipelineId, moverNegocio, invalidateAfterMove } = usePipeOps();
  const createPipe = useCreatePipeConfirmacao();
  const updatePipe = useUpdatePipeConfirmacao();
  const queryClient = useQueryClient();
  // O funil de destino do "compareceu". A transição virou MOVE (ADR-0023 §4), e
  // mover exige o id do funil — antes só o hook de criação o conhecia.
  const { data: propostasPipelineId } = usePipelineId("propostas");
  // Nomes como a ORG os vê (SCRUM-641) — nada de "Confirmação"/"Propostas" cravados.
  const nomeDoPipe = useNomeDoPipeDeSistema();
  const nomeConfirmacao = nomeDoPipe("confirmacao");
  const nomePropostas = nomeDoPipe("propostas");
  const logAction = useLogLeadAction();
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [compareceuOpen, setCompareceuOpen] = useState(false);

  const initialMeetingValue = pipeData?.meeting_date
    ? format(new Date(pipeData.meeting_date), "yyyy-MM-dd'T'HH:mm")
    : "";
  const [meetingLocal, setMeetingLocal] = useState(initialMeetingValue);
  const [statusLocal, setStatusLocal] = useState<PipeConfirmacaoStatus>(
    pipeData?.status ?? "reuniao_marcada",
  );

  // Reset local state when entry changes
  useEffect(() => {
    setMeetingLocal(
      pipeData?.meeting_date
        ? format(new Date(pipeData.meeting_date), "yyyy-MM-dd'T'HH:mm")
        : "",
    );
    setStatusLocal(pipeData?.status ?? "reuniao_marcada");
  }, [pipeData?.id, pipeData?.meeting_date, pipeData?.status]);

  // ─── State: empty ──────────────────────────────────────────────────
  if (!pipeData) {
    const handleAdd = async () => {
      try {
        await createPipe.mutateAsync({
          lead_id: leadId,
          status: "reuniao_marcada",
        });
        logAction({
          leadId,
          action: "pipe_added",
          description: `Lead adicionado ao funil "${nomeConfirmacao}"`,
        });
        toast.success(`Lead adicionado a ${nomeConfirmacao}`);
        onSuccess?.();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : `Erro ao adicionar a ${nomeConfirmacao}`;
        toast.error(msg);
      }
    };

    return (
      <div className="rounded-xl border border-dashed border-border/40 bg-muted/20 p-4 text-center space-y-3">
        <CalendarIcon className="w-6 h-6 mx-auto text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">Sem reunião marcada</p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleAdd}
          disabled={createPipe.isPending}
          className="gap-1.5"
        >
          {createPipe.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Plus className="w-3.5 h-3.5" />
          )}
          Adicionar a {nomeConfirmacao}
        </Button>
      </div>
    );
  }

  // ─── State: locked / editable ──────────────────────────────────────

  const currentStatus = statusColumns.find((s) => s.id === pipeData.status);
  const meetingDate = pipeData.meeting_date ? new Date(pipeData.meeting_date) : null;

  if (locked) {
    return (
      <div
        className={cn(
          bare ? "space-y-2 relative" : "rounded-xl border border-border/40 bg-card p-4 space-y-2 relative",
        )}
      >
        <div
          aria-label="Somente leitura — sem permissão para editar"
          className="absolute top-3 right-3 text-muted-foreground/50"
        >
          <Lock className="w-3.5 h-3.5" />
        </div>
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Reunião</span>
        </div>
        {meetingDate && (
          <p className="text-sm">
            {format(meetingDate, "EEEE, dd 'de' MMMM 'às' HH:mm", { locale: ptBR })}
          </p>
        )}
        {currentStatus && (
          <Badge
            variant="outline"
            style={{
              backgroundColor: `${currentStatus.color}15`,
              borderColor: `${currentStatus.color}40`,
              color: currentStatus.color,
            }}
          >
            {currentStatus.title}
          </Badge>
        )}
      </div>
    );
  }

  const dirty =
    meetingLocal !== initialMeetingValue || statusLocal !== (pipeData.status ?? "");

  const handleSave = async () => {
    try {
      const updates: Record<string, unknown> = {
        id: pipeData.id,
        status: statusLocal,
        leadId,
        assignedTo: pipeData.responsible_id,
      };
      if (meetingLocal) {
        const dt = new Date(meetingLocal);
        if (!Number.isNaN(dt.getTime())) updates.meeting_date = dt.toISOString();
      } else {
        updates.meeting_date = null;
      }
      await updatePipe.mutateAsync(updates as any);
      logAction({
        leadId,
        action: "field_updated",
        description: "Reunião atualizada via modal do lead",
      });
      toast.success("Reunião atualizada");
      onSuccess?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao atualizar reunião";
      toast.error(msg);
    }
  };

  return (
    <div className={cn(bare ? "space-y-3" : "rounded-xl border border-border/40 bg-card p-4 space-y-3")}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Reunião</span>
          {dirty && <span aria-label="Mudanças não salvas" className="text-amber-500">•</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-7 text-xs"
            onClick={() => setCompareceuOpen(true)}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Marcar comparecimento
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-7 text-xs"
            onClick={() => setRescheduleOpen(true)}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Remarcar
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Data e horário</Label>
          <Input
            type="datetime-local"
            value={meetingLocal}
            onChange={(e) => setMeetingLocal(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select
            value={statusLocal}
            onValueChange={(v) => setStatusLocal(v as PipeConfirmacaoStatus)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusColumns.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={updatePipe.isPending || !dirty}
          className={cn("gap-1.5")}
        >
          {updatePipe.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          Salvar Reunião
        </Button>
      </div>

      <RescheduleModal
        open={rescheduleOpen}
        onOpenChange={setRescheduleOpen}
        mode="reschedule"
        pipeItem={pipeData ? ({ ...pipeData, lead: { id: leadId } } as any) : null}
        onSuccess={() => {
          onSuccess?.();
          setRescheduleOpen(false);
        }}
      />

      <CompareceuModal
        open={compareceuOpen}
        onOpenChange={setCompareceuOpen}
        leadName="Lead"
        currentResponsibleId={pipeData.responsible_id ?? null}
        isLoading={updatePipe.isPending}
        onConfirm={async (responsibleId) => {
          try {
            /**
             * ADR-0023 decisão 4: o negócio MOVE para Orçamentos.
             *
             * Antes daqui saía um `createPipeProposta` que INSERIA um card novo,
             * e o de Confirmação ficava em "compareceu" para sempre — o mesmo
             * gêmeo que a tela de funil produzia.
             *
             * A ordem é a mesma das outras duas telas, e pelo mesmo motivo: o
             * `updatePipe` leva o card à etapa de sucesso e é ELE que emite
             * `meeting_held`, porque o gatilho reage à transição. Só depois o
             * funil troca, na mesma linha.
             *
             * ⚠️ HERDADO — as etapas seguem chumbadas aqui ("compareceu",
             * "marcar_compromisso") em vez de virem de `pipeline_stages`, como
             * na tela de funil. É um dos 3 de 5 caminhos com esse defeito;
             * consertar exige carregar as etapas neste componente, e trocar o
             * comportamento junto com o move misturaria duas mudanças numa só.
             */
            // Capturado num const local: o `await` entre a guarda e o uso faz o
            // TypeScript reabrir o tipo do valor vindo do hook.
            const targetPipelineId = propostasPipelineId;
            if (!targetPipelineId) {
              throw new Error("Funil de destino não encontrado nesta organização");
            }
            // `pipeData.id` é `string | null` no tipo da view. Card sem id não é
            // posição que se possa mover — falhar aqui é melhor que mandar null
            // para o banco e receber "negócio não encontrado".
            const entryId = pipeData.id;
            if (!entryId) {
              throw new Error("Card sem identificador — recarregue a página");
            }

            await updatePipe.mutateAsync({
              id: pipeData.id,
              status: "compareceu" as PipeConfirmacaoStatus,
              responsible_id: responsibleId,
              leadId,
              assignedTo: responsibleId,
            } as any);

            await moverNegocio({
              entryId,
              targetPipelineId,
              targetStageKey: "marcar_compromisso",
              stageOrigem: null,
              assignedTo: responsibleId,
            });
            invalidateAfterMove(queryClient, leadId);
            logAction({
              leadId,
              action: "meeting_attended",
              description: `Lead compareceu — promovido para ${nomePropostas}`,
            });
            toast.success(`Lead movido para ${nomePropostas}`);
            setCompareceuOpen(false);
            onSuccess?.();
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Erro ao registrar comparecimento";
            toast.error(msg);
          }
        }}
      />
    </div>
  );
});
