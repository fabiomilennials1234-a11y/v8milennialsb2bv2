/**
 * Bandeja de mensagens programadas da conversa (B1) — logo acima do composer.
 *
 * Substitui a pílula azul colapsada que ninguém notava: quem abria a conversa
 * não via o envio a caminho e mandava a mesma coisa de novo na mão. Aqui a
 * bandeja diz QUANTO falta (anel que esvazia de `created_at` → `scheduled_at`),
 * QUEM programou e QUANDO deu errado (a falha domina o topo, em vermelho).
 *
 * Estados: programada · urgente (<15 min) · enviando · falhou · aberta ·
 * digitando (o composer publica "tem texto" pelo `composerTrayBus`, sem
 * re-render por tecla na árvore).
 *
 * Escrita (Enviar agora / Editar / Cancelar / Tentar de novo / Descartar) só
 * aparece para o AUTOR da mensagem ou master — é o que a policy de UPDATE de
 * `scheduled_user_messages` deixa passar. Todas com CAS no status.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  Clock,
  FileText,
  Film,
  Image as ImageIcon,
  Mic,
  Pencil,
  RotateCcw,
  Send,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  useScheduledMessagesForLead,
  useScheduledMessagesForConversation,
  useCancelScheduledMessage,
  useSendScheduledMessageNow,
  useRetryFailedScheduledMessage,
  useDiscardFailedScheduledMessage,
  type ScheduledMessage,
} from "@/modules/communication/hooks/useScheduledMessages";
import { useCurrentTeamMember, useIdentity, useTeamMembers } from "@/modules/identity";
import {
  agruparPorDia,
  ehUrgente,
  hora,
  minutosAte,
  motivoDaFalha,
  podeEscrever,
  previa,
  programadas,
  progressoDoAnel,
  ROTULO_DE_MIDIA,
  rotuloDoDia,
  separarFila,
  tempoRestante,
  tipoDeMidia,
  type TipoDeMidia,
} from "@/modules/communication/lib/scheduledTray";
import { onComposerEscape, publishPendingBadge, useComposerHasText } from "@/modules/communication/lib/composerTrayBus";
import { ScheduleMessageModal } from "./ScheduleMessageModal";

interface ScheduledMessagesBannerProps {
  leadId: string | null;
  leadName: string;
  phoneNumber: string;
  instanceId?: string;
  /** `${instanceId}:${phoneNumber}` — mesma chave do composer. */
  conversationKey?: string;
}

/** Aberta/fechada por conversa, só em memória — sobrevive à troca de conversa na sessão. */
const abertaPorConversa = new Set<string>();

const CONFIRMAR_MS = 3_000;
const DESFAZER_MS = 5_000;
const TICK_MS = 30_000;
const C = 2 * Math.PI * 13;

const ICONE_DE_MIDIA: Record<TipoDeMidia, typeof FileText> = {
  image: ImageIcon,
  video: Film,
  audio: Mic,
  document: FileText,
};

function SeloDeMidia({ mediaType }: { mediaType: string | null }) {
  const tipo = tipoDeMidia(mediaType);
  if (!tipo) return null;
  const Icone = ICONE_DE_MIDIA[tipo];
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-px text-[11px] font-bold text-foreground/75">
      <Icone className="h-3 w-3" strokeWidth={1.8} aria-hidden />
      {ROTULO_DE_MIDIA[tipo]}
    </span>
  );
}

const acao =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-[9px] px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-scheduled disabled:pointer-events-none disabled:opacity-50 [&_svg]:h-4 [&_svg]:w-4";

function Acao({
  children,
  variante,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: "pri" | "confirm" | "del" | "danger";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        acao,
        variante === "pri" && "bg-scheduled-strong text-scheduled-foreground hover:bg-scheduled-strong hover:text-scheduled-foreground hover:brightness-110",
        variante === "confirm" && "bg-foreground text-background hover:bg-foreground hover:text-background",
        variante === "del" && "hover:text-scheduled-danger-ink",
        variante === "danger" && "bg-scheduled-danger-strong text-white hover:bg-scheduled-danger-strong hover:text-white hover:brightness-110",
        props.className,
      )}
    >
      {children}
    </button>
  );
}

