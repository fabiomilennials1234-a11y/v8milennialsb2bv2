import "./feature-suggestion.css";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowRight, ArrowUp, Ellipsis, Link2, Plus, ShieldCheck, X } from "lucide-react";
import { TorqueDial } from "./TorqueDial";
import {
  BODY_MAX,
  SUGGESTION_KINDS,
  SUGGESTION_KIND_LABEL,
  TORQUE_IDEAL_LENGTH,
  isBodyValid,
  limitAnnouncement,
  normalizeBody,
  type SuggestionKind,
} from "./feature-suggestion";

/**
 * Prompt de sugestões de funcionalidade — o visual ("versão viva", mockup v3
 * aprovado pelo CTO em 2026-10-15). Não conhece banco: recebe `onSubmit`, avisa
 * `onClose` e, quando a animação de saída termina, `onExited`.
 *
 * Tinta nos dois temas + ouro sólido. Estilos e keyframes em
 * `feature-suggestion.css`, importado no topo — NUNCA uma tag style dentro
 * do Portal (ver o cabeçalho do .css: travava o Presence do Radix ao fechar).
 *
 * Radix `DialogPrimitive` direto; `open` é estado interno.
 * Fechamento:
 * - X, Esc, "Agora não" e clique fora → `onClose("dismissed")`.
 * - Com texto digitado, clique fora NÃO fecha; X e Esc fecham.
 * - Durante o envio nada fecha.
 * - Depois do envio, fechar → `onClose(null)` (o desfecho já foi `submitted`).
 */

export interface FeatureSuggestionDialogProps {
  onSubmit: (input: { kind: SuggestionKind; body: string }) => Promise<void>;
  onClose: (outcome: "dismissed" | null) => void;
  /** Animação de saída terminou e o diálogo saiu do DOM. */
  onExited?: () => void;
}

type Phase = "form" | "submitting" | "done";

const HEADLINE: ReadonlyArray<{ text: string; highlight?: boolean }> = [
  { text: "Estamos" },
  { text: "aqui" },
  { text: "para" },
  { text: "ouvir", highlight: true },
  { text: "e" },
  { text: "ajudar" },
  { text: "vocês." },
];

const KIND_ICON: Record<SuggestionKind, ReactNode> = {
  feature: <Plus strokeWidth={2.4} />,
  improvement: <ArrowUp strokeWidth={2.4} />,
  integration: <Link2 strokeWidth={2.4} />,
  other: <Ellipsis strokeWidth={2.4} />,
};

const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

