/**
 * Lembretes antes de promessa ou parcela (D-N). Enquanto há compromisso, as
 * colunas de atraso não andam; só o lembrete sai. Parcela vencida e não paga
 * quebra o compromisso e o card volta para a coluna do atraso.
 */
import { CalendarClock, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
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
import { type PassoDaRegua, marcaDoPasso, renderizarMensagem, rotuloDoPasso, variaveisDeExemplo } from "../../lib/regua";
import { useRemoverPasso, useSalvarPasso } from "../../hooks/useRegua";
import { ConfirmarDialog } from "../dialogos";
import { PassoDialog } from "./PassoDialog";

export function PassosDaRegua({
  passos,
  comoPagar,
  empresa,
  podeEditar,
}: {
  passos: PassoDaRegua[];
  comoPagar: string | null;
  empresa?: string;
  podeEditar: boolean;
}) {
  const [editando, setEditando] = useState<{ passo: PassoDaRegua | null } | null>(null);
  const [removendo, setRemovendo] = useState<PassoDaRegua | null>(null);
  const salvar = useSalvarPasso();
  const remover = useRemoverPasso();
  const exemplo = variaveisDeExemplo(comoPagar, empresa);
  const lembretes = passos.filter((p) => p.gatilho === "lembrete_compromisso").sort((a, b) => b.dias - a.dias);

  const alternar = (p: PassoDaRegua, ativo: boolean) =>
    salvar.mutate(
      { id: p.id, dias: p.dias, mensagem: p.mensagem, ativo },
      {
        onError: (err) =>
          notifyError(err, {
            fallback: "Não foi possível alterar o lembrete.",
            message: recusaDaCobranca(err as { code?: string; message?: string }),
            context: { feature: "cobranca" },
          }),
      },
    );

  const linha = (p: PassoDaRegua, ultimo: boolean) => {
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
                    <Button variant="ghost" size="icon" className="size-8 rounded-full" aria-label="Ações do lembrete">
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditando({ passo: p })}>
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
          {texto && <p className="mt-2 line-clamp-3 whitespace-pre-line text-[12.5px] leading-relaxed text-muted-foreground">{texto}</p>}
        </div>
      </li>
    );
  };

  return (
    <section className="rounded-panel border border-border bg-sunken/60 p-4">
      <header className="mb-3 flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-1.5 text-sm font-extrabold tracking-[-0.01em]">
            <CalendarClock className="size-3.5 text-muted-foreground" aria-hidden />
            Antes de promessa ou parcela
          </h2>
          <p className="text-xs text-muted-foreground">
            Enquanto há promessa ou acordo, as colunas de atraso param; só o lembrete sai. Parcela vencida e não paga
            quebra o compromisso e o card volta para a coluna do atraso.
          </p>
        </div>
        {podeEditar && (
          <Button size="sm" variant="outline" className="rounded-full" onClick={() => setEditando({ passo: null })}>
            <Plus /> Lembrete
          </Button>
        )}
      </header>
      {lembretes.length ? (
        <ol>{lembretes.map((p, i) => linha(p, i === lembretes.length - 1))}</ol>
      ) : (
        <p className="py-4 text-center text-xs text-muted-foreground">Nenhum lembrete.</p>
      )}

      <PassoDialog
        aberto={!!editando}
        onFechar={() => setEditando(null)}
        passo={editando?.passo ?? null}
        comoPagar={comoPagar}
        empresa={empresa}
      />
      <ConfirmarDialog
        aberto={!!removendo}
        onFechar={() => setRemovendo(null)}
        titulo="Remover este lembrete?"
        descricao="Envios dele que ainda estão na fila são cancelados. O que já saiu fica no histórico."
        rotuloConfirmar="Remover lembrete"
        perigoso
        confirmando={remover.isPending}
        onConfirmar={() =>
          removendo &&
          remover.mutate(removendo.id, {
            onSuccess: () => setRemovendo(null),
            onError: (err) =>
              notifyError(err, {
                fallback: "Não foi possível remover o lembrete.",
                message: recusaDaCobranca(err as { code?: string; message?: string }),
                context: { feature: "cobranca" },
              }),
          })
        }
      />
    </section>
  );
}