/** Anel 30 px · traço 2,5. Esvazia conforme o horário chega. */
function Anel({ msg, now }: { msg: ScheduledMessage; now: number }) {
  if (msg.status === "sending") {
    return (
      <span className="relative grid h-[30px] w-[30px] shrink-0 place-items-center text-scheduled-ink" data-anel="enviando">
        <svg viewBox="0 0 30 30" className="absolute inset-0 -rotate-90 motion-safe:animate-spin" aria-hidden>
          <circle cx="15" cy="15" r="13" fill="none" strokeWidth="2.5" className="stroke-scheduled-line" />
          <circle cx="15" cy="15" r="13" fill="none" strokeWidth="2.5" strokeLinecap="round" className="stroke-scheduled" strokeDasharray={`${C * 0.28} ${C}`} />
        </svg>
        <Send className="relative h-4 w-4" strokeWidth={1.8} aria-hidden />
      </span>
    );
  }
  if (ehUrgente(msg.scheduled_at, now)) {
    return (
      <span className="relative grid h-[30px] w-[30px] shrink-0 place-items-center text-scheduled-foreground" data-anel="urgente">
        <span className="absolute inset-0 rounded-full bg-scheduled motion-safe:animate-scheduled-beat" aria-hidden />
        <Clock className="relative h-4 w-4" strokeWidth={1.8} aria-hidden />
      </span>
    );
  }
  const p = progressoDoAnel(msg.created_at, msg.scheduled_at, now);
  return (
    <span className="relative grid h-[30px] w-[30px] shrink-0 place-items-center text-scheduled-ink" data-anel="programada">
      <svg viewBox="0 0 30 30" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="15" cy="15" r="13" fill="none" strokeWidth="2.5" className="stroke-scheduled-line" />
        <circle
          cx="15"
          cy="15"
          r="13"
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="stroke-scheduled"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - p)}
        />
      </svg>
      <Clock className="relative h-4 w-4" strokeWidth={1.8} aria-hidden />
    </span>
  );
}

