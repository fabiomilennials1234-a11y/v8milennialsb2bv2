/**
 * As colunas do Fluxo de Cobrança como linha do tempo da régua: em que dia de
 * atraso o caso entra sozinho em cada uma e o que o devedor lê quando entra.
 * É o mesmo quadro do Fluxo, na mesma ordem — editar aqui muda lá.
 *
 * Coluna de dias: entra sozinho (liga/desliga) e manda a mensagem dela.
 * Coluna que pausa a régua ou de entrada: a mensagem só sai à mão ("Mover e
 * enviar" no Fluxo), a não ser que ganhe dias (Jurídico entra com 60).
 */
import { Hand, MoreHorizontal, Pause, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { notifyError } from "@/shared/errors";
import { cn } from "@/lib/utils";

import { recusaDaCobranca } from "../../lib/erros";
import { marcaDoPasso, renderizarMensagem, rotuloDaEntrada, tipoDaColuna, variaveisDeExemplo } from "../../lib/regua";
import type { Etapa } from "../../lib/tipos";
import { useRemoverColuna, useSalvarColuna } from "../../hooks/useRegua";
import { EtapaPill } from "../atomos";
import { ConfirmarDialog } from "../dialogos";
import { ColunaDialog } from "./ColunaDialog";

export function ColunasDaRegua({
  etapas,
  comoPagar,
  empresa,
  podeEditar,
}: {
  etapas: Etapa[];
  comoPagar: string | null;
  empresa?: string;
  podeEditar: boolean;
}) {
  const [editando, setEditando] = useState<{ coluna: Etapa | null } | null>(null);
  const [removendo, setRemovendo] = useState<Etapa | null>(null);
  const salvar = useSalvarColuna();
  const remover = useRemoverColuna();
  const abertas = etapas.filter((e) => e.papel === "aberta").sort((a, b) => a.posicao - b.posicao);

  const alternar = (e: Etapa, ativa: boolean) =>
    salvar.mutate(
      { id: e.id, automacaoAtiva: ativa },
      {
        onError: (err) =>
          notifyError(err, {
            fallback: "Não foi possível alterar a coluna.",
            message: recusaDaCobranca(err as { code?: string; message?: string }),
            context: { feature: "cobranca" },
          }),
      },
    );

  const linha = (e: Etapa, ultimo: boolean) => {
    const tipo = tipoDaColuna(e);
    const automatica = e.entradaDias !== null;
    const ligada = automatica && e.automacaoAtiva;
    const exemplo = variaveisDeExemplo(comoPagar, empresa, e.entradaDias ?? undefined);
    const texto = e.mensagem ? renderizarMensagem(e.mensagem, exemplo) : null;
    return (
      <li key={e.id} className="relative grid grid-cols-[52px_minmax(0,1fr)] gap-3">
        <div className="relative flex justify-center">
          <span
            title={automatica ? rotuloDaEntrada(e.entradaDias as number) : tipo === "pausa" ? "Pausa a régua" : "Toda dívida começa aqui"}
            className={cn(
              "z-10 grid h-8 min-w-[52px] place-items-center rounded-full px-2 text-[12px] font-extrabold tabular-nums",
              ligada
                ? "bg-tinta text-tinta-foreground shadow-relevo-tinta"
                : "border border-dashed border-border bg-card text-muted-foreground",
            )}
          >
            {automatica ? (
              marcaDoPasso({ gatilho: "atraso", dias: e.entradaDias as number })
            ) : tipo === "pausa" ? (
              <Pause className="size-3.5" aria-label="Pausa a régua" />
            ) : (
              "D0"
            )}
          </span>
          {!ultimo && <span aria-hidden className="absolute bottom-[-18px] top-8 w-px bg-border" />}
        </div>
        <div
          className={cn(
            "mb-3 min-w-0 rounded-[18px] border border-border bg-card p-3.5 shadow-relevo transition-opacity",
            automatica && !e.automacaoAtiva && "opacity-60",
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <EtapaPill nome={e.nome} cor={e.cor} className="bg-card" />
            {tipo === "pausa" && <span className="text-xs text-muted-foreground">pausa a régua</span>}
            <span className="flex-1" />
            {podeEditar && (
              <>
                {automatica && (
                  <Switch
                    checked={e.automacaoAtiva}
                    onCheckedChange={(v) => alternar(e, v)}
                    aria-label={e.automacaoAtiva ? `Desligar a entrada automática em ${e.nome}` : `Ligar a entrada automática em ${e.nome}`}
                  />
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8 rounded-full" aria-label={`Ações de ${e.nome}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditando({ coluna: e })}>
                      <Pencil className="mr-2 size-3.5" /> Editar
                    </DropdownMenuItem>
                    {tipo === "dias" && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onSelect={() => setRemovendo(e)}>
                          <Trash2 className="mr-2 size-3.5" /> Remover
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {automatica
              ? e.automacaoAtiva
                ? `${rotuloDaEntrada(e.entradaDias as number)}${texto ? " e recebe a mensagem" : ""}.`
                : "Entrada automática desligada: só entra à mão."
              : tipo === "pausa"
                ? "A régua não move nem manda nada sozinha aqui."
                : "Toda dívida nova começa aqui."}
          </p>
          {texto ? (
            <>
              <p className="mt-2 line-clamp-3 whitespace-pre-line text-[12.5px] leading-relaxed text-muted-foreground">{texto}</p>
              {!automatica && (
                <p className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-muted-foreground">
                  <Hand className="size-3" aria-hidden />
                  Sai só quando alguém move o card para cá e escolhe enviar.
                </p>
              )}
            </>
          ) : (
            <p className="mt-2 text-[12.5px] text-muted-foreground/80">Sem mensagem: só recebe o card.</p>
          )}
        </div>
      </li>
    );
  };

  return (
    <section className="rounded-panel border border-border bg-sunken/60 p-4">
      <header className="mb-3 flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-extrabold tracking-[-0.01em]">Colunas do fluxo</h2>
          <p className="text-xs text-muted-foreground">
            Conta do vencimento mais antigo em aberto. O caso entra sozinho só para a frente, uma vez por dívida — quem
            chega atrasado cai direto na coluna do dia em que está, nunca recebe a régua inteira.
          </p>
        </div>
        {podeEditar && (
          <Button size="sm" variant="outline" className="rounded-full" onClick={() => setEditando({ coluna: null })}>
            <Plus /> Coluna
          </Button>
        )}
      </header>
      {abertas.length ? (
        <ol>{abertas.map((e, i) => linha(e, i === abertas.length - 1))}</ol>
      ) : (
        <p className="py-4 text-center text-xs text-muted-foreground">Nenhuma coluna.</p>
      )}

      <ColunaDialog
        aberto={!!editando}
        onFechar={() => setEditando(null)}
        coluna={editando?.coluna ?? null}
        comoPagar={comoPagar}
        empresa={empresa}
      />
      <ConfirmarDialog
        aberto={!!removendo}
        onFechar={() => setRemovendo(null)}
        titulo={`Remover “${removendo?.nome ?? ""}”?`}
        descricao="A coluna precisa estar vazia. Envios dela que ainda estão na fila são cancelados; o que já saiu fica no histórico."
        rotuloConfirmar="Remover coluna"
        perigoso
        confirmando={remover.isPending}
        onConfirmar={() =>
          removendo &&
          remover.mutate(removendo.id, {
            onSuccess: () => setRemovendo(null),
            onError: (err) =>
              notifyError(err, {
                fallback: "Não foi possível remover a coluna.",
                message: recusaDaCobranca(err as { code?: string; message?: string }),
                context: { feature: "cobranca" },
              }),
          })
        }
      />
    </section>
  );
}
