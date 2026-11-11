import { useState } from "react";
import { Clock, X } from "lucide-react";
import { useDefasagemDoRelogio } from "../lib/sessao-runtime";
import { DEFASAGEM_TOLERADA_MS, descreverDefasagem } from "../lib/sessao-resiliente";

/**
 * O relógio do computador está errado além do tolerado. O app já compensa (renova
 * a sessão pela hora do servidor), mas o relógio errado bagunça mais coisa —
 * horário de agendamento, "há N min" das mensagens — e a pessoa precisa saber
 * para ajustar. Discreto, fechável, e só aparece com defasagem medida.
 */
export function AvisoRelogioDescompassado() {
  const defasagem = useDefasagemDoRelogio();
  const [fechado, setFechado] = useState(false);
  if (fechado || defasagem === null || Math.abs(defasagem) <= DEFASAGEM_TOLERADA_MS) return null;
  return <CartaoRelogio defasagemMs={defasagem} onFechar={() => setFechado(true)} />;
}

/** Só desenha — testável sem sessão. */
export function CartaoRelogio({ defasagemMs, onFechar }: { defasagemMs: number; onFechar: () => void }) {
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 flex w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 items-start gap-3 rounded-2xl border border-warning/35 bg-card px-4 py-3 shadow-relevo"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-warning/15 text-warning-strong">
        <Clock aria-hidden className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">O relógio deste computador está {descreverDefasagem(defasagemMs)}</p>
        <p className="text-[12px] text-muted-foreground">
          Ative “Definir hora automaticamente” nas configurações de data e hora do computador. Com o relógio errado,
          horários de agendamento e mensagens podem aparecer trocados.
        </p>
      </div>
      <button
        type="button"
        onClick={onFechar}
        aria-label="Fechar aviso do relógio"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X aria-hidden className="h-4 w-4" />
      </button>
    </div>
  );
}