export function ScheduledMessagesBanner({
  leadId,
  leadName,
  phoneNumber,
  instanceId,
  conversationKey,
}: ScheduledMessagesBannerProps) {
  const chave = conversationKey ?? `${instanceId ?? ""}:${phoneNumber}`;

  const { data: leadMessages = [] } = useScheduledMessagesForLead(leadId);
  const { data: conversationMessages = [] } = useScheduledMessagesForConversation(phoneNumber, instanceId);
  const { data: member } = useCurrentTeamMember();
  const { isMaster } = useIdentity();
  const { data: members = [] } = useTeamMembers();

  const cancelar = useCancelScheduledMessage({ silencioso: true });
  const enviarAgora = useSendScheduledMessageNow();
  const tentarDeNovo = useRetryFailedScheduledMessage();
  const descartar = useDiscardFailedScheduledMessage({ silencioso: true });

  const { ocultas, adiar } = useEscritaComDesfazer(chave, {
    cancelar: (id, onError) => cancelar.mutate(id, { onError }),
    descartar: (id, onError) => descartar.mutate(id, { onError }),
  });

  const [now, setNow] = useState(() => Date.now());
  const { falhas, pendentes, travadas } = useMemo(
    () =>
      separarFila(
        [...leadMessages, ...conversationMessages].filter((m) => !ocultas.has(m.id)),
        now,
      ),
    [leadMessages, conversationMessages, now, ocultas],
  );
  const temAlgo = falhas.length + pendentes.length + travadas.length > 0;

  // "Sai em 4 min" recalcula a cada 30 s — e o urgente acende sozinho.
  useEffect(() => {
    if (!temAlgo) return;
    const t = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(t);
  }, [temAlgo]);

  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const aberta = abertaPorConversa.has(chave);
  const definirAberta = useCallback(
    (v: boolean) => {
      if (v) abertaPorConversa.add(chave);
      else abertaPorConversa.delete(chave);
      rerender();
    },
    [chave],
  );

  const [editando, setEditando] = useState<ScheduledMessage | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const confirmTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
  }, []);

  const topoRef = useRef<HTMLButtonElement>(null);
  const digitando = useComposerHasText(chave);

  // Esc no campo do composer fecha a bandeja aberta (evento do bus, sem re-render por tecla).
  useEffect(
    () =>
      onComposerEscape(chave, () => {
        if (abertaPorConversa.has(chave)) definirAberta(false);
      }),
    [chave, definirAberta],
  );

  // Selo no botão Enviar: só com a bandeja fechada (aberta, a fila já está à vista).
  const selo = aberta ? 0 : pendentes.length;
  useEffect(() => {
    publishPendingBadge(chave, selo);
    return () => publishPendingBadge(chave, 0);
  }, [chave, selo]);

  const nomes = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);
  const autor = (createdBy: string) =>
    createdBy === member?.id ? "Você" : nomes.get(createdBy) ?? "outra pessoa da equipe";
  const pode = (m: ScheduledMessage) => podeEscrever(m, member?.id, isMaster);

  const clicarEnviarAgora = (id: string) => {
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    if (confirmando === id) {
      setConfirmando(null);
      enviarAgora.mutate(id);
      return;
    }
    setConfirmando(id);
    confirmTimer.current = window.setTimeout(() => setConfirmando(null), CONFIRMAR_MS);
  };

  if (!temAlgo) return null;

  const falha = falhas[0] ?? null;
  const travada = falha ? null : travadas[0] ?? null;
  const proxima = pendentes[0] ?? null;
  const expansivel = pendentes.length > 0;

  const aoTeclar = (e: KeyboardEvent) => {
    if (e.key === "Escape" && aberta) {
      e.stopPropagation();
      definirAberta(false);
      topoRef.current?.focus();
    }
  };

  const chevron = expansivel && (
    <ChevronDown
      className={cn(
        "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
        aberta && "rotate-180",
      )}
      aria-hidden
    />
  );

  const topoClasses = "flex min-h-[52px] w-full items-center gap-3 px-3 py-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-scheduled";

  let topo: ReactNode;
  let rodape: ReactNode = null;

  if (falha) {
    // O worker empurra `scheduled_at` +2 min a cada retry: o horário guardado é
    // o da ÚLTIMA tentativa, não o programado — o rótulo diz exatamente isso.
    const diaFalha = rotuloDoDia(falha.scheduled_at, now);
    const quandoFalhou = `${diaFalha === "Hoje" ? "" : `${diaFalha.toLowerCase()} `}${hora(falha.scheduled_at)}`;
    const outrasFalhas = falhas.length - 1;
    const conteudo = (
      <>
        <span className="grid h-[30px] w-[30px] shrink-0 place-items-center text-scheduled-danger-ink" data-anel="falhou">
          <AlertTriangle className="h-4 w-4" strokeWidth={1.8} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[13px] font-bold tabular-nums text-foreground">
            <span className="text-scheduled-danger-ink">Não enviada</span> · última tentativa {quandoFalhou}
          </b>
          <span className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
            <SeloDeMidia mediaType={falha.media_type} />
            <span className="truncate">{motivoDaFalha(falha.error_message)}</span>
          </span>
        </span>
        {outrasFalhas > 0 && (
          <span className="shrink-0 rounded-full border border-scheduled-danger-line px-2 py-0.5 text-xs font-bold tabular-nums text-scheduled-danger-ink">
            +{outrasFalhas} {outrasFalhas > 1 ? "falhas" : "falha"}
          </span>
        )}
        {pendentes.length > 0 && <Mais n={pendentes.length} />}
        {chevron}
      </>
    );
    const rotulo = `Mensagem não enviada, última tentativa ${quandoFalhou}.${outrasFalhas ? ` Mais ${outrasFalhas} ${outrasFalhas > 1 ? "falhas" : "falha"}.` : ""}${pendentes.length ? ` Mais ${programadas(pendentes.length)}.` : ""}`;
    topo = expansivel ? (
      <button ref={topoRef} type="button" className={topoClasses} aria-expanded={aberta} aria-label={`${rotulo} ${aberta ? "Ocultar" : "Mostrar"} fila`} onClick={() => definirAberta(!aberta)}>
        {conteudo}
      </button>
    ) : (
      <div className={topoClasses} role="status" aria-label={rotulo}>
        {conteudo}
      </div>
    );
    rodape = (
      <div className="-mt-1 flex flex-wrap items-center gap-1 px-3 pb-2.5 pl-[54px] max-[480px]:pl-3" data-testid="falha-acoes">
        {pode(falha) ? (
          <>
            <Acao variante="danger" onClick={() => tentarDeNovo.mutate(falha.id)} disabled={tentarDeNovo.isPending}>
              <RotateCcw strokeWidth={1.8} aria-hidden />
              Tentar de novo
            </Acao>
            <Acao onClick={() => setEditando(falha)}>
              <Pencil strokeWidth={1.8} aria-hidden />
              Editar
            </Acao>
            <Acao variante="del" onClick={() => adiar("descartar", falha.id)} disabled={descartar.isPending}>
              <X strokeWidth={1.8} aria-hidden />
              Descartar
            </Acao>
          </>
        ) : (
          <span className="text-[11.5px] text-muted-foreground">por {autor(falha.created_by)}</span>
        )}
      </div>
    );
  } else if (travada) {
    const conteudo = (
      <>
        <span className="grid h-[30px] w-[30px] shrink-0 place-items-center text-scheduled-ink" data-anel="travada">
          <AlertTriangle className="h-4 w-4" strokeWidth={1.8} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[13px] font-bold tabular-nums text-foreground">
            <span className="text-scheduled-ink">Envio travado</span> · verifique em instantes
          </b>
          <span className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
            <SeloDeMidia mediaType={travada.media_type} />
            <span className="truncate">{previa(travada)}</span>
          </span>
        </span>
        {pendentes.length > 0 && <Mais n={pendentes.length} />}
        {chevron}
      </>
    );
    const rotulo = `Envio travado desde ${hora(travada.scheduled_at)}, verifique em instantes.${pendentes.length ? ` Mais ${programadas(pendentes.length)}.` : ""}`;
    topo = expansivel ? (
      <button ref={topoRef} type="button" className={topoClasses} aria-expanded={aberta} aria-label={`${rotulo} ${aberta ? "Ocultar" : "Mostrar"} fila`} onClick={() => definirAberta(!aberta)}>
        {conteudo}
      </button>
    ) : (
      <div className={topoClasses} role="status" aria-label={rotulo}>
        {conteudo}
      </div>
    );
  } else if (proxima) {
    const quando = tempoRestante(proxima.scheduled_at, now);
    let titulo: ReactNode;
    let tituloFalado: string;
    if (proxima.status === "sending") {
      titulo = (
        <>
          <span className="text-scheduled-ink">Enviando agora</span> · {hora(proxima.scheduled_at)}
        </>
      );
      tituloFalado = `Enviando agora, ${hora(proxima.scheduled_at)}`;
    } else if (ehUrgente(proxima.scheduled_at, now)) {
      titulo = (
        <>
          Sai <span className="text-scheduled-ink">{quando}</span> · {hora(proxima.scheduled_at)}
        </>
      );
      tituloFalado = `Sai ${quando}, ${hora(proxima.scheduled_at)}`;
    } else {
      const dia = rotuloDoDia(proxima.scheduled_at, now).toLowerCase();
      titulo = (
        <>
          Próxima sai <span className="text-scheduled-ink">{quando}</span> · {dia} {hora(proxima.scheduled_at)}
        </>
      );
      tituloFalado = `Próxima sai ${quando}, ${dia} ${hora(proxima.scheduled_at)}`;
    }
    topo = (
      <button
        ref={topoRef}
        type="button"
        className={topoClasses}
        aria-expanded={aberta}
        aria-label={`${programadas(pendentes.length)}. ${tituloFalado}. ${aberta ? "Ocultar" : "Mostrar"} fila`}
        onClick={() => definirAberta(!aberta)}
      >
        <Anel msg={proxima} now={now} />
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[13px] font-bold tabular-nums text-foreground">{titulo}</b>
          <span className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
            <SeloDeMidia mediaType={proxima.media_type} />
            <span className="truncate">{previa(proxima)}</span>
          </span>
        </span>
        {pendentes.length > 1 && <Mais n={pendentes.length - 1} />}
        {chevron}
      </button>
    );
    if (digitando && !aberta) {
      rodape = (
        <div className="-mt-1 flex items-center gap-2 px-3 pb-2.5 pl-[54px] text-xs font-medium text-foreground max-[480px]:pl-3" role="status">
          <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden />
          <span>Este contato já tem {programadas(pendentes.length)}.</span>
          <button
            type="button"
            className="rounded font-bold text-scheduled-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-scheduled"
            onClick={() => {
              definirAberta(true);
              // O botão "Ver fila" desmonta ao abrir; sem isto o foco caía no
              // <body> e o Esc deixava de chegar na bandeja.
              topoRef.current?.focus();
            }}
          >
            Ver fila
          </button>
        </div>
      );
    }
  }

  return (
    <>
      <div className="mx-3 mt-2">
        <div
          onKeyDown={aoTeclar}
          data-estado={falha ? "falhou" : travada ? "travada" : digitando && !aberta ? "digitando" : aberta ? "aberta" : "fechada"}
          className={cn(
            "overflow-hidden rounded-[14px] border-[1.5px] transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none",
            falha
              ? "border-scheduled-danger-line bg-scheduled-danger-deep"
              : "border-scheduled-line bg-scheduled-deep",
            !falha && !travada && digitando && !aberta && "border-scheduled ring-[3px] ring-scheduled/30",
          )}
        >
          {topo}
          {rodape}
          {aberta && expansivel && (
            <Fila
              itens={pendentes}
              now={now}
              autor={autor}
              pode={pode}
              confirmando={confirmando}
              onEnviarAgora={clicarEnviarAgora}
              onEditar={setEditando}
              onCancelar={(id) => {
                const m = pendentes.find((p) => p.id === id);
                // Saindo em menos de 1 min: o cron pode pegá-la dentro da janela do
                // Desfazer. Aí cancela já (sem desfazer) — adiar seria deixar sair.
                adiar("cancelar", id, !!m && minutosAte(m.scheduled_at, Date.now()) < 1);
              }}
              ocupado={enviarAgora.isPending || cancelar.isPending}
            />
          )}
        </div>
      </div>

      {editando && (
        <ScheduleMessageModal
          open={!!editando}
          onOpenChange={(v) => {
            if (!v) setEditando(null);
          }}
          leadId={leadId}
          leadName={leadName}
          phoneNumber={phoneNumber}
          instanceId={instanceId}
          editingId={editando.id}
          editingContent={editando.message_content || ""}
          editingScheduledAt={new Date(editando.scheduled_at)}
          editingFailed={editando.status === "failed"}
        />
      )}
    </>
  );
}

