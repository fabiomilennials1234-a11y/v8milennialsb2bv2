import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { mensagemDeFalhaAoExcluir } from "../../lib/mensagem-falha-ao-excluir";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOrganizationSettings } from "@/modules/identity";
import { usePipelines } from "../../hooks/model/usePipelines";
import {
  useDeletePipelineById,
  usePipelineDeleteImpact,
} from "../../hooks/config/usePipelineDelete";

const SEM_PADRAO = "__none__";

export interface DeletePipelineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** O funil a excluir — id canônico (626) + o nome que o usuário VÊ. */
  pipeline: { id: string; name: string; type: "system" | "custom" };
  /** Chamado após exclusão bem-sucedida (fechar o diálogo hospedeiro etc.). */
  onDeleted?: () => void;
  /** Navega para /funis após excluir (default true — os dois fluxos antigos faziam). */
  navigateOnDelete?: boolean;
}

/**
 * O diálogo DEFINITIVO de exclusão de funil (SCRUM-636, D3) — um só para as
 * duas espécies, sobre o par único da 626 (`pipeline_delete_impact` +
 * `delete_pipeline`).
 *
 * Três estados:
 *   1. BLOQUEADO — `cards_invasores > 0` (ramo custom): não é aviso, é recusa.
 *   2. FUNIL PADRÃO da org (624) — o diálogo EXIGE o substituto e atualiza
 *      `organizations.default_pipeline_id` ANTES do delete. Isto mata o erro
 *      cru do trigger `pipeline_is_org_default`, que continua lá como cinto de
 *      segurança para caminhos que não passam por esta tela.
 *   3. Confirmação com o impacto medido (números do banco, não estimativa).
 */