function isMacLike(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Alterna "a"/"b" para reiniciar uma animação CSS sem remontar o elemento. */
const flip = (value: "a" | "b" | undefined) => (value === "a" ? "b" : "a");

export function FeatureSuggestionDialog({ onSubmit, onClose, onExited }: FeatureSuggestionDialogProps) {
  const [open, setOpen] = useState(true);
  const [phase, setPhase] = useState<Phase>("form");
  const [kind, setKind] = useState<SuggestionKind>("feature");
  const [body, setBody] = useState("");
  const [failed, setFailed] = useState(false);
  const [sent, setSent] = useState<{ kind: SuggestionKind; body: string } | null>(null);
  const [bump, setBump] = useState<{ kind: SuggestionKind; key: "a" | "b" } | null>(null);
  const [shine, setShine] = useState<"a" | "b" | undefined>(undefined);
  const [reducedMotion] = useState(prefersReducedMotion);
  /** Entrada do medidor: acelera até 1 e volta a 0; `null` = segue a digitação. */
  const [entry, setEntry] = useState<{ value: number; ms: number } | null>(() =>
    prefersReducedMotion() ? null : { value: 0, ms: 1 },
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const chipRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const ids = useId();
  const kindLabelId = `${ids}-kind`;
  const ideaId = `${ids}-idea`;
  const countId = `${ids}-count`;
  const errorId = `${ids}-error`;

  const valid = isBodyValid(body);
  const canSend = phase === "form" && valid;
  const hasText = normalizeBody(body).length > 0;

  useEffect(() => {
    if (reducedMotion) return;
    const timers = [
      setTimeout(() => setEntry({ value: 1, ms: 750 }), 450),
      setTimeout(() => setEntry({ value: 0, ms: 900 }), 1250),
      setTimeout(() => setEntry(null), 2150),
    ];
    return () => timers.forEach(clearTimeout);
  }, [reducedMotion]);

  // Brilho que varre o botão quando o texto fica válido.
  const wasValid = useRef(false);
  useEffect(() => {
    if (valid && !wasValid.current && !reducedMotion) setShine((current) => flip(current));
    wasValid.current = valid;
  }, [valid, reducedMotion]);

  useEffect(() => {
    if (phase === "done") doneRef.current?.focus();
  }, [phase]);

  // Erro de envio: foco volta ao campo DEPOIS do re-render que o reabilita.
  useEffect(() => {
    if (failed && phase === "form") textareaRef.current?.focus();
  }, [failed, phase]);

  function close(outcome: "dismissed" | null) {
    setOpen(false);
    onClose(outcome);
  }

  function requestClose() {
    if (phase === "submitting") return;
    close(phase === "done" ? null : "dismissed");
  }

  async function submit() {
    if (!canSend) return;
    const payload = { kind, body: normalizeBody(body) };
    setPhase("submitting");
    setFailed(false);
    try {
      await onSubmit(payload);
      setSent(payload);
      setPhase("done");
    } catch {
      setFailed(true);
      setPhase("form");
    }
  }

  function handleFormSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  function handleTextareaKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  }

  function selectKind(next: SuggestionKind) {
    setKind(next);
    if (!reducedMotion) setBump((current) => ({ kind: next, key: flip(current?.key) }));
  }

  function handleChipKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + SUGGESTION_KINDS.length) % SUGGESTION_KINDS.length;
    selectKind(SUGGESTION_KINDS[next]);
    chipRefs.current[next]?.focus();
  }

  function guardOutside(event: Event) {
    // Clique fora com ideia escrita não descarta a ideia. Durante o envio, nada fecha.
    if (phase === "submitting" || (phase === "form" && hasText)) event.preventDefault();
  }

  const typed = Math.min(body.length / TORQUE_IDEAL_LENGTH, 1);
  const gauge = entry && body.length === 0 ? entry : { value: typed, ms: 450 };
  const maxed = body.length >= TORQUE_IDEAL_LENGTH;
  const mod = isMacLike() ? "⌘" : "Ctrl";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && requestClose()}>
      <DialogPrimitive.Portal>
        {/* Overlay envolve o painel (padrão "scrollable overlay" do Radix): o
            clique no fundo continua sendo "fora", e o painel rola no celular. */}
        <DialogPrimitive.Overlay className="fsp-overlay" data-testid="feature-suggestion-overlay">
          <DialogPrimitive.Content
            data-testid="feature-suggestion-dialog"
            className="fsp-shell"
            onOpenAutoFocus={(event) => {
              // Desktop: direto no campo. Toque: não abre o teclado sozinho.
              if (window.matchMedia?.("(pointer: fine)").matches) {
                event.preventDefault();
                textareaRef.current?.focus();
              }
            }}
            onCloseAutoFocus={() => onExited?.()}
            onPointerDownOutside={guardOutside}
            onInteractOutside={guardOutside}
            onEscapeKeyDown={(event) => {
              if (phase === "submitting") event.preventDefault();
            }}
          >
            <div className="fsp-card bg-tinta text-tinta-foreground">
              <div className="fsp-grid" aria-hidden="true" />

              <div className="fsp-top">
                <span className="fsp-eyebrow text-primary">
                  <span className="fsp-live" aria-hidden="true" />
                  Torque ouve você
                </span>
                <DialogPrimitive.Close aria-label="Fechar" disabled={phase === "submitting"} className="fsp-close">
                  <X strokeWidth={2.4} />
                </DialogPrimitive.Close>
              </div>

              <div className="fsp-hero">
                <div className="fsp-hero-text">
                  <DialogPrimitive.Title className="fsp-headline">
                    {/* Nome acessível inteiro; as palavras animadas são só visuais. */}
                    <span className="fsp-sr">{HEADLINE.map((word) => word.text).join(" ")}</span>
                    <span aria-hidden="true">
                      {HEADLINE.map((word, index) => (
                        <span key={word.text}>
                          {index > 0 && " "}
                          <span className="fsp-w">
                            <span className={word.highlight ? "fsp-hl" : undefined} style={delay(520 + index * 75)}>
                              {word.text}
                            </span>
                          </span>
                        </span>
                      ))}
                    </span>
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description className="fsp-sub">
                    Qual funcionalidade você gostaria que fosse adicionada ao <strong>Torque</strong>?
                  </DialogPrimitive.Description>
                </div>
                <TorqueDial
                  value={phase === "done" ? 1 : gauge.value}
                  transitionMs={gauge.ms}
                  done={phase === "done"}
                  reducedMotion={reducedMotion}
                />
              </div>

              <div className="fsp-body">
                {phase === "done" && sent ? (
                  <div className="fsp-ok" role="status">
                    <h3>Recebido. Obrigado!</h3>
                    <p>Sua sugestão foi para o time de produto. Se ela entrar no roadmap, você fica sabendo por aqui.</p>
                    <div className="fsp-quote">
                      <span className="fsp-tag bg-primary text-primary-foreground">{SUGGESTION_KIND_LABEL[sent.kind]}</span>
                      <span>{sent.body}</span>
                    </div>
                    <div className="fsp-footer">
                      <span className="fsp-spacer" />
                      <button
                        ref={doneRef}
                        type="button"
                        onClick={() => close(null)}
                        className="fsp-btn fsp-btn-gold shadow-brilho-ouro"
                      >
                        Voltar ao Torque
                      </button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleFormSubmit} noValidate className="fsp-form">
                    <div className="fsp-field fsp-stagger" style={delay(1150)}>
                      <span id={kindLabelId} className="fsp-lbl">
                        Sobre o quê?
                      </span>
                      <div role="radiogroup" aria-labelledby={kindLabelId} className="fsp-chips">
                        {SUGGESTION_KINDS.map((option, index) => {
                          const selected = option === kind;
                          return (
                            <button
                              key={option}
                              ref={(node) => {
                                chipRefs.current[index] = node;
                              }}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              tabIndex={selected ? 0 : -1}
                              data-bump={bump?.kind === option ? bump.key : undefined}
                              onClick={() => selectKind(option)}
                              onKeyDown={(event) => handleChipKeyDown(event, index)}
                              className="fsp-chip"
                              style={delay(1200 + index * 60)}
                            >
                              <span aria-hidden="true" className="fsp-chip-icon">
                                {KIND_ICON[option]}
                              </span>
                              {SUGGESTION_KIND_LABEL[option]}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="fsp-field fsp-stagger" style={delay(1420)}>
                      <div className="fsp-lbl">
                        <label htmlFor={ideaId}>Sua ideia</label>
                        <small className="fsp-lbl-hint">
                          {maxed ? "Torque máximo. Pode mandar." : "Quanto mais detalhe, mais torque"}
                        </small>
                      </div>
                      <div className="fsp-ta-wrap">
                        <textarea
                          ref={textareaRef}
                          id={ideaId}
                          className="fsp-ta"
                          value={body}
                          maxLength={BODY_MAX}
                          disabled={phase === "submitting"}
                          onChange={(event) => {
                            setBody(event.target.value);
                            if (failed) setFailed(false);
                          }}
                          onKeyDown={handleTextareaKeyDown}
                          aria-describedby={failed ? `${countId} ${errorId}` : countId}
                          aria-invalid={failed || undefined}
                          placeholder="Ex.: queria disparar uma mensagem no WhatsApp quando o lead mudar de etapa, sem montar automação."
                        />
                        <div className="fsp-meter" aria-hidden="true">
                          <i data-testid="torque-meter" style={{ width: `${typed * 100}%` }} />
                        </div>
                        <span id={countId} className="fsp-count">
                          {body.length} / {BODY_MAX}
                        </span>
                        {/* Anúncio só nos degraus perto do limite — nunca por tecla. */}
                        <span className="fsp-sr" aria-live="polite">
                          {limitAnnouncement(body.length)}
                        </span>
                      </div>
                    </div>

                    {failed && (
                      <p id={errorId} role="alert" className="fsp-error">
                        Não deu para enviar agora. Sua ideia continua aqui; tente de novo.
                      </p>
                    )}

                    <div className="fsp-footer fsp-stagger" style={delay(1500)}>
                      <span className="fsp-hint">
                        <kbd>{mod}</kbd>
                        <kbd>Enter</kbd> envia
                      </span>
                      <button
                        type="button"
                        onClick={requestClose}
                        disabled={phase === "submitting"}
                        className="fsp-btn fsp-btn-ghost"
                      >
                        Agora não
                      </button>
                      <button
                        type="submit"
                        disabled={!canSend}
                        data-shine={shine}
                        aria-describedby={failed ? errorId : undefined}
                        className="fsp-btn fsp-btn-gold"
                      >
                        {phase === "submitting" ? "Enviando…" : failed ? "Tentar de novo" : "Enviar sugestão"}
                        <ArrowRight aria-hidden="true" strokeWidth={2.4} />
                      </button>
                    </div>

                    <p className="fsp-note fsp-stagger" style={delay(1580)}>
                      <ShieldCheck aria-hidden="true" strokeWidth={2.2} />
                      O time de produto lê cada sugestão. Seu nome e empresa seguem junto para podermos responder.
                    </p>
                  </form>
                )}
              </div>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