function Mais({ n }: { n: number }) {
  return (
    <span className="shrink-0 rounded-full border border-scheduled-line bg-scheduled-deep-2 px-2 py-0.5 text-xs font-bold tabular-nums text-foreground">
      +{n}
    </span>
  );
}

interface FilaProps {
  itens: ScheduledMessage[];
  now: number;
  autor: (createdBy: string) => string;
  pode: (m: ScheduledMessage) => boolean;
  confirmando: string | null;
  onEnviarAgora: (id: string) => void;
  onEditar: (m: ScheduledMessage) => void;
  onCancelar: (id: string) => void;
  ocupado: boolean;
}

function Fila({ itens, now, autor, pode, confirmando, onEnviarAgora, onEditar, onCancelar, ocupado }: FilaProps) {
  const grupos = agruparPorDia(itens, now);
  const primeiro = itens[0]?.id;
  const ultimo = itens[itens.length - 1]?.id;
  return (
    <div
      role="region"
      aria-label="Fila de mensagens programadas"
      className="max-h-[260px] overflow-y-auto border-t border-scheduled-line px-1.5 pb-2 pt-1"
    >
      {grupos.map((g) => (
        <div key={g.rotulo} role="group" aria-label={g.rotulo}>
          <div className="pb-1 pl-[80px] pr-2 pt-2.5 text-[10.5px] font-bold uppercase tracking-[.12em] text-muted-foreground max-[480px]:pl-2">
            {g.rotulo}
          </div>
          {g.itens.map((m) => {
            const conf = confirmando === m.id;
            const saindo = m.status === "sending";
            const escreve = pode(m) && !saindo;
            return (
              <div
                key={m.id}
                data-testid="linha-programada"
                className="group grid grid-cols-[52px_14px_1fr] gap-2.5 rounded-[10px] px-2 pb-1.5 pt-2 hover:bg-scheduled-deep-2 focus-within:bg-scheduled-deep-2"
              >
                <div className="pt-px text-right text-[12.5px] font-bold leading-tight tabular-nums">{hora(m.scheduled_at)}</div>
                <div
                  className={cn(
                    "relative flex justify-center",
                    m.id !== ultimo && "before:absolute before:-bottom-3.5 before:top-4 before:w-0.5 before:bg-scheduled-line before:content-['']",
                  )}
                >
                  <span
                    className={cn(
                      "z-[1] mt-1 h-2.5 w-2.5 rounded-full border-2 border-scheduled",
                      m.id === primeiro ? "bg-scheduled" : "bg-card",
                    )}
                    aria-hidden
                  />
                </div>
                <div className="min-w-0">
                  <p className="m-0 line-clamp-2 text-[13px]">
                    <SeloDeMidia mediaType={m.media_type} /> {previa(m)}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    <CalendarClock className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                    <span>por {autor(m.created_by)}</span>
                    <span aria-hidden>·</span>
                    <span className="tabular-nums">{saindo ? "enviando agora" : tempoRestante(m.scheduled_at, now)}</span>
                  </div>
                  {escreve && (
                    <div
                      className={cn(
                        "-ml-2 mt-1.5 flex flex-wrap gap-0.5 transition-opacity duration-100 motion-reduce:transition-none",
                        !conf && "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100",
                      )}
                    >
                      <Acao
                        variante={conf ? "confirm" : "pri"}
                        onClick={() => onEnviarAgora(m.id)}
                        disabled={ocupado}
                        aria-live="polite"
                      >
                        <Send strokeWidth={1.8} aria-hidden />
                        {conf ? "Confirmar envio" : "Enviar agora"}
                      </Acao>
                      <Acao onClick={() => onEditar(m)}>
                        <Pencil strokeWidth={1.8} aria-hidden />
                        Editar
                      </Acao>
                      <Acao variante="del" onClick={() => onCancelar(m.id)} disabled={ocupado}>
                        <X strokeWidth={1.8} aria-hidden />
                        Cancelar
                      </Acao>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

type EscritaAdiavel = "cancelar" | "descartar";

const TEXTO_DESFAZER: Record<EscritaAdiavel, string> = {
  cancelar: "Programação cancelada",
  descartar: "Falha descartada",
};

/**
 * Cancelar / Descartar com Desfazer: a linha some na hora, o toast oferece
 * Desfazer por 5 s e o UPDATE só vai ao banco quando a janela expira. Desfazer
 * = nenhuma escrita.
 *
 * Desmontar ou trocar de conversa DENTRO da janela COMMITA na hora. Escolha
 * deliberada: a pessoa clicou em Cancelar; perder essa intenção deixaria sair
 * uma mensagem que ela mandou não sair. Errar para "cancelado" é recuperável
 * (reprogramar); errar para "enviado" não é. O toast é fechado junto — o
 * Desfazer dele já não teria a quem desfazer.
 */
function useEscritaComDesfazer(
  chave: string,
  executar: Record<EscritaAdiavel, (id: string, onError: () => void) => void>,
) {
  const [ocultas, setOcultas] = useState<ReadonlySet<string>>(() => new Set());
  const pendentesRef = useRef(new Map<string, { tipo: EscritaAdiavel; timer: number; toastId: string | number }>());
  const montado = useRef(true);
  const executarRef = useRef(executar);
  executarRef.current = executar;

  const mostrar = useCallback((id: string) => {
    if (!montado.current) return;
    setOcultas((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const commit = useCallback(
    (tipo: EscritaAdiavel, id: string) => executarRef.current[tipo](id, () => mostrar(id)),
    [mostrar],
  );

  useEffect(() => {
    montado.current = true;
    const pendentes = pendentesRef.current;
    return () => {
      montado.current = false;
      for (const [id, p] of pendentes) {
        window.clearTimeout(p.timer);
        toast.dismiss(p.toastId);
        commit(p.tipo, id);
      }
      pendentes.clear();
    };
  }, [chave, commit]);

  const desfazer = useCallback(
    (id: string) => {
      const p = pendentesRef.current.get(id);
      if (!p) return;
      window.clearTimeout(p.timer);
      pendentesRef.current.delete(id);
      mostrar(id);
    },
    [mostrar],
  );

  const adiar = useCallback(
    (tipo: EscritaAdiavel, id: string, imediato = false) => {
      if (pendentesRef.current.has(id)) return;
      setOcultas((prev) => new Set(prev).add(id));
      if (imediato) {
        commit(tipo, id);
        toast.success(TEXTO_DESFAZER[tipo]);
        return;
      }
      const toastId = toast(TEXTO_DESFAZER[tipo], {
        duration: DESFAZER_MS,
        action: { label: "Desfazer", onClick: () => desfazer(id) },
      });
      const timer = window.setTimeout(() => {
        pendentesRef.current.delete(id);
        commit(tipo, id);
      }, DESFAZER_MS);
      pendentesRef.current.set(id, { tipo, timer, toastId });
    },
    [commit, desfazer],
  );

  return { ocultas, adiar };
}
