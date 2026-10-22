/**
 * O que a régua faz hoje: quem receberia agora (prévia, sem gravar nada) e o
 * que já foi enviado, falhou ou está na fila. Cada mensagem pode ser aberta e
 * lida exatamente como sai.
 */
import { ChevronDown, Loader2, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notifyError } from "@/shared/errors";
import { cn } from "@/lib/utils";

import { haQuantoTempo } from "../../lib/atraso";
import { recusaDaCobranca } from "../../lib/erros";
import {
  type CandidatoDaPrevia,
  type PreviaDaRegua,
  ROTULO_MOTIVO,
  ROTULO_STATUS_ENVIO,
  type StatusDoEnvio,
  marcaDoPasso,
  renderizarMensagem,
} from "../../lib/regua";
import { type EnvioComNome, useCancelarEnvio } from "../../hooks/useRegua";

const TOM_STATUS: Record<StatusDoEnvio, string> = {
  pendente: "bg-primary/15 text-primary-soft-foreground",
  enviando: "bg-primary/15 text-primary-soft-foreground",
  enviado: "bg-success/15 text-success-strong",
  falhou: "bg-destructive/15 text-destructive",
  pulado: "bg-muted text-muted-foreground",
  cancelado: "bg-muted text-muted-foreground",
};

function Mensagem({ texto }: { texto: string }) {
  return (
    <div className="mt-2 w-fit max-w-full whitespace-pre-wrap break-words rounded-2xl rounded-tl-md border border-border bg-card px-3 py-2 text-[12.5px] leading-relaxed">
      {texto}
    </div>
  );
}

function LinhaCandidato({ c }: { c: CandidatoDaPrevia }) {
  const [aberta, setAberta] = useState(false);
  const texto = c.mensagem ? renderizarMensagem(c.mensagem, c.variaveis) : null;
  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => texto && setAberta((v) => !v)}
        className={cn("flex w-full items-center gap-3 py-2.5 text-left", texto && "hover:bg-sunken/60")}
        aria-expanded={aberta}
      >
        <span className="grid h-6 min-w-[44px] place-items-center rounded-full bg-sunken px-1.5 text-[11px] font-extrabold tabular-nums">
          {marcaDoPasso(c)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{c.nome}</span>
        {c.status === "pulado" ? (
          <span className="text-xs text-muted-foreground">{ROTULO_MOTIVO[c.motivo ?? ""] ?? "Não envia"}</span>
        ) : (
          <span className="text-xs text-muted-foreground">Mensagem</span>
        )}
        {texto && <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", aberta && "rotate-180")} aria-hidden />}
      </button>
      {aberta && texto && (
        <div className="pb-3 pl-[56px]">
          <Mensagem texto={texto} />
        </div>
      )}
    </li>
  );
}

export function HojeNaRegua({
  previa,
  envios,
  carregandoEnvios,
  podeEditar,
}: {
  previa: PreviaDaRegua | undefined;
  envios: EnvioComNome[];
  carregandoEnvios: boolean;
  podeEditar: boolean;
}) {
  const [aba, setAba] = useState<"proximos" | "enviados">("proximos");
  const [aberto, setAberto] = useState<string | null>(null);
  const cancelar = useCancelarEnvio();
  const candidatos = previa?.candidatos ?? [];
  const vaoSair = candidatos.filter((c) => c.status === "pendente");
  const fila = envios.filter((e) => e.status === "pendente" || e.status === "enviando");
  const historico = envios.filter((e) => e.status !== "pendente" && e.status !== "enviando");

  return (
    <section className="rounded-panel border border-border bg-card p-4 shadow-relevo">
      <header className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-extrabold tracking-[-0.01em]">Hoje na régua</h2>
          <p className="text-xs text-muted-foreground">Atualiza sozinho a cada minuto.</p>
        </div>
        <Tabs value={aba} onValueChange={(v) => setAba(v as typeof aba)}>
          <TabsList variant="segmented" aria-label="Hoje na régua">
            <TabsTrigger value="proximos">
              Próximos <span className="ml-1 tabular-nums opacity-70">{vaoSair.length + fila.length}</span>
            </TabsTrigger>
            <TabsTrigger value="enviados">Enviados</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      {aba === "proximos" ? (
        <div className="mt-3 space-y-4">
          {fila.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">Na fila</p>
              <ul>
                {fila.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 border-b border-border py-2 last:border-b-0">
                    <span className="grid h-6 min-w-[44px] place-items-center rounded-full bg-sunken px-1.5 text-[11px] font-extrabold tabular-nums">
                      {marcaDoPasso(e)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{e.nome}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {new Date(e.agendadoPara) > new Date()
                        ? `a partir de ${new Date(e.agendadoPara).toLocaleString("pt-BR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`
                        : e.status === "enviando" ? "enviando" : "na vez"}
                    </span>
                    {podeEditar && e.status === "pendente" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 rounded-full"
                        aria-label={`Cancelar envio para ${e.nome}`}
                        disabled={cancelar.isPending}
                        onClick={() =>
                          cancelar.mutate(e.id, {
                            onError: (err) =>
                              notifyError(err, {
                                fallback: "Não foi possível cancelar.",
                                message: recusaDaCobranca(err as { code?: string; message?: string }),
                                context: { feature: "cobranca" },
                              }),
                          })
                        }
                      >
                        <X />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
              {previa?.ativa ? "Entram na fila na próxima rodada" : "Sairiam se a régua estivesse ligada"}
            </p>
            {candidatos.length ? (
              <ul>{candidatos.map((c) => <LinhaCandidato key={`${c.casoId}:${c.gatilho}:${c.dias}`} c={c} />)}</ul>
            ) : (
              <p className="py-6 text-center text-xs text-muted-foreground">Ninguém no ponto de receber mensagem agora.</p>
            )}
          </div>
        </div>
      ) : carregandoEnvios ? (
        <div className="grid place-items-center py-8 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : historico.length ? (
        <ul className="mt-3">
          {historico.map((e) => (
            <li key={e.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-sunken/60"
                onClick={() => setAberto((v) => (v === e.id ? null : e.id))}
                aria-expanded={aberto === e.id}
              >
                <span className="grid h-6 min-w-[44px] place-items-center rounded-full bg-sunken px-1.5 text-[11px] font-extrabold tabular-nums">
                  {marcaDoPasso(e)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{e.nome}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", TOM_STATUS[e.status])}>
                  {ROTULO_STATUS_ENVIO[e.status]}
                </span>
                <span className="w-[72px] text-right text-[11px] text-muted-foreground">{haQuantoTempo(e.enviadoEm ?? e.atualizadoEm)}</span>
              </button>
              {aberto === e.id && (
                <div className="pb-3 pl-[56px] text-xs text-muted-foreground">
                  {e.motivo && <p>{ROTULO_MOTIVO[e.motivo] ?? e.motivo}</p>}
                  {e.ultimoErro && <p className="mt-0.5 text-destructive">{e.ultimoErro}</p>}
                  {e.texto && <Mensagem texto={e.texto} />}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-8 text-center text-xs text-muted-foreground">Nada enviado ainda.</p>
      )}
    </section>
  );
}
