/**
 * Painel da chamada em curso.
 *
 * Fica ancorado no canto, fora da árvore da tela que originou a ligação: o
 * vendedor precisa continuar navegando — abrir o lead, ler o histórico, anotar —
 * enquanto fala. Um painel dentro do modal do lead morreria no primeiro clique
 * em "fechar", e com ele a chamada.
 *
 * O estado é sempre legível em uma olhada: onde está, com quem, há quanto tempo.
 * Chamada é a única superfície do produto em que o usuário não pode "conferir
 * depois" — ou ele entende agora, ou já falou com a pessoa errada.
 */
import { Mic, MicOff, PhoneOff, Loader2, AlertTriangle, PhoneMissed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { VoiceCallState } from "@/modules/communication/hooks/useVoiceCall";

interface VoiceCallPanelProps {
  state: VoiceCallState;
  leadName?: string | null;
  onHangup: () => void;
  onToggleMute: () => void;
  onDismiss: () => void;
}

const PHASE_LABEL: Record<string, string> = {
  requesting_mic: "Liberando microfone…",
  authorizing: "Autorizando…",
  negotiating: "Preparando áudio…",
  ringing: "Chamando…",
  active: "Em chamada",
  ending: "Encerrando…",
};

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** 554891005289 → (48) 9100-5289. Não valida: só deixa legível. */
function formatPeer(digits: string | null): string {
  if (!digits) return "";
  const local = digits.replace(/^55/, "");
  if (local.length < 10) return digits;
  const ddd = local.slice(0, 2);
  const rest = local.slice(2);
  const head = rest.slice(0, rest.length - 4);
  return `(${ddd}) ${head}-${rest.slice(-4)}`;
}

export function VoiceCallPanel({
  state,
  leadName,
  onHangup,
  onToggleMute,
  onDismiss,
}: VoiceCallPanelProps) {
  if (state.phase === "idle") return null;

  // A chamada terminou por decisão de fora — o outro lado desligou, não
  // atendeu, ou a mídia caiu. A tela da chamada sai (não há mais chamada), mas o
  // MOTIVO fica: "recusou" e "não atendeu" levam o vendedor a próximos passos
  // opostos, e fechar tudo em silêncio apagaria justamente essa diferença.
  // Encerrar assim NÃO conta como ocupado — dá para discar de novo agora.
  if (state.phase === "ended") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-6 right-6 z-50 w-[320px] rounded-xl border border-border/60 bg-card shadow-2xl"
      >
        <div className="flex items-start gap-3 p-4">
          <PhoneMissed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {leadName || formatPeer(state.peer) || "Chamada"}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{state.endReason}</p>
          </div>
        </div>
        <div className="flex justify-end border-t border-border/40 px-4 py-2.5">
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Entendi
          </Button>
        </div>
      </div>
    );
  }

  if (state.phase === "failed") {
    return (
      <div
        role="alert"
        className="fixed bottom-6 right-6 z-50 w-[320px] rounded-xl border border-destructive/30 bg-card shadow-2xl"
      >
        <div className="flex items-start gap-3 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Chamada não completou</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{state.error}</p>
          </div>
        </div>
        <div className="flex justify-end border-t border-border/40 px-4 py-2.5">
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Entendi
          </Button>
        </div>
      </div>
    );
  }

  const connecting = state.phase !== "active";

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-50 w-[320px] overflow-hidden rounded-xl border border-border/60 bg-card shadow-2xl"
    >
      <div className="flex items-center gap-3 p-4">
        {/* O ponto pulsa só quando há áudio de verdade. Animar durante a
            negociação faria "conectando" parecer "conectado". */}
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            state.phase === "active" ? "animate-pulse bg-success" : "bg-muted-foreground/50",
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {leadName || formatPeer(state.peer) || "Chamada"}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {connecting && <Loader2 className="h-3 w-3 animate-spin" />}
            {PHASE_LABEL[state.phase] ?? state.phase}
            {leadName && state.peer && (
              <span className="text-muted-foreground/70">· {formatPeer(state.peer)}</span>
            )}
          </p>
        </div>
        {state.phase === "active" && (
          <span className="shrink-0 font-mono text-sm tabular-nums text-foreground">
            {formatElapsed(state.elapsedSeconds)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border/40 bg-background/40 px-3 py-2.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleMute}
          disabled={state.phase !== "active"}
          aria-pressed={state.muted}
          className={cn("gap-2", state.muted && "text-warning")}
        >
          {state.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {state.muted ? "Mudo" : "Microfone"}
        </Button>
        <div className="flex-1" />
        <Button
          variant="destructive"
          size="sm"
          onClick={onHangup}
          disabled={state.phase === "ending"}
          className="gap-2"
        >
          <PhoneOff className="h-4 w-4" />
          Desligar
        </Button>
      </div>
    </div>
  );
}
