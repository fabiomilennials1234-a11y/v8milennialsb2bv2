/**
 * useFunilMoveFlow — os fluxos RICOS de move da página unificada `/funil/:slug`
 * (SCRUM-637, fechamento do slot que a 632 deixou em `handleMove`).
 *
 * Porte item a item dos 3 boards de sistema, generalizado por PAPEL
 * (`pipeline_stages.stage_role`), nunca por slug — um funil custom com etapa
 * `won` ganha o fluxo de vendido igual (é o prêmio da fatia):
 *
 *   · `lost` (ou legado `is_final_negative` sem role) → diálogo de motivo da
 *     perda (SCRUM-369: motivo OBRIGATÓRIO, "Outro" exige texto; grava
 *     `loss_reason_id` + rótulo snapshotado `loss_reason` no metadata ANTES do
 *     move — o desfecho viaja com a transição);
 *   · `won` → guarda de valor (`useSaleValueGuard`, D1/SQL-I3) e, com TinyERP
 *     conectado, o modal de pedido (`tinyerp-push-order` lê `pipeline_entries`
 *     por id — funciona para QUALQUER funil). Cadastro Externo fica restrito ao
 *     funil `propostas` de sistema porque a edge fn `cadastro-externo-push` lê
 *     a VIEW `pipe_propostas` (documentado; generalizar exige mudar a fn);
 *   · `meeting_booked` → modal de data de reunião. Funil com o trilho D-x
 *     (colunas `confirmar_d*`) usa o `RescheduleModal` legado (data + Google
 *     Calendar + etapa recalculada pela data); os demais usam o
 *     `SetMeetingDateModal` genérico e completam o move na etapa arrastada;
 *   · etapa de sucesso com DESTINO configurado (família system — o caminho
 *     custom já auto-transiciona dentro de `useMoveLeadInCustomPipe`):
 *     destino custom → `upsertLeadIntoCustomPipe` pós-move; destino
 *     `confirmacao` → `AddMeetingModal` (agenda + MOVE o negócio, ADR-0023 d4);
 *     destino `propostas` → `CompareceuModal` + `moverNegocio`.
 *
 * A ORDEM da resolução importa e espelha as páginas velhas: lost → won →
 * destino declarado → meeting_booked genérico → move simples.
 *
 * Escrita: metadata primeiro (`patchEntryMetadata`), move depois
 * (`useMoverCardNoFunil`) — o ledger de venda snapshota o metadata NO instante
 * da transição, então o valor/motivo precisa estar lá antes. Pós-move de
 * sistema: `lead_history` + track `card_moved` + follow-up automation, como as
 * páginas velhas faziam (o board custom legado nunca fez — paridade mantida).
 */
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { CompareceuModal } from "@/modules/leads";
import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";
import { track } from "@/lib/analytics";
import { triggerFollowUpAutomation } from "@/modules/workflows/hooks/useAutoFollowUp";
import { TinyErpConfirmOrderDialog } from "@/modules/carteira/components/proposal/TinyErpConfirmOrderDialog";
import { CadastroExternoConfirmDialog } from "@/modules/carteira/components/proposal/CadastroExternoConfirmDialog";
import { useTinyErpStatus } from "@/modules/carteira/hooks/useTinyErp";
import { useCadastroExternoEnabled } from "@/modules/marketing/hooks/useCadastroExterno";
import type { CustomPipelineStage, StageRole } from "@/contracts/pipe";
import type { Pipeline } from "@/modules/pipelines/hooks/model/usePipelines";
import { useMoverCardNoFunil } from "@/modules/pipelines/hooks/model/usePaginatedFunil";
import { useUpdatePipeConfirmacao } from "@/modules/pipelines/hooks/legacy/usePipeConfirmacao";
import { patchEntryMetadata } from "@/modules/pipelines/lib/entry-metadata";
import { upsertLeadIntoCustomPipe } from "@/modules/pipelines/lib/stageTransition";
import { moverNegocio, invalidateAfterMove } from "@/modules/pipelines/lib/moverNegocio";
import { isWonStageKey, parseSaleValue } from "@/modules/pipelines/lib/sale-value-guard";
import { useSaleValueGuard } from "@/modules/pipelines/hooks/useSaleValueGuard";
import { SaleValueRequiredModal } from "@/shared/components/SaleValueRequiredModal";
import { useLossReasons } from "@/modules/pipelines/hooks/config/useLossReasons";
import {
  exigeTextoLivre,
  resolverMotivoDaPerda,
  type MotivoDePerda,
} from "@/modules/pipelines/lib/loss-reason";
import { SetMeetingDateModal } from "@/modules/pipelines/components/kanban/SetMeetingDateModal";
import { RescheduleModal } from "@/modules/pipelines/components/legacy/confirmacao/RescheduleModal";
import { AddMeetingModal } from "@/modules/pipelines/components/legacy/confirmacao/AddMeetingModal";
import { DX_TARGET_KEYS } from "@/modules/pipelines/lib/meeting-dx";

