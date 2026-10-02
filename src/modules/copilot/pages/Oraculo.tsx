/**
 * Oráculo Comercial — a rota dedicada, em tela cheia.
 *
 * O card antigo está órfão desde 13/05, quando a lateral legada foi apagada; o
 * botão flutuante levava a um chat sem memória e com teto de 3 perguntas. Aqui
 * o Oráculo tem endereço próprio: histórico à esquerda, conversa à direita.
 *
 * Duas coisas que a tela precisa dizer e a antiga não dizia:
 *   1. De onde veio a resposta — a procedência aparece sob cada fala.
 *   2. Quando ele não sabe. Silêncio vira desconfiança; "não tenho base" não.
 */
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowUp, Loader2, MessageSquarePlus, Sparkles } from "lucide-react";
import { useAuth, useOrganization } from "@/modules/identity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useOraculoTurno } from "../hooks/useOraculoTurno";
import { useOraculoFeedback } from "../hooks/useOraculoFeedback";
import { useOraculoConversas, useOraculoTurnos } from "../hooks/useOraculoConversas";
import { OraculoPropostaCard } from "../components/oraculo/OraculoPropostaCard";
import { OraculoPerfilPerguntaCard } from "../components/oraculo/OraculoPerfilPerguntaCard";
import { OraculoFeedbackControl } from "../components/oraculo/OraculoFeedbackControl";
import { IconChip } from "@/components/ui/bento";

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

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-0 flex-col gap-4">
      <PageHeader
        title="Oráculo Comercial"
        subtitle="O analista da sua operação — lê os números e diz onde agir."
        actions={
          oraculo.restantesHoje !== null ? (
            <Badge variant="soft" className="tabular-nums">
              {oraculo.restantesHoje} perguntas hoje
            </Badge>
          ) : undefined
        }
      />

      <div className="flex min-h-0 flex-1 gap-4">
        <aside className="hidden w-64 shrink-0 flex-col overflow-hidden rounded-card border border-card-border bg-card shadow-relevo md:flex">
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
            <span className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
              Conversas
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-[10px]"
              aria-label="Nova conversa"
              onClick={() => oraculo.abrirConversa(null, [])}
            >
              <MessageSquarePlus className="h-4 w-4" />
            </Button>
          </div>
          <ScrollArea className="flex-1 px-2 pb-2">
            {(conversas ?? []).map((c) => (
              <button
                key={c.id}
                onClick={() => oraculo.abrirConversa(c.id, [])}
                aria-current={c.id === oraculo.conversaId ? "true" : undefined}
                className={cn(
                  "mb-0.5 w-full truncate rounded-xl px-3 py-2 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  c.id === oraculo.conversaId
                    ? "bg-primary-soft font-semibold text-primary-soft-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {c.titulo}
              </button>
            ))}
            {(conversas ?? []).length === 0 && (
              <p className="px-3 py-2 text-[13px] text-muted-foreground">
                Nenhuma conversa ainda.
              </p>
            )}
          </ScrollArea>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-card-border bg-card shadow-relevo">
          {oraculo.conversaId && (
            <div className="flex items-center justify-end gap-3 border-b border-border/60 px-5 py-2.5">
              <span className="text-xs text-muted-foreground">Esta conversa ajudou?</span>
              <OraculoFeedbackControl
                label="esta conversa"
                value={feedback.state.conversation}
                busy={feedback.busyTarget === oraculo.conversaId}
                onSubmit={feedback.submitConversation}
              />
            </div>
          )}

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
                <div className="flex flex-col items-center gap-4 pt-10 text-center">
                  <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-primary-soft-foreground">
                    <Sparkles className="h-6 w-6" />
                  </span>
                  <p className="max-w-md text-sm text-muted-foreground">
                    Pergunte sobre o seu funil. Ele consulta os números antes de responder.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {SUGESTOES.map((s) => (
                      <Button
                        key={s}
                        disabled={aguardandoHistorico || oraculo.pensando}
                        variant="outline"
                        size="sm"
                        className="h-auto whitespace-normal py-2 text-left"
                        onClick={() => oraculo.perguntar(s, turnosSalvos ?? [])}
                      >
                        <Sparkles className="text-primary" />
                        {s}
                      </Button>
                    ))}
                  </div>
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
                      <p className="whitespace-pre-wrap">{m.content}</p>
                      {m.procedencia && m.procedencia.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Consultei: {m.procedencia.join(", ")}
                        </p>
                      )}
                      {m.propostas?.map((proposta) => (
                        <OraculoPropostaCard
                          key={proposta.id}
                          proposta={proposta}
                          onConfirmar={oraculo.executarProposta}
                          ocupada={oraculo.executandoPropostaId === proposta.id}
                          desabilitada={oraculo.executandoPropostaId !== null}
                        />
                      ))}
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
            </div>
          </ScrollArea>

          <div className="border-t border-border/60 p-4">
            <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-[22px] border border-input bg-sunken p-1.5 focus-within:ring-2 focus-within:ring-ring/40">
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
                className="max-h-40 min-h-[40px] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              <Button
                onClick={enviar}
                disabled={!rascunho.trim() || oraculo.pensando || aguardandoHistorico}
              >
                Perguntar
                <ArrowUp />
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
