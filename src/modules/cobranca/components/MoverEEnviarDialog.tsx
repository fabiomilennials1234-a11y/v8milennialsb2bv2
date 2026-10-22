/**
 * Soltar um card numa coluna que manda mensagem: a tela pergunta antes, com a
 * mensagem como o devedor vai ler (texto e variáveis vêm do servidor — o mesmo
 * que o worker usa — e o renderizador é o gêmeo da edge).
 *
 * "Mover e enviar" põe a mensagem na fila da régua: horário de envio, limite
 * do dia, "não contatar" e número sem WhatsApp valem como para o automático.
 * "Só mover" move o card e não manda nada. Cancelar deixa o card onde estava.
 */
import { AlertTriangle, Clock, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

import { reais } from "../lib/formato";
import { ROTULO_BLOQUEIO, type PreviaDoEnvio, quandoAbre, renderizarMensagem } from "../lib/regua";
import type { Etapa, InadimplenteResumo } from "../lib/tipos";
import { usePreviaDoEnvio } from "../hooks/useRegua";
import { EtapaPill } from "./atomos";

function QuandoSai({ p }: { p: PreviaDoEnvio }) {
  if (p.bloqueio) {
    return (
      <p className="flex items-start gap-2 rounded-2xl border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px] text-warning-strong">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          {ROTULO_BLOQUEIO[p.bloqueio]} O card pode ser movido mesmo assim.
        </span>
      </p>
    );
  }
  const texto = p.tetoAtingido
    ? "O limite de mensagens de hoje foi atingido: sai no próximo dia de envio."
    : p.naJanela
      ? "Entra na fila da régua e sai em instantes."
      : `Fora do horário de envio: sai ${quandoAbre(p.proximaJanela)}.`;
  return (
    <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
      <Clock className="size-3.5 shrink-0" aria-hidden />
      {texto}
    </p>
  );
}

export function MoverEEnviarDialog({
  caso,
  destino,
  onFechar,
  onMover,
}: {
  caso: InadimplenteResumo;
  destino: Etapa;
  onFechar: () => void;
  /** O quadro move na hora (otimista) e fecha o diálogo; o resultado vira toast. */
  onMover: (enviar: boolean) => void;
}) {
  const previa = usePreviaDoEnvio(caso.casoId, destino.id);
  const p = previa.data;
  const texto = p?.mensagem ? renderizarMensagem(p.mensagem, p.variaveis) : null;
  const podeEnviar = !!texto && !p?.bloqueio;

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            Mover para <EtapaPill nome={destino.nome} cor={destino.cor} className="text-[13px]" />
          </DialogTitle>
          <DialogDescription>
            {caso.nome} · {reais(caso.saldoAberto)} em aberto. Esta coluna manda a mensagem abaixo quando o caso entra.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-[18px] border border-border bg-sunken p-3">
            <p className="mb-2 text-[11px] font-semibold text-muted-foreground">Pelo número da cobrança</p>
            {previa.isLoading ? (
              <div className="ml-auto w-4/5 space-y-1.5" aria-label="Montando a prévia">
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-11/12" />
                <Skeleton className="h-3.5 w-2/3" />
              </div>
            ) : texto ? (
              <div className="ml-auto w-fit max-w-full whitespace-pre-wrap break-words rounded-2xl rounded-tr-md bg-card px-3 py-2 text-[13px] leading-relaxed shadow-relevo">
                {texto}
              </div>
            ) : (
              <p className="py-4 text-center text-xs text-muted-foreground">
                {previa.isError ? "Não deu para montar a prévia agora." : "Esta coluna não tem mensagem."}
              </p>
            )}
          </div>
          {p && texto && <QuandoSai p={p} />}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onMover(false)}>
              Só mover
            </Button>
            <Button type="button" onClick={() => onMover(true)} disabled={!podeEnviar}>
              <Send />
              Mover e enviar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
