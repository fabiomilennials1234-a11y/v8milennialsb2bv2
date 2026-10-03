/**
 * `SeletorConversaDoLead` — a lista que pergunta por qual caixa falar.
 *
 * Conceito escolhido no #1607: lista densa. A caixa domina a linha, a conversa
 * entra como legenda.
 *
 * Os dois pontos que o protótipo deixou ABERTOS e que este componente resolve:
 *
 *  1. **Os dois grupos ficavam visualmente idênticos.** "Iniciar conversa por"
 *     parecia mais conversa — e é o oposto: começar um primeiro contato define
 *     quem é o dono da conversa dali em diante, e trocar depois é caro. Aqui o
 *     segundo grupo ganha separador, fundo próprio e um aviso explícito de que
 *     é primeiro contato.
 *
 *  2. **O estado desconectado não comunicava** — era uma bolinha de 6px. Agora
 *     é um rótulo com texto ("Desconectado" / "Sem acesso a este número"), e a
 *     linha fica atenuada mas continua clicável, porque decisão 6 diz que
 *     desabilitada significa *não pode escrever*, não *não pode ver*.
 *
 * Sem badge de não-lidas: o contador vem de `localStorage` e é por dispositivo
 * (#1610). Número que muda conforme o aparelho, num seletor que existe para
 * dar confiança, é pior que número nenhum.
 */
import { useMemo } from "react";
import { MessageCircle, Instagram, ArrowDownLeft, ArrowUpRight, PlugZap, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import {
  agruparConversasDoLead,
  type ConversaDoLeadRow,
} from "@/modules/communication/lib/agruparConversasDoLead";

export interface SeletorConversaDoLeadProps {
  caixas: ReadonlyArray<ConversaDoLeadRow>;
  /** Caixas em que o usuário pode ESCREVER. As demais abrem em leitura. */
  instanceIdsComEscrita: ReadonlyArray<string>;
  /** Preferência de caixa do usuário logado. */
  preferredInstanceId?: string | null;
  onEscolher: (instanceId: string) => void;
}

function motivoSemEscrita(
  row: ConversaDoLeadRow,
  podeEscrever: boolean,
): { texto: string; Icone: typeof PlugZap } | null {
  if (row.instanceStatus !== "connected") {
    return { texto: "Desconectado", Icone: PlugZap };
  }
  if (!podeEscrever) {
    return { texto: "Sem acesso a este número", Icone: Lock };
  }
  return null;
}

function recencia(iso: string | null): string {
  if (!iso) return "";
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  return `há ${meses} ${meses === 1 ? "mês" : "meses"}`;
}

function IconeCanal({ row }: { row: ConversaDoLeadRow }) {
  // Instagram não tem telefone; a caixa social é reconhecida pelo @ no nome.
  const Icone = row.instanceName.trim().startsWith("@") ? Instagram : MessageCircle;
  return <Icone className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
}

export function SeletorConversaDoLead({
  caixas,
  instanceIdsComEscrita,
  preferredInstanceId = null,
  onEscolher,
}: SeletorConversaDoLeadProps) {
  const escrita = useMemo(() => new Set(instanceIdsComEscrita), [instanceIdsComEscrita]);
  const { comConversa, semConversa } = useMemo(
    () => agruparConversasDoLead({ rows: caixas, preferredInstanceId }),
    [caixas, preferredInstanceId],
  );

  return (
    <div className="w-[380px] overflow-hidden rounded-xl border border-border bg-card">
      {comConversa.length > 0 && (
        <section aria-labelledby="conversa-em-andamento">
          <h3
            id="conversa-em-andamento"
            className="px-3 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
          >
            Conversa em andamento
          </h3>
          {comConversa.map((row) => {
            const motivo = motivoSemEscrita(row, escrita.has(row.instanceId));
            return (
              <button
                key={row.instanceId}
                type="button"
                onClick={() => onEscolher(row.instanceId)}
                className={cn(
                  "grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2 text-left",
                  "transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
                  motivo && "opacity-70",
                )}
              >
                <IconeCanal row={row} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{row.instanceName}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    {row.lastMessageDirection === "incoming" ? (
                      <ArrowDownLeft className="size-3 shrink-0 text-emerald-500" aria-label="recebida" />
                    ) : (
                      <ArrowUpRight className="size-3 shrink-0" aria-label="enviada" />
                    )}
                    <span className="truncate">{row.lastMessageContent ?? "mídia"}</span>
                  </span>
                </span>
                <span className="flex flex-col items-end gap-0.5">
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {recencia(row.lastMessageAt)}
                  </span>
                  {motivo && (
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <motivo.Icone className="size-3" aria-hidden />
                      {motivo.texto}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </section>
      )}

      {semConversa.length > 0 && (
        <section aria-labelledby="iniciar-conversa-por" className="bg-muted/30">
          {comConversa.length > 0 && <Separator />}
          <div className="px-3 pb-1 pt-2.5">
            <h3
              id="iniciar-conversa-por"
              className="text-[11px] font-medium uppercase tracking-wider text-foreground"
            >
              Iniciar conversa por
            </h3>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              Primeiro contato — o número escolhido vira o dono da conversa.
            </p>
          </div>
          {semConversa.map((row) => {
            const motivo = motivoSemEscrita(row, escrita.has(row.instanceId));
            return (
              <button
                key={row.instanceId}
                type="button"
                onClick={() => onEscolher(row.instanceId)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2 text-left",
                  "transition-colors hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none",
                  motivo && "opacity-70",
                )}
              >
                {/* Ícone diz o CANAL, não a ação: o fundo e o rótulo do grupo
                    já dizem que aqui se começa conversa. Trocar por um ícone de
                    envio fazia a caixa de Instagram parecer WhatsApp. */}
                <IconeCanal row={row} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.instanceName}</span>
                {motivo && (
                  <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                    <motivo.Icone className="size-3" aria-hidden />
                    {motivo.texto}
                  </span>
                )}
              </button>
            );
          })}
        </section>
      )}
    </div>
  );
}
