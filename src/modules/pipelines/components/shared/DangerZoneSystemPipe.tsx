import { useState } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { useFeaturePermission } from "@/modules/identity";
import {
  usePipelineDisplayConfig,
  type SystemPipeType,
} from "../../hooks/config/usePipelineDisplayConfig";
import {
  useDeleteSystemPipeline,
  useSystemPipelineDeleteImpact,
} from "../../hooks/config/useDeleteSystemPipeline";

interface Props {
  pipeType: SystemPipeType;
  /** Fecha o diálogo de configurações que hospeda esta seção. */
  onDeleted?: () => void;
}

/**
 * Zona de Perigo do funil de SISTEMA — o gêmeo da que `CustomPipeline` já tem.
 *
 * Vive dentro do `PipeSettingsDialog`, que é compartilhado pelas três páginas
 * de funil de sistema. Um lugar só, três telas — em vez de copiar o diálogo em
 * `PipeWhatsapp`, `PipeConfirmacao` e `PipePropostas` e deixar as três versões
 * divergirem na primeira correção de copy.
 *
 * O portão é `pipeline.custom_delete`, a MESMA chave do funil custom. Não é
 * preguiça: o nome da chave é herança de quando havia duas espécies de funil, e
 * a direção do produto é que não há mais. Inventar `pipeline.system_delete`
 * criaria uma chave que não existe no `feature_catalog` — e chave inexistente
 * resolve para `false` em membro comum e para `true` em admin, ou seja, um
 * portão que não porta nada. Foi exatamente o defeito de `pipeline.delete`.
 */
export function DangerZoneSystemPipe({ pipeType, onDeleted }: Props) {
  const navigate = useNavigate();
  const [confirmando, setConfirmando] = useState(false);

  const { allowed: podeExcluir } = useFeaturePermission("pipeline.custom_delete");
  const { data: configs = [] } = usePipelineDisplayConfig();
  const excluir = useDeleteSystemPipeline();
  // Só conta o estrago quando o diálogo abre — antes disso é peso morto.
  const { data: impacto } = useSystemPipelineDeleteImpact(pipeType, confirmando);

  // O nome que o usuário vê na tela ("Oportunidades"), não o interno
  // ("Qualificação"). A confirmação tem de citar o funil pelo nome que ele tem
  // na lista de funis, senão parece outro funil.
  const nome =
    configs.find((c) => c.pipe_type === pipeType)?.display_name ?? "este funil";

  if (!podeExcluir) return null;

  const handleExcluir = async () => {
    try {
      const r = await excluir.mutateAsync(pipeType);
      // Os números vêm do próprio DELETE, medidos ANTES de apagar — é prova de
      // que saiu, não estimativa da tela.
      const detalhe = [
        r?.cards ? `${r.cards} card(s)` : null,
        r?.automacoes_desativadas
          ? `${r.automacoes_desativadas} automação(ões) desativada(s)`
          : null,
        r?.agentes_ajustados ? `${r.agentes_ajustados} agente(s) ajustado(s)` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      toast.success(`Funil "${nome}" excluído${detalhe ? ` — ${detalhe}` : ""}`);
      setConfirmando(false);
      onDeleted?.();
      navigate("/funis");
    } catch (e) {
      // A RPC recusa em português e diz o motivo. Trocar isso por "Erro ao
      // excluir" transforma recusa acionável em beco sem saída.
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("não tem o funil")) {
        toast.error("Este funil já não existe nesta organização.");
      } else if (msg.includes("permissão")) {
        toast.error("Você não tem permissão para excluir este funil");
      } else {
        toast.error("Erro ao excluir funil");
      }
    }
  };

  return (
    <>
      <div className="mt-8 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-destructive">Zona de Perigo</p>
            <p className="text-xs text-muted-foreground mt-1">
              Excluir o funil apaga os cards e o histórico de etapas dele em definitivo.
              Os leads continuam no sistema.
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            className="flex-shrink-0 gap-1.5"
            onClick={() => setConfirmando(true)}
          >
            <Trash2 className="w-4 h-4" />
            Excluir funil
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Excluir Funil "{nome}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação <strong>não pode ser desfeita</strong>. O funil, suas{" "}
              {impacto ? `${impacto.etapas} etapa(s)` : "etapas"} e{" "}
              {impacto ? `${impacto.cards} card(s)` : "todos os cards"}
              {impacto && impacto.leads > 0 ? ` de ${impacto.leads} lead(s)` : ""}{" "}
              serão apagados em definitivo.
              {!!impacto?.eventos_etapa && (
                <>
                  {" "}Junto vai o histórico de etapas deste funil{" "}
                  ({impacto.eventos_etapa} evento(s)) — as métricas de conversão e
                  de tempo por etapa dele zeram.
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
              {!!impacto?.agentes_copilot && (
                <>
                  <br />
                  ⚠️ {impacto.agentes_copilot} agente(s) de IA deixam de operar este funil.
                </>
              )}
              <br />
              <br />
              Depois você pode recriar o funil vazio em <strong>Criar → Ativar funil</strong>,
              mas os cards e o histórico <strong>não voltam</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleExcluir}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {excluir.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Excluir Funil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
