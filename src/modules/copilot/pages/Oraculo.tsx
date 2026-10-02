/**
 * Oráculo Comercial — a rota dedicada, em tela cheia.
 *
 * O card antigo está órfão desde 13/05, quando a lateral legada foi apagada; o
 * botão flutuante levava a um chat sem memória e com teto de 3 perguntas. Aqui
 * o Oráculo tem endereço próprio: histórico à esquerda, conversa à direita.
 *
 * V5 (mockup "Oráculo"): conversas numa lista em tinta agrupada por data e com
 * busca; a manchete do briefing do dia no topo; perguntas sugeridas sempre à
 * mão; "Esta conversa ajudou?" no fim do fio.
 *
 * Duas coisas que a tela precisa dizer e a antiga não dizia:
 *   1. De onde veio a resposta — a procedência aparece sob cada fala.
 *   2. Quando ele não sabe. Silêncio vira desconfiança; "não tenho base" não.
 */
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowRight, ArrowUp, Loader2, MessageSquare, MessageSquarePlus, Sparkles } from "lucide-react";
import { differenceInCalendarDays, format, isToday, isYesterday, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useOrgFeaturesOptional } from "@/contexts/OrgFeaturesContext";
import { PillSearch } from "@/shared/components/PillSearch";
import { useAuth, useOrganization } from "@/modules/identity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useOraculoTurno } from "../hooks/useOraculoTurno";
import { useOraculoFeedback } from "../hooks/useOraculoFeedback";
import { useOraculoConversas, useOraculoTurnos, type OraculoConversaResumo } from "../hooks/useOraculoConversas";
import { useOraculoBriefing } from "../hooks/useOraculoBriefing";
import { OraculoPropostaCard } from "../components/oraculo/OraculoPropostaCard";
import { OraculoPerfilPerguntaCard } from "../components/oraculo/OraculoPerfilPerguntaCard";
import { OraculoFeedbackControl } from "../components/oraculo/OraculoFeedbackControl";
import { FocusCard, IconChip, InkPanel, InkRow } from "@/components/ui/bento";

const SUGESTOES = [
  "Onde eu estou perdendo mais dinheiro?",
  "Como está minha conversão nos últimos 30 dias?",
  "Qual etapa do funil trava mais?",
];

export default function Oraculo() {
  const { user } = useAuth();
  const { organizationId, isReady } = useOrganization();
  if (!user || !isReady || !organizationId) return <p role="status">Carregando organização…</p>;
  return <ConversaDaOrganizacao key={`${user.id}:${organizationId}`} userId={user.id} organizationId={organizationId} />;
}

