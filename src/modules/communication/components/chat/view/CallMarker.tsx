/**
 * CallMarker — a ligação como MARCO na linha do tempo da conversa.
 *
 * ── Por que não é um balão ──
 * Balão é fala: tem autor, lado e conteúdo que alguém escreveu. Ligação não é
 * fala, é acontecimento. Desenhá-la como balão faria o vendedor ler "mensagem"
 * e procurar um texto que não existe. Por isso a peça é centralizada, sem cauda
 * e sem lado — o mesmo vocabulário do separador de data, que também marca o
 * tempo passando em vez de dizer algo.
 *
 * ── O que muda entre uma ligação de 3s não atendida e uma de 12min ──
 * A SILHUETA é a mesma (mesma pílula, mesma altura), senão a thread vira um
 * mosaico e perde a calma de leitura. O que muda é o conteúdo e o tom:
 *
 *   atendida     → ícone neutro, e a DURAÇÃO em peso de texto forte.
 *                  A duração é a substância: 12min é uma reunião, 24s é um
 *                  "agora não posso".
 *   não atendida → ícone e rótulo em `destructive`, mostrando o DESFECHO.
 *                  Sem duração: numa chamada que não completou ela é 0 ou nula,
 *                  e "0s" na tela é ruído com aparência de dado.
 *
 * Ligação não atendida NUNCA é escondida — três tentativas sem resposta é um
 * fato comercial sobre o lead, não sujeira visual.
 *
 * ── Cor ──
 * Só token (`--muted-foreground`, `--destructive`, `--border`, `--card`).
 * O accent dourado fica de fora de propósito: no Torque ele é reservado a
 * dinheiro e ação, e ligação é histórico.
 */
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing } from "lucide-react";
import { cn } from "@/lib/utils";
import { OUTCOME_LABELS } from "@/modules/engagement";
import {
  formatCallDuration,
  isCallConnected,
  type ConversationCall,
} from "@/modules/communication/lib/conversationCallsQuery";

export interface CallMarkerProps {
  call: ConversationCall;
}

/**
 * Desfecho sem rótulo conhecido ainda degrada com dignidade. `OUTCOME_LABELS`
 * hoje cobre 6 dos 9 valores que o CHECK de `call_logs` aceita — os outros 3
 * (`rejected`, `failed`, `canceled`) ganham rótulo quando o #1352 entrar. Até
 * lá, e para qualquer valor que o banco venha a inventar, esta frase é
 * verdadeira sem fingir precisão.
 */
const DESFECHO_DESCONHECIDO = "Não completada";

function outcomeLabel(outcome: string): string {
  return (OUTCOME_LABELS as Record<string, string | undefined>)[outcome] ?? DESFECHO_DESCONHECIDO;
}

export function CallMarker({ call }: CallMarkerProps) {
  const conectada = isCallConnected(call.outcome);
  const entrada = call.direction === "inbound";
  const duracao = formatCallDuration(call.duration_seconds);

  const evento = entrada ? "Ligação recebida" : "Ligação realizada";

  // Atendida fala em duração; não atendida fala em desfecho. Quando a linha
  // vier atendida mas sem duração (projeção incompleta), o rótulo do desfecho
  // é o que sobra de verdadeiro.
  const detalhe = conectada ? (duracao ?? outcomeLabel(call.outcome)) : outcomeLabel(call.outcome);

  const Icone = conectada ? (entrada ? PhoneIncoming : PhoneOutgoing) : entrada ? PhoneMissed : Phone;

  const inicio = new Date(call.started_at);
  const horaValida = !Number.isNaN(inicio.getTime());
  const hora = horaValida
    ? inicio.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div className="flex justify-center py-2">
      <div
        data-testid="call-marker"
        data-connected={conectada ? "true" : "false"}
        aria-label={`${evento} — ${detalhe}${hora ? ` às ${hora}` : ""}`}
        className={cn(
          "inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5",
          "bg-card/70 shadow-sm",
          conectada ? "border-border" : "border-destructive/30",
        )}
      >
        <Icone
          aria-hidden
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            conectada ? "text-muted-foreground" : "text-destructive",
          )}
        />

        <span className="truncate text-xs text-muted-foreground">{evento}</span>

        <span aria-hidden className="text-muted-foreground/40">
          ·
        </span>

        <span
          className={cn(
            "shrink-0 text-xs tabular-nums",
            conectada ? "font-medium text-foreground" : "text-destructive",
          )}
        >
          {detalhe}
        </span>

        {hora && (
          <time
            dateTime={call.started_at}
            className="shrink-0 border-l border-border/60 pl-2 text-[11px] tabular-nums text-muted-foreground/60"
          >
            {hora}
          </time>
        )}
      </div>
    </div>
  );
}
