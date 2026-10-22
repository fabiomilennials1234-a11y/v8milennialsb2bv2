/**
 * Os passos da régua como linha do tempo: o que acontece em cada dia de
 * atraso, e o lembrete antes de promessa/parcela. Cada passo mostra o texto
 * como o devedor vai ler (dados de exemplo) e a mudança de etapa.
 */
import { ArrowRight, CalendarClock, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

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
import {
  type Gatilho,
  type PassoDaRegua,
  marcaDoPasso,
  renderizarMensagem,
  rotuloDoPasso,
  variaveisDeExemplo,
} from "../../lib/regua";
import type { Etapa } from "../../lib/tipos";
import { useRemoverPasso, useSalvarPasso } from "../../hooks/useRegua";
import { EtapaPill } from "../atomos";
import { ConfirmarDialog } from "../dialogos";
import { PassoDialog } from "./PassoDialog";

export function PassosDaRegua({
  passos,
  etapas,
  comoPagar,
  empresa,
  podeEditar,
}: {
  passos: PassoDaRegua[];
  etapas: Etapa[];
  comoPagar: string | null;
  empresa?: string;
  podeEditar: boolean;
}) {
  const [editando, setEditando] = useState<{ passo: PassoDaRegua | null; gatilho: Gatilho } | null>(null);
  const [removendo, setRemovendo] = useState<PassoDaRegua | null>(null);
  const salvar = useSalvarPasso();
  const remover = useRemoverPasso();
  const exemplo = variaveisDeExemplo(comoPagar, empresa);
  const etapaPor = new Map(etapas.map((e) => [e.id, e]));

  const atraso = passos.filter((p) => p.gatilho === "atraso").sort((a, b) => a.dias - b.dias);
  const lembretes = passos.filter((p) => p.gatilho === "lembrete_compromisso").sort((a, b) => b.dias - a.dias);

  const alternar = (p: PassoDaRegua, ativo: boolean) =>
    salvar.mutate(
      { id: p.id, gatilho: p.gatilho, dias: p.dias, mensagem: p.mensagem, moverParaEtapaId: p.moverParaEtapaId, ativo },
      {
        onError: (err) =>
          notifyError(err, {
            fallback: "Não foi possível alterar o passo.",
            message: recusaDaCobranca(err as { code?: string; message?: string }),
            context: { feature: "cobranca" },
          }),
      },
    );

  const linha = (p: PassoDaRegua, ultimo: boolean) => {
    const destino = p.moverParaEtapaId ? etapaPor.get(p.moverParaEtapaId) : undefined;
    const texto = p.mensagem ? renderizarMensagem(p.mensagem, exemplo) : null;
    return (
      <li key={p.id} className="relative grid grid-cols-[52px_minmax(0,1fr)] gap-3">
        <div className="relative flex justify-center">
          <span
            className={cn(
              "z-10 grid h-8 min-w-[52px] place-items-center rounded-full px-2 text-[12px] font-extrabold tabular-nums",
              p.ativo ? "bg-tinta text-tinta-foreground shadow-relevo-tinta" : "border border-dashed border-border bg-card text-muted-foreground",
            )}
          >
            {marcaDoPasso(p)}
          </span>
          {!ultimo && <span aria-hidden className="absolute bottom-[-18px] top-8 w-px bg-border" />}
        </div>
        <div
          className={cn(
            "mb-3 min-w-0 rounded-[18px] border border-border bg-card p-3.5 shadow-relevo transition-opacity",
            !p.ativo && "opacity-60",
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-bold">{rotuloDoPasso(p)}</p>
            {destino && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <ArrowRight className="size-3" aria-hidden />
                <EtapaPill nome={destino.nome} cor={destino.cor} />
              </span>
            )}
            <span className="flex-1" />
            {podeEditar && (
              <>
                <Switch
                  checked={p.ativo}
                  onCheckedChange={(v) => alternar(p, v)}
                  aria-label={p.ativo ? `Desligar ${rotuloDoPasso(p)}` : `Ligar ${rotuloDoPasso(p)}`}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8 rounded-full" aria-label="Ações do passo">
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditando({ passo: p, gatilho: p.gatilho })}>
                      <Pencil className="mr-2 size-3.5" /> Editar
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive" onSelect={() => setRemovendo(p)}>
                      <Trash2 className="mr-2 size-3.5" /> Remover
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
          {texto ? (
            <p className="mt-2 line-clamp-3 whitespace-pre-line text-[12.5px] leading-relaxed text-muted-foreground">{texto}</p>
          ) : (
            <p className="mt-2 text-[12.5px] text-muted-foreground">Sem mensagem: só muda a etapa.</p>
          )}
        </div>
      </li>
    );
  };

  const grupo = (titulo: string, descricao: string, lista: PassoDaRegua[], gatilho: Gatilho, icone?: ReactNode) => (
    <section className="rounded-panel border border-border bg-sunken/60 p-4">
      <header className="mb-3 flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-1.5 text-sm font-extrabold tracking-[-0.01em]">
            {icone}
            {titulo}
          </h2>
          <p className="text-xs text-muted-foreground">{descricao}</p>
        </div>
        {podeEditar && (
          <Button size="sm" variant="outline" className="rounded-full" onClick={() => setEditando({ passo: null, gatilho })}>
            <Plus /> Passo
          </Button>
        )}
      </header>
      {lista.length ? (
        <ol>{lista.map((p, i) => linha(p, i === lista.length - 1))}</ol>
      ) : (
        <p className="py-4 text-center text-xs text-muted-foreground">Nenhum passo.</p>
      )}
    </section>
  );

  return (
    <div className="space-y-4">
      {grupo(
        "Depois do vencimento",
        "Conta do vencimento mais antigo em aberto. Quem entra atrasado recebe só o passo do dia em que está — nunca a régua inteira.",
        atraso,
        "atraso",
      )}
      {grupo(
        "Antes de promessa ou parcela",
        "Enquanto há promessa ou acordo, a régua de atraso para; só o lembrete sai. Parcela vencida e não paga quebra o compromisso.",
        lembretes,
        "lembrete_compromisso",
        <CalendarClock className="size-3.5 text-muted-foreground" aria-hidden />,
      )}

      <PassoDialog
        aberto={!!editando}
        onFechar={() => setEditando(null)}
        passo={editando?.passo ?? null}
        gatilhoInicial={editando?.gatilho}
        etapas={etapas}
        comoPagar={comoPagar}
        empresa={empresa}
      />
      <ConfirmarDialog
        aberto={!!removendo}
        onFechar={() => setRemovendo(null)}
        titulo="Remover este passo?"
        descricao="Envios dele que ainda estão na fila são cancelados. O que já saiu fica no histórico."
        rotuloConfirmar="Remover passo"
        perigoso
        confirmando={remover.isPending}
        onConfirmar={() =>
          removendo &&
          remover.mutate(removendo.id, {
            onSuccess: () => setRemovendo(null),
            onError: (err) =>
              notifyError(err, {
                fallback: "Não foi possível remover o passo.",
                message: recusaDaCobranca(err as { code?: string; message?: string }),
                context: { feature: "cobranca" },
              }),
          })
        }
      />
    </div>
  );
}
