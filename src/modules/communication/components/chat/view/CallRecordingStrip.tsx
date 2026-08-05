/**
 * CallRecordingStrip — a gravação da ligação, embaixo do marco da chamada.
 *
 * ── Os quatro casos, e por que nenhum pode virar outro ──
 *   ausência    → NADA é desenhado. A chamada não gerou gravação, e inventar uma
 *                 linha ("sem gravação") poluiria toda thread antiga — hoje
 *                 100% das ligações em produção estão neste caso.
 *   processando → linha discreta, com pulso. Diz ESPERE. Sem ela, o gestor
 *                 conclui que a gravação se perdeu (história 19 do PRD #1356).
 *   pronta      → o botão de ouvir. Aperta, vira transporte (play/pause).
 *   falhou      → linha em tom de falha, COM A CAUSA em português. Falha muda
 *                 seria indistinguível de ausência, que é o defeito que a S2
 *                 gastou uma coluna inteira para não ter (história 20).
 *
 * ── Onde mora a decisão de quem ouve ──
 * NÃO aqui. A policy de `storage.objects` decide, e esta peça só descobre
 * apertando: pede a URL assinada e, se o banco recusar, TROCA a própria linha
 * pela explicação. É por isso que o botão aparece para todo mundo que enxerga a
 * ligação — prever a recusa exigiria uma segunda cópia da regra no navegador, e
 * é a divergência entre as duas cópias que vaza conversa com cliente.
 *
 * ── Silhueta ──
 * Segunda linha embaixo da pílula, centralizada, um degrau menor. O marco
 * continua sendo o marco; a gravação é adendo. Sem isto a thread vira mosaico —
 * a mesma razão pela qual o `CallMarker` mantém a pílula igual entre uma ligação
 * de 3 s e uma de 12 min.
 *
 * ── Cor ──
 * Só token. O accent dourado fica de fora pelo mesmo motivo do `CallMarker`: no
 * Torque ele é de dinheiro e ação, e ouvir o passado é histórico.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Headphones, Loader2, Pause, Play, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  callRecordingState,
  clock,
  recordingFailureLabel,
  resolveCallRecordingUrl,
  type CallRecordingFields,
} from "@/modules/communication/lib/callRecording";

export interface CallRecordingStripProps {
  call: CallRecordingFields;
}

/** Casca comum das três linhas visíveis: mesma altura, mesmo eixo, mesmo tom. */
function Linha({
  children,
  tone = "muted",
  title,
  testId,
}: {
  children: ReactNode;
  tone?: "muted" | "danger";
  title?: string;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 text-[11px]",
        tone === "danger" ? "text-destructive/90" : "text-muted-foreground/80",
      )}
    >
      {children}
    </div>
  );
}