export function DeletePipelineDialog({
  open,
  onOpenChange,
  pipeline,
  onDeleted,
  navigateOnDelete = true,
}: DeletePipelineDialogProps) {
  const navigate = useNavigate();
  const [substituto, setSubstituto] = useState<string>("");

  const { data: impacto } = usePipelineDeleteImpact(pipeline.id, open);
  const { settings, updateSettings } = useOrganizationSettings();
  const { data: pipelines = [] } = usePipelines();
  const excluir = useDeletePipelineById();

  const ehPadrao = settings.default_pipeline_id === pipeline.id;
  const bloqueado = (impacto?.cards_invasores ?? 0) > 0;
  const candidatosPadrao = pipelines.filter(
    (p) => p.id !== pipeline.id && p.is_active !== false,
  );
  // Substituto é obrigatório quando o funil é o padrão — "sem padrão" é uma
  // escolha explícita válida (D4: default NULL = lead entra sem card).
  const faltaSubstituto = ehPadrao && !substituto;

  // Estado zera a cada abertura — o diálogo pode ser reaberto para outro funil.
  useEffect(() => {
    if (!open) setSubstituto("");
  }, [open]);

  const handleExcluir = async () => {
    if (bloqueado || faltaSubstituto) return;
    try {
      // Ordem importa (624): o substituto entra ANTES do delete — senão o
      // trigger de guarda recusa com o erro cru que este diálogo existe para
      // matar. O FK ON DELETE SET NULL segue como rede.
      if (ehPadrao) {
        await updateSettings({
          default_pipeline_id: substituto === SEM_PADRAO ? null : substituto,
        });
      }

      const r = await excluir.mutateAsync(pipeline.id);
      const detalhe = [
        r?.cards ? `${r.cards} card(s)` : null,
        r?.automacoes_desativadas
          ? `${r.automacoes_desativadas} automação(ões) desativada(s)`
          : null,
        r?.agentes_ajustados ? `${r.agentes_ajustados} agente(s) ajustado(s)` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      toast.success(`Funil "${pipeline.name}" excluído${detalhe ? ` — ${detalhe}` : ""}`);
      onOpenChange(false);
      onDeleted?.();
      if (navigateOnDelete) navigate("/funis");
    } catch (e) {
      toast.error(mensagemDeFalhaAoExcluir(e));
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            Excluir Funil "{pipeline.name}"?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {bloqueado ? (
              <>
                <strong>Não dá para excluir agora.</strong> {impacto?.cards_invasores}{" "}
                card(s) de <strong>outro funil</strong> estão parados numa etapa deste.
                Mova-os para o funil de origem primeiro.
                <br />
                <br />
                O sistema não faz isso sozinho de propósito: mover o card dispararia as
                automações da etapa de destino — e mandaria mensagem para um lead que
                não tem nada a ver com este funil.
              </>
            ) : (
              <>
                Esta ação <strong>não pode ser desfeita</strong>. O funil, suas{" "}
                {impacto ? `${impacto.etapas} etapa(s)` : "etapas"} e{" "}
                {impacto ? `${impacto.cards} card(s)` : "todos os cards"}
                {impacto && impacto.leads > 0 ? ` de ${impacto.leads} lead(s)` : ""}{" "}
                serão apagados em definitivo.
                {!!impacto?.eventos_etapa && (
                  <>
                    {" "}
                    Junto vai o histórico de etapas deste funil ({impacto.eventos_etapa}{" "}
                    evento(s)) — as métricas de conversão e de tempo por etapa dele zeram.
                  </>
                )}
                <br />
                <br />
                <strong>Os leads continuam no sistema</strong> — o que some é a posição
                deles neste funil.
                {!!impacto?.vendas_orfas && (
                  <>
                    <br />
                    <br />
                    ⚠️ {impacto.vendas_orfas} venda(s) registrada(s) neste funil passam a
                    aparecer como <strong>"Sem valor"</strong> no recorte por funil. O
                    total da organização e os recortes por vendedor não mudam.
                  </>
                )}
                {!!impacto?.automacoes && (
                  <>
                    <br />
                    <br />
                    ⚠️ {impacto.automacoes} automação(ões) que usam este funil{" "}
                    <strong>serão desativadas</strong>.
                  </>
                )}
                {!!impacto?.mensagens_agendadas && (
                  <>
                    <br />
                    ⚠️ {impacto.mensagens_agendadas} mensagem(ns) agendada(s) neste funil{" "}
                    <strong>não serão enviadas</strong>.
                  </>
                )}
                {!!impacto?.disparos_em_voo && (
                  <>
                    <br />
                    ⚠️ {impacto.disparos_em_voo} disparo(s) em andamento perdem o destino
                    e passam a deixar o lead onde está.
                  </>
                )}
                {!!impacto?.agentes_copilot && (
                  <>
                    <br />
                    ⚠️ {impacto.agentes_copilot} agente(s) de IA deixam de operar este
                    funil.
                  </>
                )}
                {pipeline.type === "system" && (
                  <>
                    <br />
                    <br />
                    Depois você pode recriar o funil vazio em{" "}
                    <strong>Criar → Ativar funil</strong>, mas os cards e o histórico{" "}
                    <strong>não voltam</strong>.
                  </>
                )}
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Funil padrão da org (624): substituto obrigatório ANTES do delete. */}
        {!bloqueado && ehPadrao && (
          <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span>
                Este é o <strong>funil padrão</strong> da organização — leads que chegam
                sem destino declarado caem nele. Escolha o novo padrão antes de excluir.
              </span>
            </div>
            <Label className="text-xs text-muted-foreground">Novo funil padrão:</Label>
            <Select value={substituto} onValueChange={setSubstituto}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o funil substituto" />
              </SelectTrigger>
              <SelectContent>
                {candidatosPadrao.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
                <SelectItem value={SEM_PADRAO}>
                  Nenhum — leads sem destino entram sem card
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>{bloqueado ? "Entendi" : "Cancelar"}</AlertDialogCancel>
          {!bloqueado && (
            <AlertDialogAction
              onClick={(e) => {
                // Sem substituto escolhido o diálogo fica aberto para escolher.
                if (faltaSubstituto) e.preventDefault();
                handleExcluir();
              }}
              disabled={excluir.isPending || faltaSubstituto}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {excluir.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Excluir Funil
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