/** Fallback quando a org não cadastrou motivos (mesma lista do PipePropostas). */
const LOSS_REASONS_FALLBACK: MotivoDePerda[] = [
  { value: "sem_budget", label: "Sem budget", doCatalogo: false },
  { value: "concorrencia", label: "Concorrência", doCatalogo: false },
  { value: "timing", label: "Timing errado", doCatalogo: false },
  { value: "follow_up_fraco", label: "Follow-up fraco", doCatalogo: false },
  { value: "produto_nao_adequado", label: "Produto não adequado", doCatalogo: false },
  { value: "outro", label: "Outro", doCatalogo: false },
];

/**
 * Fallback LEGADO de destino quando a etapa de sucesso não declara
 * `target_pipe_type` — cada página velha chumbava o seu; aqui o par vira dado.
 * NÃO cresce: funil novo declara destino na etapa ou não transiciona.
 */
const LEGACY_DEFAULT_TARGET: Record<string, string> = {
  whatsapp: "confirmacao",
  confirmacao: "propostas",
};

/** Shape mínimo que o fluxo precisa de uma entry achatada (`flattenMetadata`). */
export interface FunilFlowEntry {
  id: string;
  lead_id: string | null;
  stage_key: string;
  status?: string;
  sale_value?: unknown;
  sdr_id?: string | null;
  closer_id?: string | null;
  responsible_id?: string | null;
  sale_responsible_id?: string | null;
  contract_duration?: number | null;
  meeting_date?: string | null;
  notes?: string | null;
  lead?: {
    id?: string;
    name?: string | null;
    company?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
}

interface UseFunilMoveFlowParams {
  pipeline: Pipeline | undefined;
  /** Lista completa de `pipelines` da org — resolve destino por slug. */
  pipelines: Pipeline[];
  stages: CustomPipelineStage[];
  findEntry: (entryId: string) => FunilFlowEntry | undefined;
}

const roleDe = (stage: CustomPipelineStage): StageRole => stage.stage_role ?? "open";

const ehLost = (stage: CustomPipelineStage): boolean =>
  roleDe(stage) === "lost" || (roleDe(stage) === "open" && stage.is_final_negative);

export function useFunilMoveFlow({
  pipeline,
  pipelines,
  stages,
  findEntry,
}: UseFunilMoveFlowParams) {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const mover = useMoverCardNoFunil(pipeline ? { id: pipeline.id, type: pipeline.type } : null);
  const updateEntryConfirmacao = useUpdatePipeConfirmacao();
  const logAction = useLogLeadAction();
  const { data: tinyStatus } = useTinyErpStatus();
  const cadastroExternoEnabled = useCadastroExternoEnabled();

  const ehSystem = pipeline?.type === "system";
  const stageKeySet = useMemo(() => new Set(stages.map((s) => s.stage_key)), [stages]);
  /** Funil monta o trilho D-x da Confirmação? (decide qual modal de reunião.) */
  const temTrilhoDx = useMemo(
    () => DX_TARGET_KEYS.filter((k) => k !== "remarcar").every((k) => stageKeySet.has(k)),
    [stageKeySet],
  );

  // ── Guarda de valor (D1/SQL-I3) ──────────────────────────────────────────
  const saleGuard = useSaleValueGuard(stages);
  const [wonValueLeadName, setWonValueLeadName] = useState<string | undefined>(undefined);

  // ── Estados dos interceptores ────────────────────────────────────────────
  const [pendingLost, setPendingLost] = useState<{ entryId: string; stage: CustomPipelineStage } | null>(null);
  const [selectedLossReason, setSelectedLossReason] = useState("");
  const [lossReasonNote, setLossReasonNote] = useState("");

  const [pendingWonTiny, setPendingWonTiny] = useState<{
    entryId: string;
    stage: CustomPipelineStage;
    lead: FunilFlowEntry["lead"];
    totalValue: number;
    saleValue?: number;
  } | null>(null);
  const [tinyConfirmOpen, setTinyConfirmOpen] = useState(false);

  const [pendingWonCadastro, setPendingWonCadastro] = useState<{
    entryId: string;
    stage: CustomPipelineStage;
    lead: FunilFlowEntry["lead"];
    totalValue: number;
    contractDuration: number | null;
    proposalNotes: string | null;
    saleValue?: number;
  } | null>(null);
  const [cadastroOpen, setCadastroOpen] = useState(false);

  const [pendingMeetingDate, setPendingMeetingDate] = useState<{
    entryId: string;
    stage: CustomPipelineStage;
    entry: FunilFlowEntry;
  } | null>(null);

  const [pendingReschedule, setPendingReschedule] = useState<FunilFlowEntry | null>(null);

  const [meetingModal, setMeetingModal] = useState<{
    entryId: string;
    stage: CustomPipelineStage;
    entry: FunilFlowEntry;
  } | null>(null);

  const [pendingCompareceu, setPendingCompareceu] = useState<{
    entryId: string;
    stage: CustomPipelineStage;
    entry: FunilFlowEntry;
  } | null>(null);
  const [processingCompareceu, setProcessingCompareceu] = useState(false);

  // ── Motivos de perda (SCRUM-369) ─────────────────────────────────────────
  const { data: dbLossReasons } = useLossReasons();
  const lossReasons = useMemo<MotivoDePerda[]>(() => {
    if (dbLossReasons && dbLossReasons.length > 0) {
      return dbLossReasons.map((r) => ({ value: r.id, label: r.name, doCatalogo: true }));
    }
    return LOSS_REASONS_FALLBACK;
  }, [dbLossReasons]);

  const perdaResolvida = useMemo(
    () => resolverMotivoDaPerda(selectedLossReason, lossReasonNote, lossReasons),
    [selectedLossReason, lossReasonNote, lossReasons],
  );
  const precisaDeTexto = useMemo(
    () => exigeTextoLivre(selectedLossReason, lossReasons),
    [selectedLossReason, lossReasons],
  );

  // ── Pós-move das páginas de sistema: trilha + métrica + automação ────────
  const posMoveSistema = useCallback(
    (entry: FunilFlowEntry, stage: CustomPipelineStage, extraTrackMeta?: Record<string, unknown>) => {
      if (!ehSystem || !pipeline) return;
      if (entry.lead_id) {
        logAction({
          leadId: entry.lead_id,
          action: "stage_changed",
          description: `Etapa alterada para "${stage.name}" no funil ${pipeline.name}`,
        });
      }
      if (organizationId) {
        track({
          event: "card_moved",
          organizationId,
          entityType: `pipe_${pipeline.slug}`,
          entityId: entry.id,
          metadata: { from_stage: entry.stage_key, to_stage: stage.stage_key, ...extraTrackMeta },
        });
      }
      // `follow_up_automations` só existem chaveadas pelos 3 slugs legados —
      // funil de sistema fora do trio não tem automação a disparar.
      if (
        entry.lead_id &&
        organizationId &&
        (pipeline.slug === "whatsapp" || pipeline.slug === "confirmacao" || pipeline.slug === "propostas")
      ) {
        void triggerFollowUpAutomation({
          leadId: entry.lead_id,
          assignedTo:
            entry.sale_responsible_id ?? entry.responsible_id ?? entry.sdr_id ?? entry.closer_id ?? null,
          pipeType: pipeline.slug,
          stage: stage.stage_key,
          sourcePipeId: entry.id,
          organizationId,
        });
      }
    },
    [ehSystem, pipeline, organizationId, logAction],
  );

  /**
   * Passo final de todo fluxo: metadata primeiro (quando houver desfecho),
   * move depois; auto-transição p/ funil custom de destino no fim (família
   * system — o caminho custom já a executa dentro do próprio move).
   */
  const completarMove = useCallback(
    async (
      entryId: string,
      stage: CustomPipelineStage,
      opts: { metadataPatch?: Record<string, unknown>; successToast?: string } = {},
    ) => {
      const entry = findEntry(entryId);
      try {
        if (opts.metadataPatch && Object.keys(opts.metadataPatch).length > 0) {
          await patchEntryMetadata(entryId, opts.metadataPatch);
        }
        await mover.mutateAsync({ entryId, stageId: stage.id, stageKey: stage.stage_key });

        if (entry) posMoveSistema(entry, stage);
        if (opts.successToast) toast.success(opts.successToast);

        if (
          ehSystem &&
          stage.is_final_positive &&
          stage.target_pipeline_id &&
          stage.target_stage_id &&
          organizationId &&
          entry?.lead_id
        ) {
          await upsertLeadIntoCustomPipe({
            leadId: entry.lead_id,
            organizationId,
            targetPipelineId: stage.target_pipeline_id,
            targetStageId: stage.target_stage_id,
          });
          queryClient.invalidateQueries({ queryKey: ["custom_pipe_entries"] });
          toast.success("Lead movido para o funil de destino automaticamente!");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        toast.error(
          msg.includes("permissão") || msg.includes("Permissões") ? msg : "Erro ao mover lead",
        );
      }
    },
    [findEntry, mover, posMoveSistema, ehSystem, organizationId, queryClient],
  );

  // ── Vendido (won) ────────────────────────────────────────────────────────
  const concluirWon = useCallback(
    async (entryId: string, stage: CustomPipelineStage, saleValue?: number) => {
      await completarMove(entryId, stage, {
        metadataPatch: saleValue !== undefined ? { sale_value: saleValue } : undefined,
        successToast: "🎉 Venda fechada com sucesso!",
      });
    },
    [completarMove],
  );

  const continuarWon = useCallback(
    async (entryId: string, stage: CustomPipelineStage, saleValueOverride?: number) => {
      const entry = findEntry(entryId);
      if (!entry || !pipeline) return;

      const totalValue =
        saleValueOverride ?? parseSaleValue(entry.sale_value) ?? 0;

      // TinyERP conectado → modal de pedido. Cache primeiro; sem cache, sonda
      // inline (mesma ponte do PipePropostas para primeira render).
      let tinyConnected = tinyStatus?.connected ?? false;
      if (!tinyStatus && organizationId) {
        try {
          const { data: conn } = await supabase
            .from("tinyerp_connections")
            .select("status")
            .eq("organization_id", organizationId)
            .eq("status", "connected")
            .maybeSingle();
          tinyConnected = !!conn;
        } catch {
          // best-effort — segue sem o modal
        }
      }

      if (tinyConnected) {
        setPendingWonTiny({
          entryId,
          stage,
          lead: entry.lead,
          totalValue,
          saleValue: saleValueOverride,
        });
        setTinyConfirmOpen(true);
        return;
      }

      // Cadastro Externo: a edge fn lê a view `pipe_propostas` — só o funil
      // propostas de sistema pode usar este caminho (documentado no cabeçalho).
      if (cadastroExternoEnabled && ehSystem && pipeline.slug === "propostas") {
        setPendingWonCadastro({
          entryId,
          stage,
          lead: entry.lead,
          totalValue,
          contractDuration: entry.contract_duration ?? null,
          proposalNotes: entry.notes ?? null,
          saleValue: saleValueOverride,
        });
        setCadastroOpen(true);
        return;
      }

      await concluirWon(entryId, stage, saleValueOverride);
    },
    [findEntry, pipeline, tinyStatus, organizationId, cadastroExternoEnabled, ehSystem, concluirWon],
  );

  // ── Perdido (lost) ───────────────────────────────────────────────────────
  const fecharLossDialog = useCallback(() => {
    setPendingLost(null);
    setSelectedLossReason("");
    setLossReasonNote("");
  }, []);

  const handleLossConfirm = useCallback(async () => {
    if (!pendingLost || !perdaResolvida) return;
    const { entryId, stage } = pendingLost;
    fecharLossDialog();
    await completarMove(entryId, stage, {
      metadataPatch: {
        ...(perdaResolvida.id ? { loss_reason_id: perdaResolvida.id } : {}),
        ...(perdaResolvida.texto ? { loss_reason: perdaResolvida.texto } : {}),
      },
    });
    toast("Negócio marcado como perdido");
  }, [pendingLost, perdaResolvida, fecharLossDialog, completarMove]);

  // ── Compareceu → Orçamentos (ADR-0023 d4: MOVE, não copia) ───────────────
  const handleCompareceuConfirm = useCallback(
    async (responsibleId: string | null) => {
      if (!pendingCompareceu || !pipeline) return;
      const { entryId, stage, entry } = pendingCompareceu;
      const propostasPipeline = pipelines.find(
        (p) => p.type === "system" && p.slug === "propostas" && p.is_active !== false,
      );

      setProcessingCompareceu(true);
      try {
        if (!propostasPipeline) {
          throw new Error("Funil de Orçamentos não encontrado nesta organização");
        }
        const targetStageKey = stage.target_stage_key || "marcar_compromisso";

        // Passo 1 — responsável + etapa de sucesso (produz `meeting_held`).
        await updateEntryConfirmacao.mutateAsync({
          id: entryId,
          status: stage.stage_key as never,
          sdr_id: responsibleId,
          leadId: entry.lead_id ?? undefined,
          assignedTo: responsibleId,
        });

        // Passo 2 — a MESMA linha troca de funil. Nenhum card novo.
        await moverNegocio({
          entryId,
          targetPipelineId: propostasPipeline.id,
          targetStageKey,
          stageOrigem: null,
          assignedTo: responsibleId,
        });

        invalidateAfterMove(queryClient, entry.lead_id ?? undefined);

        if (entry.lead_id) {
          logAction({
            leadId: entry.lead_id,
            action: "meeting_attended",
            description: "Lead compareceu à reunião e movido para Gestão de Propostas",
          });
        }
        if (organizationId) {
          track({
            event: "card_moved",
            organizationId,
            entityType: `pipe_${pipeline.slug}`,
            entityId: entryId,
            metadata: { from_stage: stage.stage_key, to_stage: targetStageKey, moved_to_pipe: "propostas" },
          });
        }
        toast.success("Negócio movido para Gestão de Propostas!");
        setPendingCompareceu(null);
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Erro ao processar comparecimento";
        toast.error(msg);
      } finally {
        setProcessingCompareceu(false);
      }
    },
    [pendingCompareceu, pipeline, pipelines, updateEntryConfirmacao, queryClient, logAction, organizationId],
  );

  // ── O interceptador ──────────────────────────────────────────────────────
  const requestMove = useCallback(
    (entryId: string, stage: CustomPipelineStage) => {
      const entry = findEntry(entryId);
      if (!entry || !pipeline) {
        console.warn("[Funil] Entry não encontrada no board:", entryId);
        return;
      }

      // 1. Perdido — motivo obrigatório antes do move (SCRUM-369).
      if (ehLost(stage)) {
        setSelectedLossReason("");
        setLossReasonNote("");
        setPendingLost({ entryId, stage });
        return;
      }

      // 2. Vendido — guarda de valor; o valor entra no metadata ANTES do move.
      if (isWonStageKey(stage.stage_key, stages)) {
        setWonValueLeadName(entry.lead?.name || undefined);
        saleGuard.guardWonTransition({
          targetStageKey: stage.stage_key,
          currentValue: parseSaleValue(entry.sale_value),
          proceed: (enteredValue) => {
            void continuarWon(entryId, stage, enteredValue);
          },
        });
        return;
      }

      // 3. Etapa de sucesso com destino declarado (família system; custom
      //    auto-transiciona dentro de useMoveLeadInCustomPipe).
      const hasCustomTarget = !!(stage.target_pipeline_id && stage.target_stage_id);
      if (stage.is_final_positive && hasCustomTarget) {
        // Destino = funil customizado: move simples + auto-transição no
        // pós-move. Abrir modal de reunião aqui agendaria uma reunião que
        // ninguém pediu (mesma regra da página velha).
        void completarMove(entryId, stage);
        return;
      }
      if (ehSystem && stage.is_final_positive) {
        const alvo = stage.target_pipe_type || LEGACY_DEFAULT_TARGET[pipeline.slug] || null;
        if (alvo === "confirmacao") {
          // Agendar reunião + MOVER o negócio pra Confirmação (ADR-0023 d4).
          setMeetingModal({ entryId, stage, entry });
          return;
        }
        if (alvo === "propostas") {
          setPendingCompareceu({ entryId, stage, entry });
          return;
        }
      }

      // 4. Reunião marcada (meeting_booked) — modal de data.
      if (roleDe(stage) === "meeting_booked") {
        if (temTrilhoDx) {
          // Trilho D-x: o modal legado grava a data e RECALCULA a etapa pela
          // data (confirmar_d1..d5 / no dia) — mesmo comportamento da página
          // velha de Confirmação.
          setPendingReschedule(entry);
        } else {
          setPendingMeetingDate({ entryId, stage, entry });
        }
        return;
      }

      // 5. Move simples.
      void completarMove(entryId, stage);
    },
    [findEntry, pipeline, stages, saleGuard, continuarWon, ehSystem, temTrilhoDx, completarMove],
  );

  // ── Diálogos (renderizados pela página) ──────────────────────────────────
  const dialogs = (
    <>
      {/* Guarda de valor antes do won (D1/SQL-I3) */}
      <SaleValueRequiredModal
        open={saleGuard.saleValueModalOpen}
        onConfirm={saleGuard.confirmSaleValue}
        onCancel={saleGuard.cancelSaleValue}
        leadName={wonValueLeadName}
      />

      {/* Motivo da perda (SCRUM-369) — obrigatório; "Outro" exige texto */}
      <AlertDialog
        open={!!pendingLost}
        onOpenChange={(open) => {
          if (!open) fecharLossDialog();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Motivo da perda</AlertDialogTitle>
            <AlertDialogDescription>
              Sem o motivo, a perda vira só um número. É ele que responde onde o
              funil está furando.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-2 px-1 py-2">
            <Select value={selectedLossReason} onValueChange={setSelectedLossReason}>
              <SelectTrigger>
                <SelectValue placeholder="Selecionar motivo" />
              </SelectTrigger>
              <SelectContent>
                {lossReasons.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {precisaDeTexto && (
              <Textarea
                value={lossReasonNote}
                onChange={(e) => setLossReasonNote(e.target.value)}
                placeholder="Qual foi o motivo? (obrigatório)"
                rows={3}
                autoFocus
              />
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                fecharLossDialog();
                toast("Operação cancelada");
              }}
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLossConfirm}
              disabled={!perdaResolvida}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Confirmar Perda
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* TinyERP: confirmar pedido no drag-to-vendido */}
      {pendingWonTiny && (
        <TinyErpConfirmOrderDialog
          open={tinyConfirmOpen}
          onOpenChange={(open) => {
            setTinyConfirmOpen(open);
            if (!open && pendingWonTiny) {
              const pv = pendingWonTiny;
              setPendingWonTiny(null);
              // Fechou (overlay/esc/skip) — o vendido completa mesmo assim,
              // com skip do auto-push (o modal já tratou o pedido).
              void concluirWon(pv.entryId, pv.stage, pv.saleValue);
            }
          }}
          pipePropostaId={pendingWonTiny.entryId}
          lead={pendingWonTiny.lead as never}
          items={[]}
          totalValue={pendingWonTiny.totalValue}
          onSuccess={() => {
            const pv = pendingWonTiny;
            setPendingWonTiny(null);
            setTinyConfirmOpen(false);
            if (pv) void concluirWon(pv.entryId, pv.stage, pv.saleValue);
          }}
        />
      )}

      {/* Cadastro Externo (só propostas de sistema — contrato da edge fn) */}
      {pendingWonCadastro && (
        <CadastroExternoConfirmDialog
          open={cadastroOpen}
          onOpenChange={(open) => {
            setCadastroOpen(open);
            if (!open && pendingWonCadastro) {
              const pv = pendingWonCadastro;
              setPendingWonCadastro(null);
              void concluirWon(pv.entryId, pv.stage, pv.saleValue);
            }
          }}
          pipePropostaId={pendingWonCadastro.entryId}
          lead={pendingWonCadastro.lead as never}
          items={[]}
          totalValue={pendingWonCadastro.totalValue}
          contractDuration={pendingWonCadastro.contractDuration}
          proposalNotes={pendingWonCadastro.proposalNotes}
          onSuccess={() => {
            const pv = pendingWonCadastro;
            setPendingWonCadastro(null);
            setCadastroOpen(false);
            if (pv) void concluirWon(pv.entryId, pv.stage, pv.saleValue);
          }}
        />
      )}

      {/* Data de reunião — funil SEM trilho D-x (genérico por papel) */}
      {pendingMeetingDate && (
        <SetMeetingDateModal
          open={!!pendingMeetingDate}
          onOpenChange={(open) => {
            if (!open) setPendingMeetingDate(null);
          }}
          entryId={pendingMeetingDate.entryId}
          leadId={pendingMeetingDate.entry.lead_id}
          leadName={pendingMeetingDate.entry.lead?.name ?? null}
          leadCompany={pendingMeetingDate.entry.lead?.company ?? null}
          leadPhone={pendingMeetingDate.entry.lead?.phone ?? null}
          onSaved={() => {
            const pm = pendingMeetingDate;
            setPendingMeetingDate(null);
            if (pm) void completarMove(pm.entryId, pm.stage, { successToast: "📅 Reunião agendada!" });
          }}
        />
      )}

      {/* Data de reunião — funil COM trilho D-x (modal legado; a etapa sai da data) */}
      <RescheduleModal
        open={!!pendingReschedule}
        onOpenChange={(open) => {
          if (!open) setPendingReschedule(null);
        }}
        mode="schedule"
        pipeItem={
          pendingReschedule && pendingReschedule.lead_id
            ? {
                id: pendingReschedule.id,
                lead_id: pendingReschedule.lead_id,
                lead: pendingReschedule.lead
                  ? {
                      name: pendingReschedule.lead.name ?? undefined,
                      company: pendingReschedule.lead.company ?? undefined,
                      phone: pendingReschedule.lead.phone ?? undefined,
                    }
                  : null,
                responsible_id: pendingReschedule.responsible_id ?? null,
                sdr_id: pendingReschedule.sdr_id ?? null,
                closer_id: pendingReschedule.closer_id ?? null,
                meeting_date: pendingReschedule.meeting_date ?? null,
              }
            : null
        }
        onSuccess={() => {
          setPendingReschedule(null);
          queryClient.invalidateQueries({ queryKey: ["pipeline-page"] });
          queryClient.invalidateQueries({ queryKey: ["pipeline-stage-counts"] });
        }}
      />

      {/* Agendar + mover pra Confirmação (etapa de sucesso → confirmacao) */}
      {meetingModal && (
        <AddMeetingModal
          open={!!meetingModal}
          onOpenChange={(isOpen) => {
            if (!isOpen) setMeetingModal(null);
          }}
          prefilledLeadId={meetingModal.entry.lead_id ?? undefined}
          prefilledResponsibleId={meetingModal.entry.sdr_id ?? undefined}
          moveFromEntryId={meetingModal.entryId}
          beforeSubmit={async () => {
            // A transição da ORIGEM pra etapa de sucesso — é ela que emite
            // `meeting_booked`. Falhou → o modal não escreve nada.
            await mover.mutateAsync({
              entryId: meetingModal.entryId,
              stageId: meetingModal.stage.id,
              stageKey: meetingModal.stage.stage_key,
            });
          }}
          onSuccess={() => {
            const pending = meetingModal;
            setMeetingModal(null);
            if (pending) {
              // Efeitos de LEITURA apenas — o UPDATE da origem já rodou no
              // beforeSubmit e o move no modal (ADR-0023 d4).
              posMoveSistema(pending.entry, pending.stage, { moved_to_pipe: "confirmacao" });
              invalidateAfterMove(queryClient, pending.entry.lead_id ?? undefined);
              toast.success("Reunião agendada e negócio movido para Confirmação!");
            }
          }}
        />
      )}

      {/* Compareceu → seleciona responsável e MOVE pra Orçamentos */}
      <CompareceuModal
        open={!!pendingCompareceu}
        onOpenChange={(open) => {
          if (!open) setPendingCompareceu(null);
        }}
        onConfirm={handleCompareceuConfirm}
        leadName={pendingCompareceu?.entry.lead?.name || "Lead"}
        currentResponsibleId={
          pendingCompareceu?.entry.responsible_id ||
          pendingCompareceu?.entry.sdr_id ||
          pendingCompareceu?.entry.closer_id
        }
        isLoading={processingCompareceu}
      />
    </>
  );

  return {
    requestMove,
    dialogs,
    isMoving: mover.isPending,
    /** Exposto p/ o recálculo D-x da página (mesma família de escrita). */
    updateEntryConfirmacao,
    temTrilhoDx,
  };
}
