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
import { cn } from "@/lib/utils";
import { useOraculoTurno } from "../../hooks/useOraculoTurno";

const SUGESTOES = [
  "Onde eu estou perdendo mais dinheiro?",
  "Qual etapa do funil trava mais?",
];

export function OraculoConversa() {
  const [rascunho, setRascunho] = useState("");
  const oraculo = useOraculoTurno();

  const enviar = () => {
    const texto = rascunho.trim();
    if (!texto) return;
    oraculo.perguntar(texto);
    setRascunho("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1 px-4">
        <div className="space-y-4 py-4">
          {oraculo.mensagens.length === 0 && (
            <div className="space-y-3 pt-6 text-center">
              <Sparkles className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="text-[13px] text-muted-foreground">
                Pergunte sobre o seu funil. Ele consulta os números antes de responder.
              </p>
              <div className="flex flex-col gap-1.5">
                {SUGESTOES.map((s) => (
                  <Button
                    key={s}
                    variant="outline"
                    size="sm"
                    className="h-auto whitespace-normal py-1.5 text-[12px]"
                    onClick={() => oraculo.perguntar(s)}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {oraculo.mensagens.map((m) => (
            <div key={m.id} className={cn("flex", m.role === "user" && "justify-end")}>
              <div
                className={cn(
                  "max-w-[90%] space-y-1.5 rounded-2xl px-3 py-2 text-[13px] leading-relaxed",
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground",
                )}
              >
                <p className="whitespace-pre-wrap">{m.content}</p>
                {/* A procedência é o que separa análise de chute: sem ela, o
                    número na tela não tem de onde ser conferido. */}
                {m.procedencia && m.procedencia.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Consultei: {m.procedencia.join(", ")}
                  </p>
                )}
              </div>
            </div>
          ))}

          {oraculo.pensando && (
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Consultando os números…
            </div>
          )}

          {oraculo.erro && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              {oraculo.erro}
            </p>
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-border p-3">
        {oraculo.restantesHoje !== null && (
          <p className="mb-2 text-[11px] tabular-nums text-muted-foreground">
            {oraculo.restantesHoje} perguntas hoje
          </p>
        )}
        <div className="flex gap-2">
          <Textarea
            aria-label="Sua pergunta ao Oráculo"
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
            className="max-h-32 min-h-[40px] resize-none text-[13px]"
          />
          <Button size="sm" onClick={enviar} disabled={!rascunho.trim() || oraculo.pensando}>
            Perguntar
          </Button>
        </div>
      </div>
    </div>
  );
}
