/**
 * Botões Ganho / Perda abaixo de um negócio ("Funis do lead") no chat.
 *
 * Clique → modal de etapa → mover o card → desfecho. A orquestração está em
 * `useFecharNegocioNoChat`; aqui só a tela e a mensagem honesta de cada
 * resultado (inclusive "moveu mas não registrou").
 */
import { useState } from "react";
import { Loader2, Trophy, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SaleValueRequiredModal } from "@/shared/components/SaleValueRequiredModal";
import { notifyError } from "@/shared/errors";
import { useFecharNegocioNoChat, type CapturarMotivoDaPerda, type MoverEtapa } from "@/modules/communication/hooks/chat/useFecharNegocioNoChat";
import { useDesfechoDaEntrada } from "@/modules/communication/hooks/chat/useDesfechoDaEntrada";
import type { DesfechoDoChat } from "@/modules/communication/lib/fechar-negocio-chat";
import type { PerdaResolvida } from "@/contracts/pipe/perda";
import { FecharNegocioDialog, type EtapaDoModal } from "./FecharNegocioDialog";

export function GanhoPerdaDoNegocio({
  entryId,
  funil,
  etapas,
  etapaAtualKey,
  podeMover,
  moverEtapa,
  capturarMotivoDaPerda,
}: {
  entryId: string;
  funil: string;
  etapas: readonly EtapaDoModal[];
  etapaAtualKey: string | null;
  podeMover: boolean;
  moverEtapa: MoverEtapa;
  capturarMotivoDaPerda: CapturarMotivoDaPerda;
}) {
  const desfechoAtual = useDesfechoDaEntrada(entryId);
  const { fechar, registrarDesfecho } = useFecharNegocioNoChat({ moverEtapa, capturarMotivoDaPerda });
  const [abrindo, setAbrindo] = useState<DesfechoDoChat | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [pedindoValor, setPedindoValor] = useState<{ desfecho: DesfechoDoChat; perda: PerdaResolvida | null } | null>(
    null,
  );

  // Negócio já fechado: a linha não oferece fechar de novo.
  if (desfechoAtual.data === "won" || desfechoAtual.data === "lost") {
    const ganho = desfechoAtual.data === "won";
    return (
      <p
        data-testid="desfecho-do-negocio"
        className={
          ganho ? "px-1 text-[11px] font-semibold text-success" : "px-1 text-[11px] font-semibold text-destructive"
        }
      >
        {ganho ? "Negócio ganho" : "Negócio perdido"}
      </p>
    );
  }
  if (desfechoAtual.isPending || desfechoAtual.isError) return null;

  const confirmar = async (desfecho: DesfechoDoChat, destino: EtapaDoModal | null) => {
    setSalvando(true);
    try {
      const r = await fechar({ entryId, desfecho, etapaAtualKey, destino });
      if (r.status === "ok") {
        setAbrindo(null);
        return;
      }
      // `cancelado` mantém o modal aberto: nada foi escrito e a pessoa pode ajustar.
      if (r.status === "cancelado") return;
      setAbrindo(null);
      if (r.status === "pede-valor") {
        setPedindoValor({ desfecho, perda: r.perda });
        return;
      }
      toast.error(
        `O negócio foi movido para ${r.destino}, mas ${desfecho === "won" ? "o ganho" : "a perda"} não foi registrado. Tente de novo.`,
      );
    } catch (erro) {
      notifyError(erro, { fallback: "Não foi possível fechar o negócio." });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <>
      <div className="flex gap-2 px-0.5 pb-0.5 pt-1.5" data-testid="ganho-perda-do-negocio">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 flex-1 gap-1.5 border-success/40 text-[12px] text-success hover:bg-success/10 hover:text-success"
          disabled={!podeMover}
          title={podeMover ? undefined : "Sem permissão para mover etapa"}
          onClick={() => setAbrindo("won")}
        >
          <Trophy className="h-3.5 w-3.5" aria-hidden />
          Ganho
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 flex-1 gap-1.5 border-destructive/40 text-[12px] text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={!podeMover}
          title={podeMover ? undefined : "Sem permissão para mover etapa"}
          onClick={() => setAbrindo("lost")}
        >
          <XCircle className="h-3.5 w-3.5" aria-hidden />
          Perda
        </Button>
      </div>

      {abrindo && (
        <FecharNegocioDialog
          open
          desfecho={abrindo}
          funil={funil}
          etapas={etapas}
          etapaAtualKey={etapaAtualKey}
          salvando={salvando}
          onCancelar={() => setAbrindo(null)}
          onConfirmar={(destino) => void confirmar(abrindo, destino)}
        />
      )}

      {pedindoValor && (
        <SaleValueRequiredModal
          open
          onCancel={() => setPedindoValor(null)}
          onConfirm={(valor) => {
            const { desfecho, perda } = pedindoValor;
            setPedindoValor(null);
            setSalvando(true);
            registrarDesfecho({ entryId, desfecho, perda, valor })
              .catch((erro) => notifyError(erro, { fallback: "Não foi possível registrar o desfecho." }))
              .finally(() => setSalvando(false));
          }}
        />
      )}

      {salvando && !abrindo && !pedindoValor && (
        <Loader2
          className="mx-auto mt-1 h-3.5 w-3.5 animate-spin text-muted-foreground"
          aria-label="Registrando desfecho"
        />
      )}
    </>
  );
}