export function CallRecordingStrip({ call }: CallRecordingStripProps) {
  const state = callRecordingState(call);

  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [denied, setDenied] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [broken, setBroken] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const path = state.kind === "ready" ? state.path : null;

  // Trocar de conversa reaproveita a peça com outra ligação. Sem esta limpeza, a
  // URL assinada da ligação anterior continuaria armada nesta linha — som de uma
  // conversa dentro do registro de outra.
  useEffect(() => {
    setSrc(null);
    setLoading(false);
    setDenied(false);
    setUnavailable(false);
    setPlaying(false);
    setElapsed(0);
    setTotal(null);
    setBroken(false);
  }, [path]);

  const pedirUrl = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setDenied(false);
    setUnavailable(false);
    const res = await resolveCallRecordingUrl(path);
    setLoading(false);
    if (res.ok) {
      setSrc(res.url);
      return;
    }
    if (res.kind === "denied") setDenied(true);
    else setUnavailable(true);
  }, [path]);

  // Só toca DEPOIS de a URL chegar. `play()` é assíncrono e pode ser recusado
  // pelo navegador (autoplay, aba em segundo plano); a recusa não pode deixar o
  // botão preso em "pausar" para sempre.
  useEffect(() => {
    const el = audioRef.current;
    if (!src || !el) return;
    let cancelado = false;
    void Promise.resolve(el.play()).then(
      () => {
        if (!cancelado) setPlaying(true);
      },
      () => {
        if (!cancelado) setPlaying(false);
      },
    );
    return () => {
      cancelado = true;
    };
  }, [src]);

  const alternar = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void Promise.resolve(el.play()).then(
        () => setPlaying(true),
        () => setPlaying(false),
      );
    } else {
      el.pause();
      setPlaying(false);
    }
  }, []);

  if (state.kind === "none") return null;

  if (state.kind === "processing") {
    return (
      <Linha testId="call-recording-processing">
        {/* Pulso, não giro: a espera é passiva e curta. Um spinner prometeria
            que algo acontece nesta tela, e o que acontece é do outro lado. */}
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground/60"
        />
        <span>Gravação sendo processada</span>
      </Linha>
    );
  }

  if (state.kind === "failed") {
    return (
      <Linha
        testId="call-recording-failed"
        tone="danger"
        // O slug cru fica AQUI, e só aqui: é o que o suporte precisa e o que o
        // vendedor não deve ler.
        title={state.reason ?? undefined}
      >
        <TriangleAlert aria-hidden className="h-3 w-3 shrink-0" />
        <span>{recordingFailureLabel(state.reason)}</span>
      </Linha>
    );
  }

  if (denied) {
    return (
      <Linha testId="call-recording-denied">
        <Headphones aria-hidden className="h-3 w-3 shrink-0" />
        <span>Só quem fez a ligação e a gestão podem ouvir</span>
      </Linha>
    );
  }

  if (broken || unavailable) {
    return (
      <Linha testId="call-recording-unavailable" tone="danger">
        <TriangleAlert aria-hidden className="h-3 w-3 shrink-0" />
        <span>Não foi possível carregar a gravação</span>
        <button
          type="button"
          onClick={() => {
            setBroken(false);
            setSrc(null);
            void pedirUrl();
          }}
          className="underline underline-offset-2 hover:text-destructive"
        >
          Tentar de novo
        </button>
      </Linha>
    );
  }

  // Antes do primeiro play: só o convite. Nada de rede até alguém querer ouvir.
  if (!src) {
    return (
      <Linha testId="call-recording-ready">
        <button
          type="button"
          onClick={() => void pedirUrl()}
          disabled={loading}
          aria-label="Ouvir gravação da ligação"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2 py-0.5",
            "transition-colors hover:border-border hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:cursor-default disabled:opacity-70",
          )}
        >
          {loading ? (
            <Loader2 aria-hidden className="h-3 w-3 shrink-0 animate-spin" />
          ) : (
            <Headphones aria-hidden className="h-3 w-3 shrink-0" />
          )}
          <span>Ouvir gravação</span>
        </button>
      </Linha>
    );
  }

  const progresso = total && total > 0 ? Math.min(1, elapsed / total) : 0;

  return (
    <Linha testId="call-recording-player">
      <audio
        ref={audioRef}
        data-testid="call-recording-audio"
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          setTotal(Number.isFinite(d) && d > 0 ? d : null);
        }}
        onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime)}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onEnded={() => {
          setPlaying(false);
          setElapsed(0);
        }}
        onError={() => setBroken(true)}
        className="hidden"
      />

      <button
        type="button"
        onClick={alternar}
        aria-label={playing ? "Pausar gravação" : "Tocar gravação"}
        className={cn(
          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
          "border border-border/60 text-foreground",
          "transition-colors hover:border-border hover:bg-muted/60",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      >
        {playing ? (
          <Pause aria-hidden className="h-2.5 w-2.5" />
        ) : (
          <Play aria-hidden className="h-2.5 w-2.5 translate-x-[0.5px]" />
        )}
      </button>

      {/* Trilha só de leitura. Recorte e navegação estão fora desta fatia; uma
          barra que parece arrastável e não é seria pior que nenhuma. */}
      <span
        aria-hidden
        className="h-0.5 w-24 shrink-0 overflow-hidden rounded-full bg-border"
      >
        <span
          data-testid="call-recording-progress"
          className="block h-full rounded-full bg-muted-foreground/70 transition-[width] duration-200"
          style={{ width: `${progresso * 100}%` }}
        />
      </span>

      <span className="shrink-0 tabular-nums">
        {clock(elapsed)}
        {total !== null && ` / ${clock(total)}`}
      </span>
    </Linha>
  );
}
