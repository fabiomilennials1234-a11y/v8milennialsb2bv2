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
import { Loader2, MessageSquarePlus, Sparkles } from "lucide-react";
import { useAuth } from "@/modules/identity";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useOraculoTurno } from "../hooks/useOraculoTurno";
import { useOraculoConversas, useOraculoTurnos } from "../hooks/useOraculoConversas";

const SUGESTOES = [
  "Onde eu estou perdendo mais dinheiro?",
  "Como está minha conversão nos últimos 30 dias?",
  "Qual etapa do funil trava mais?",
];

export default function Oraculo() {
  const { user } = useAuth();
  const [rascunho, setRascunho] = useState("");
  const oraculo = useOraculoTurno();
  const { data: conversas } = useOraculoConversas(user?.id);
  const { data: turnosSalvos } = useOraculoTurnos(oraculo.conversaId);

  const mensagens = oraculo.mensagens.length > 0 ? oraculo.mensagens : (turnosSalvos ?? []);

  const enviar = () => {
    oraculo.perguntar(rascunho);
    setRascunho("");
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-px overflow-hidden rounded-lg border border-border bg-border">
      <aside className="hidden w-64 shrink-0 flex-col bg-background md:flex">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Conversas
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
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
              className={cn(
                "w-full truncate rounded-md px-3 py-2 text-left text-sm transition-colors",
                c.id === oraculo.conversaId
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {c.titulo}
            </button>
          ))}
          {(conversas ?? []).length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              Nenhuma conversa ainda.
            </p>
          )}
        </ScrollArea>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-background">
        <header className="flex items-baseline gap-3 border-b border-border px-6 py-4">
          <h1 className="text-lg font-semibold tracking-tight">Oráculo Comercial</h1>
          <p className="truncate text-sm text-muted-foreground">
            O analista da sua operação — lê os números e diz onde agir.
          </p>
          {oraculo.restantesHoje !== null && (
            <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
              {oraculo.restantesHoje} perguntas hoje
            </span>
          )}
        </header>

        <ScrollArea className="flex-1 px-6">
          <div className="mx-auto max-w-3xl space-y-6 py-6">
            {mensagens.length === 0 && (
              <div className="space-y-4 pt-10 text-center">
                <Sparkles className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Pergunte sobre o seu funil. Ele consulta os números antes de responder.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGESTOES.map((s) => (
                    <Button key={s} variant="outline" size="sm" onClick={() => oraculo.perguntar(s)}>
                      {s}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {mensagens.map((m) => (
              <div key={m.id} className={cn("flex", m.role === "user" && "justify-end")}>
                <div
                  className={cn(
                    "max-w-[85%] space-y-2 rounded-2xl px-4 py-3 text-sm leading-relaxed",
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground",
                  )}
                >
                  <p className="whitespace-pre-wrap">{m.content}</p>
                  {m.procedencia && m.procedencia.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Consultei: {m.procedencia.join(", ")}
                    </p>
                  )}
                </div>
              </div>
            ))}

            {oraculo.pensando && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Consultando os números…
              </div>
            )}

            {oraculo.erro && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {oraculo.erro}
              </p>
            )}
          </div>
        </ScrollArea>

        <div className="border-t border-border p-4">
          <div className="mx-auto flex max-w-3xl gap-2">
            <Textarea
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
              className="max-h-40 min-h-[44px] resize-none"
            />
            <Button onClick={enviar} disabled={!rascunho.trim() || oraculo.pensando}>
              Perguntar
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