function ConversaDaOrganizacao({ userId, organizationId }: { userId: string; organizationId: string }) {
  const [searchParams] = useSearchParams();
  const conversaParam = searchParams.get("conversa") ?? "";
  const conversaInicial = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversaParam)
    ? conversaParam
    : undefined;
  const [rascunho, setRascunho] = useState("");
  const [busca, setBusca] = useState("");
  // O briefing depende do provider de features; sem ele (harness de teste) a
  // manchete simplesmente não monta.
  const temFeatures = !!useOrgFeaturesOptional();
  const oraculo = useOraculoTurno(organizationId, conversaInicial);
  const feedback = useOraculoFeedback(organizationId, oraculo.conversaId);
  const { data: conversas } = useOraculoConversas(userId, organizationId);
  const historico = useOraculoTurnos(oraculo.conversaId, userId, organizationId);

  const turnosSalvos = historico.data;
  const aguardandoHistorico = !!oraculo.conversaId && !historico.isSuccess;
  const mensagens = oraculo.mensagens.length > 0 ? oraculo.mensagens : (turnosSalvos ?? []);

  const enviar = () => {
    if (aguardandoHistorico) return;
    oraculo.perguntar(rascunho, turnosSalvos ?? []);
    setRascunho("");
  };

  const q = busca.trim().toLowerCase();
  const filtradas = (conversas ?? []).filter((c) => !q || c.titulo.toLowerCase().includes(q));
  const grupos = agruparPorData(filtradas);
  const conversaAtual = (conversas ?? []).find((c) => c.id === oraculo.conversaId) ?? null;

  return (
    <div className="flex h-[calc(100dvh-7rem)] min-h-[560px] flex-col gap-4">
      <PageHeader
        title="Oráculo Comercial"
        subtitle="O analista da sua operação — lê os números e diz onde agir."
        actions={
          <>
            {oraculo.restantesHoje !== null && (
              <Badge variant="soft" className="tabular-nums">
                {oraculo.restantesHoje} perguntas hoje
              </Badge>
            )}
            <Button onClick={() => oraculo.abrirConversa(null, [])}>
              <MessageSquarePlus />
              Nova conversa
            </Button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Conversas — lista em tinta, busca e grupos por data */}
        <InkPanel
          title="Conversas"
          count={(conversas ?? []).length || undefined}
          className="hidden w-[320px] shrink-0 flex-col md:flex"
        >
          <div className="space-y-2 px-0.5 pb-2">
            <PillSearch value={busca} onValueChange={setBusca} placeholder="Buscar conversa" aria-label="Buscar conversa" onInk />
          </div>
          <ScrollArea className="-mx-1 min-h-0 flex-1 px-1">
            {grupos.map((g) => (
              <div key={g.rotulo} className="pb-2">
                <p className="px-3 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-[.08em] text-tinta-muted">{g.rotulo}</p>
                {g.itens.map((c) => {
                  const selected = c.id === oraculo.conversaId;
                  return (
                    <InkRow
                      key={c.id}
                      selected={selected}
                      onClick={() => oraculo.abrirConversa(c.id, [])}
                      aria-current={selected ? "true" : undefined}
                      className="py-2"
                    >
                      <MessageSquare
                        className={cn("h-4 w-4 shrink-0", selected ? "text-primary-foreground" : "text-primary")}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{c.titulo}</span>
                      {c.ultimaMensagemEm && (
                        <span
                          className={cn("shrink-0 text-[10.5px] tabular-nums", selected ? "text-primary-foreground/70" : "text-tinta-muted")}
                          aria-hidden
                        >
                          {quando(c.ultimaMensagemEm)}
                        </span>
                      )}
                    </InkRow>
                  );
                })}
              </div>
            ))}
            {(conversas ?? []).length === 0 && (
              <p className="px-3 py-2 text-[13px] text-tinta-muted">Nenhuma conversa ainda.</p>
            )}
            {(conversas ?? []).length > 0 && filtradas.length === 0 && (
              <p className="px-3 py-2 text-[13px] text-tinta-muted">Nenhuma conversa com esse título.</p>
            )}
          </ScrollArea>
        </InkPanel>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {temFeatures && (
            <BriefingDeHoje onAbrir={(conversaId) => oraculo.abrirConversa(conversaId, [])} />
          )}

          <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-card-border bg-card shadow-relevo">
            <div className="space-y-3 border-b border-border/60 px-5 py-3.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="min-w-0 truncate text-[15px] font-extrabold tracking-[-0.02em]">
                  {conversaAtual?.titulo ?? (oraculo.conversaId ? "Conversa" : "Nova conversa")}
                </h2>
                {conversaAtual?.ultimaMensagemEm && (
                  <span className="text-xs text-muted-foreground">{quando(conversaAtual.ultimaMensagemEm, true)}</span>
                )}
              </div>
              {/* Perguntas sugeridas — sempre à mão, não só na conversa vazia */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[11px] font-bold uppercase tracking-[.08em] text-muted-foreground">Perguntas sugeridas</span>
                {SUGESTOES.map((sug) => (
                  <button
                    key={sug}
                    type="button"
                    disabled={aguardandoHistorico || oraculo.pensando}
                    onClick={() => oraculo.perguntar(sug, turnosSalvos ?? [])}
                    className="inline-flex items-center gap-1.5 rounded-full border border-input bg-card px-3 py-1.5 text-xs font-semibold text-foreground/85 shadow-relevo transition-colors hover:border-foreground/20 hover:text-foreground disabled:opacity-50"
                  >
                    <Sparkles className="h-3 w-3 text-primary" aria-hidden />
                    {sug}
                  </button>
                ))}
              </div>
            </div>

            <ScrollArea className="flex-1 px-5">
              <div className="mx-auto max-w-3xl space-y-6 py-6">
                {oraculo.conversaId && historico.isPending && (
                  <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Carregando histórico…
                  </p>
                )}
                {historico.isError && (
                  <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/[.06] px-4 py-3 text-sm">
                    <p className="flex-1 text-destructive">Não consegui carregar o histórico.</p>
                    <Button variant="outline" size="sm" onClick={() => void historico.refetch()}>Tentar novamente</Button>
                  </div>
                )}
                {mensagens.length === 0 && !aguardandoHistorico && (
                  <div className="flex flex-col items-center gap-3 pt-8 text-center">
                    <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-primary-soft-foreground">
                      <Sparkles className="h-6 w-6" />
                    </span>
                    <p className="max-w-md text-sm text-muted-foreground">
                      Pergunte sobre o seu funil. Ele consulta os números antes de responder.
                    </p>
                  </div>
                )}

                {mensagens.map((m) =>
                  m.role === "user" ? (
                    <div key={m.id} className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-tinta px-4 py-2.5 text-sm leading-relaxed text-tinta-foreground shadow-relevo">
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} className="flex gap-3">
                      <IconChip icon={Sparkles} tone="gold" className="mt-0.5" />
                      <div className="min-w-0 flex-1 space-y-2 text-sm leading-relaxed text-foreground">
                        <p className="text-xs text-muted-foreground">
                          <span className="font-bold text-foreground">Oráculo</span>
                          {m.procedencia && m.procedencia.length > 0 && <> · consultei {m.procedencia.join(", ")}</>}
                        </p>
                        <p className="whitespace-pre-wrap">{m.content}</p>
                        {m.propostas && m.propostas.length > 0 && (
                          <div className="space-y-2 pt-1">
                            <p className="text-[11px] font-bold uppercase tracking-[.08em] text-muted-foreground">Ações sugeridas</p>
                            {m.propostas.map((proposta) => (
                              <OraculoPropostaCard
                                key={proposta.id}
                                proposta={proposta}
                                onConfirmar={oraculo.executarProposta}
                                ocupada={oraculo.executandoPropostaId === proposta.id}
                                desabilitada={oraculo.executandoPropostaId !== null}
                              />
                            ))}
                          </div>
                        )}
                        {m.perguntasPerfil?.map((question) => (
                          <OraculoPerfilPerguntaCard
                            key={question.id}
                            question={question}
                            onAnswer={oraculo.responderPerguntaPerfil}
                            onSkip={oraculo.ignorarPerguntaPerfil}
                            busy={oraculo.salvandoPerguntaPerfilId === question.id}
                          />
                        ))}
                        <OraculoFeedbackControl
                          label="esta resposta"
                          value={feedback.state.responses[m.id]}
                          busy={feedback.busyTarget === m.id}
                          onSubmit={(value) => feedback.submitResponse(m.id, value)}
                        />
                      </div>
                    </div>
                  ),
                )}

                {oraculo.pensando && (
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <IconChip icon={Loader2} tone="gold" iconClassName="animate-spin" />
                    Consultando os números…
                  </div>
                )}

                {oraculo.erro && (
                  <p className="rounded-2xl border border-destructive/30 bg-destructive/[.06] px-4 py-3 text-sm text-destructive">
                    {oraculo.erro}
                  </p>
                )}

                {/* Avaliação da conversa — no fim do fio, depois de lida */}
                {oraculo.conversaId && mensagens.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted/50 px-4 py-3">
                    <span className="text-[13px] font-semibold text-foreground/85">Esta conversa ajudou?</span>
                    <OraculoFeedbackControl
                      label="esta conversa"
                      value={feedback.state.conversation}
                      busy={feedback.busyTarget === oraculo.conversaId}
                      onSubmit={feedback.submitConversation}
                    />
                  </div>
                )}
              </div>
            </ScrollArea>

            <div className="border-t border-border/60 p-4">
              <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-full border border-input bg-muted/50 py-1.5 pl-4 pr-1.5 focus-within:ring-2 focus-within:ring-ring/40">
                <Sparkles className="mb-3 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <Textarea
                  disabled={aguardandoHistorico}
                  value={rascunho}
                  onChange={(e) => setRascunho(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      enviar();
                    }
                  }}
                  placeholder="Pergunte sobre o seu funil…"
                  rows={1}
                  className="max-h-40 min-h-[40px] resize-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <Button
                  variant="ink"
                  onClick={enviar}
                  disabled={!rascunho.trim() || oraculo.pensando || aguardandoHistorico}
                >
                  Perguntar
                  <ArrowUp aria-hidden />
                </Button>
              </div>
              <p className="mx-auto mt-2 max-w-3xl px-4 text-[11px] text-muted-foreground">
                O Oráculo pode errar em recortes muito específicos. Confira os números críticos em Métricas.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * A manchete do briefing do dia, no topo da página (o slot da lateral saiu).
 * "Aprofundar" é a MESMA mutation da lateral: abre a conversa do briefing.
 * Montado só com o provider de features presente — o hook depende dele.
 */
