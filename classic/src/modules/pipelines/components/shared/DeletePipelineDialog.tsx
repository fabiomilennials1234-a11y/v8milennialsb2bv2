import { useNavigate } from "react-router-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { traducaoDeFalhaAoExcluir } from "../../lib/mensagem-falha-ao-excluir";
import { notifyError } from "@/shared/errors";
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
import {
  useDeletePipelineById,
  usePipelineDeleteImpact,
} from "../../hooks/config/usePipelineDelete";


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
 * Exibe o impacto medido e bloqueia a exclusão enquanto houver cards de outro funil.
 */
export function DeletePipelineDialog({
  open,
  onOpenChange,
  pipeline,
  onDeleted,
  navigateOnDelete = true,
}: DeletePipelineDialogProps) {
  const navigate = useNavigate();

  const { data: impacto } = usePipelineDeleteImpact(pipeline.id, open);
  const excluir = useDeletePipelineById();

  const bloqueado = (impacto?.cards_invasores ?? 0) > 0;
  const handleExcluir = async () => {
    if (bloqueado) return;
    try {
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
      notifyError(e, {
        fallback: "Não foi possível excluir o funil.",
        message: traducaoDeFalhaAoExcluir(e) ?? undefined,
      });
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

        <AlertDialogFooter>
          <AlertDialogCancel>{bloqueado ? "Entendi" : "Cancelar"}</AlertDialogCancel>
          {!bloqueado && (
            <AlertDialogAction
              onClick={handleExcluir}
              disabled={excluir.isPending}
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
