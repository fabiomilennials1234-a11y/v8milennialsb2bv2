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
 *
 * ─── A ÂNCORA saiu daqui ────────────────────────────────────────────────────
 * O `fixed bottom-6 right-6` vive agora na pilha do `VoiceCallProvider`, e este
 * componente é um bloco comum. A razão é que ele deixou de ser o único painel do
 * canto: as ligações que ENTRAM aparecem ao mesmo tempo que uma conversa em
 * curso, e dois elementos com posição absoluta no mesmo canto se cobrem. Com uma
 * pilha só, empilhar é consequência da ordem, não de calcular altura.
 */
import { Mic, MicOff, PhoneOff, Loader2, AlertTriangle, PhoneMissed } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPeerPhone } from "@/modules/communication/lib/formatPeerPhone";
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
  // A ligação que ENTRA. "Atendendo…" e não "Liberando microfone…" porque o
  // microfone é o meio: quem clicou quer saber que está entrando na conversa, e
  // o diálogo de permissão do navegador já explica a si mesmo.
  accepting: "Atendendo…",
  active: "Em chamada",
  ending: "Encerrando…",
};

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** O painel de entrada mostra o mesmo número; a formatação é UMA. */
const formatPeer = formatPeerPhone;

/**
 * V5 (mockup "Calls"): o painel é TINTA — é um objeto sobre a tela, não parte
 * dela. Avatar, nome, telefone em mono, pílula de estado, cronômetro grande e
 * botões redondos rotulados. Só forma: fases, rótulos e ações são os de antes.
 */
const INK_CARD =
  "w-full overflow-hidden rounded-card border border-tinta-line/60 bg-tinta text-tinta-foreground shadow-relevo-tinta";

function initialOf(text: string): string {
  const letter = text.trim().match(/\p{L}/u)?.[0];
  return letter ? letter.toUpperCase() : "#";
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-white/15 bg-white/[.06] px-3.5 py-1.5 text-[12.5px] font-semibold text-tinta-foreground transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      Entendi
    </button>
  );
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
      <div role="status" aria-live="polite" className={INK_CARD}>
        <div className="flex items-start gap-3 p-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[.08]">
            <PhoneMissed className="h-4 w-4 text-tinta-muted" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">
              {leadName || formatPeer(state.peer) || "Chamada"}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-tinta-muted">{state.endReason}</p>
          </div>
        </div>
        <div className="flex justify-end px-4 pb-3.5">
          <DismissButton onClick={onDismiss} />
        </div>
      </div>
    );
  }

  if (state.phase === "failed") {
    return (
      <div role="alert" className={INK_CARD}>
        <div className="flex items-start gap-3 p-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-destructive/20">
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">Chamada não completou</p>
            <p className="mt-1 text-[13px] leading-relaxed text-tinta-muted">{state.error}</p>
          </div>
        </div>
        <div className="flex justify-end px-4 pb-3.5">
          <DismissButton onClick={onDismiss} />
        </div>
      </div>
    );
  }

  const connecting = state.phase !== "active";
  const title = leadName || formatPeer(state.peer) || "Chamada";

  return (
    <div role="status" aria-live="polite" className={INK_CARD}>
      <div className="flex items-center gap-3 px-4 pt-4">
        <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary text-[18px] font-extrabold text-primary-foreground">
          {initialOf(title)}
          {/* O ponto pulsa só quando há áudio de verdade. Animar durante a
              negociação faria "conectando" parecer "conectado". */}
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-tinta",
              state.phase === "active" ? "animate-pulse bg-success" : "bg-tinta-muted",
            )}
            aria-hidden
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold">{title}</p>
          {leadName && state.peer && (
            <p className="truncate font-mono text-[12px] text-tinta-muted">{formatPeer(state.peer)}</p>
          )}
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold",
            state.phase === "active" ? "bg-success/15 text-success" : "bg-white/10 text-tinta-foreground",
          )}
        >
          {connecting && <Loader2 className="h-3 w-3 animate-spin" />}
          {PHASE_LABEL[state.phase] ?? state.phase}
        </span>
      </div>

      <p
        className={cn(
          "px-4 pt-3 text-[2.4rem] font-extrabold leading-none tracking-[-0.04em] tabular-nums",
          state.phase !== "active" && "text-tinta-muted",
        )}
        aria-hidden={state.phase !== "active"}
      >
        {formatElapsed(state.phase === "active" ? state.elapsedSeconds : 0)}
      </p>

      <div className="flex items-start justify-center gap-8 px-4 pb-4 pt-4">
        <div className="flex flex-col items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleMute}
            disabled={state.phase !== "active"}
            aria-pressed={state.muted}
            aria-label={state.muted ? "Mudo" : "Microfone"}
            className={cn(
              "grid h-12 w-12 place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40",
              state.muted ? "bg-tinta-foreground text-tinta" : "bg-white/[.08] text-tinta-foreground hover:bg-white/[.14]",
            )}
          >
            {state.muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
          <span className="text-[11px] font-semibold text-tinta-muted" aria-hidden>
            {state.muted ? "Mudo" : "Silenciar"}
          </span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <button
            type="button"
            onClick={onHangup}
            disabled={state.phase === "ending"}
            aria-label="Desligar"
            className="grid h-12 w-12 place-items-center rounded-full bg-destructive text-destructive-foreground shadow-relevo transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
          >
            <PhoneOff className="h-5 w-5" />
          </button>
          <span className="text-[11px] font-semibold text-tinta-muted" aria-hidden>
            Desligar
          </span>
        </div>
      </div>
    </div>
  );
}
