/**
 * A conversa do Oráculo em coluna estreita — a forma que entra no painel da
 * lateral.
 *
 * A tela cheia de `/oraculo` continua existindo, com a lista de conversas ao
 * lado; aqui só cabe a conversa. As duas superfícies compartilham o mesmo
 * `useOraculoTurno`, então o teto diário e a procedência valem igual nas duas.
 */

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useIdentity, useOrganization } from "@/modules/identity";
import { useOraculoFeedback } from "../../hooks/useOraculoFeedback";
import { useOraculoTurnos } from "../../hooks/useOraculoConversas";
import { useOraculoTurno } from "../../hooks/useOraculoTurno";
import { OraculoFeedbackControl } from "./OraculoFeedbackControl";
import { OraculoPropostaCard } from "./OraculoPropostaCard";
import { OraculoPerfilPerguntaCard } from "./OraculoPerfilPerguntaCard";

const SUGESTOES = [
  "Onde eu estou perdendo mais dinheiro?",
  "Qual etapa do funil trava mais?",
];

export function OraculoConversa({ conversaInicial }: { conversaInicial?: string | null }) {
  const [rascunho, setRascunho] = useState("");
  const { organizationId } = useOrganization();
  const { userId } = useIdentity();
  const oraculo = useOraculoTurno(organizationId, conversaInicial ?? undefined);
  const historico = useOraculoTurnos(
    oraculo.conversaId,
    userId ?? undefined,
    organizationId ?? undefined,
  );
  const feedback = useOraculoFeedback(organizationId, oraculo.conversaId);
  const mensagens = oraculo.mensagens.length > 0 ? oraculo.mensagens : (historico.data ?? []);
  const aguardandoHistorico = !!oraculo.conversaId && !historico.isSuccess;

  const enviar = () => {
    const texto = rascunho.trim();
    if (!texto) return;
    oraculo.perguntar(texto, historico.data ?? []);
    setRascunho("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1 px-4">
        <div className="space-y-4 py-4">
          {mensagens.length === 0 && !aguardandoHistorico && (
            <div className="flex flex-col items-center gap-3 pt-6 text-center">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-primary-soft text-primary-soft-foreground">
                <Sparkles className="h-5 w-5" />
              </span>
              <p className="text-[13px] text-muted-foreground">
                Pergunte sobre o seu funil. Ele consulta os números antes de responder.
              </p>
              <div className="flex w-full flex-col gap-1.5">
                {SUGESTOES.map((s) => (
                  <Button
                    key={s}
                    variant="outline"
                    size="sm"
                    className="h-auto justify-start whitespace-normal py-2 text-left text-[12px]"
                    onClick={() => oraculo.perguntar(s)}
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
                <div className="max-w-[90%] rounded-2xl rounded-br-md bg-tinta px-3 py-2 text-[13px] leading-relaxed text-tinta-foreground">
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
              </div>
            ) : (
              <div key={m.id} className="flex gap-2.5">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-primary-soft text-primary-soft-foreground">
                  <Sparkles className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1 space-y-1.5 text-[13px] leading-relaxed text-foreground">
                  <p className="whitespace-pre-wrap">{m.content}</p>
                  {/* A procedência é o que separa análise de chute: sem ela, o
                      número na tela não tem de onde ser conferido. */}
                  {m.procedencia && m.procedencia.length > 0 && (
                    <p className="text-[11px] text-muted-foreground">
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
            <div className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-primary-soft text-primary-soft-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              </span>
              Consultando os números…
            </div>
          )}

          {oraculo.erro && (
            <p className="rounded-xl border border-destructive/30 bg-destructive/[.06] px-3 py-2 text-[12px] text-destructive">
              {oraculo.erro}
            </p>
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-border/60 p-3">
        {oraculo.conversaId && (
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground">Esta conversa ajudou?</span>
            <OraculoFeedbackControl
              label="esta conversa"
              value={feedback.state.conversation}
              busy={feedback.busyTarget === oraculo.conversaId}
              onSubmit={feedback.submitConversation}
            />
          </div>
        )}
        {oraculo.restantesHoje !== null && (
          <p className="mb-2 text-[11px] tabular-nums text-muted-foreground">
            {oraculo.restantesHoje} perguntas hoje
          </p>
        )}
        <div className="flex items-end gap-1.5 rounded-[20px] border border-input bg-sunken p-1 focus-within:ring-2 focus-within:ring-ring/40">
          <Textarea
            aria-label="Sua pergunta ao Oráculo"
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            disabled={aguardandoHistorico}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                enviar();
              }
            }}
            placeholder="Pergunte sobre o seu funil…"
            rows={1}
            className="max-h-32 min-h-[36px] resize-none border-0 bg-transparent px-2.5 py-2 text-[13px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <Button size="sm" onClick={enviar} disabled={!rascunho.trim() || oraculo.pensando || aguardandoHistorico}>
            Perguntar
          </Button>
        </div>
      </div>
    </div>
  );
}