function BriefingDeHoje({ onAbrir }: { onAbrir: (conversaId: string) => void }) {
  const briefing = useOraculoBriefing();
  const atual = briefing.briefing;
  if (!atual) return null;
  const data = (() => {
    try {
      const txt = format(parseISO(atual.local_date), "EEEE, dd 'de' MMMM", { locale: ptBR });
      return txt.charAt(0).toUpperCase() + txt.slice(1);
    } catch {
      return atual.local_date;
    }
  })();
  return (
    <FocusCard className="shrink-0 gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-foreground px-2.5 py-1 text-[11px] font-bold text-primary">
          <Sparkles className="h-3 w-3" aria-hidden />
          Briefing de hoje
        </span>
        <span className="text-[12px] font-semibold text-primary-foreground/70">{data}</span>
      </div>
      <p className="text-[1.65rem] font-extrabold leading-[1.15] tracking-[-0.035em] max-sm:text-[1.3rem]">{atual.headline}</p>
      <div>
        <button
          type="button"
          disabled={briefing.isOpening}
          onClick={() => {
            void briefing
              .open(atual.id)
              .then((aberto) => onAbrir(aberto.conversa_id))
              .catch(() => undefined);
          }}
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-tinta-foreground px-4 text-[13px] font-bold text-primary-foreground shadow-relevo transition-colors hover:bg-tinta-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground disabled:opacity-60"
        >
          {briefing.isOpening ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Aprofundar no briefing
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </FocusCard>
  );
}

/** "14:32" hoje, "ontem", "seg" na semana, "12/09" antes. */
function quando(iso: string, longo = false): string {
  try {
    const d = parseISO(iso);
    if (isToday(d)) return longo ? `hoje às ${format(d, "HH:mm")}` : format(d, "HH:mm");
    if (isYesterday(d)) return "ontem";
    if (differenceInCalendarDays(new Date(), d) < 7) return format(d, longo ? "EEEE" : "EEE", { locale: ptBR });
    return format(d, "dd/MM");
  } catch {
    return "";
  }
}

/** Hoje · Esta semana · Anteriores, pela última mensagem. */
function agruparPorData(conversas: OraculoConversaResumo[]) {
  const grupos: { rotulo: string; itens: OraculoConversaResumo[] }[] = [
    { rotulo: "Hoje", itens: [] },
    { rotulo: "Esta semana", itens: [] },
    { rotulo: "Anteriores", itens: [] },
  ];
  for (const c of conversas) {
    const d = c.ultimaMensagemEm ? parseISO(c.ultimaMensagemEm) : null;
    if (d && isToday(d)) grupos[0].itens.push(c);
    else if (d && differenceInCalendarDays(new Date(), d) < 7) grupos[1].itens.push(c);
    else grupos[2].itens.push(c);
  }
  return grupos.filter((g) => g.itens.length > 0);
}
