import { useState } from "react";
import { motion } from "framer-motion";
import { Check, ListChecks, Pencil, Search, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { FocusCard, FocusTile, InkRow, InkSplit } from "@/components/ui/bento";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  useChecklistItems,
  useChecklists,
  useDeleteChecklist,
  type ChecklistWithCounts,
} from "@/modules/engagement/hooks/useChecklists";
import { ChecklistCard } from "@/modules/engagement/components/checklists/ChecklistCard";
import { CreateChecklistDialog } from "@/modules/engagement/components/checklists/CreateChecklistDialog";

/**
 * V5: a pilha de cartões vira o herói "fila + foco" — templates em tinta à
 * esquerda, o escolhido no ouro com a prévia dos itens. A edição (renomear,
 * itens, excluir) é a MESMA de antes: o `ChecklistCard` abre num diálogo.
 */
export default function ChecklistPage() {
  const { data: checklists = [], isLoading } = useChecklists();
  const [busca, setBusca] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const deleteChecklist = useDeleteChecklist();

  const visiveis = busca.trim()
    ? checklists.filter((c) => c.title.toLowerCase().includes(busca.trim().toLowerCase()))
    : checklists;
  const sel = visiveis.find((c) => c.id === selId) ?? visiveis[0];

  // Sem `p-6`/`max-w-*` próprios: o <main> do layout já dá o respiro da página.
  return (
    <div className="space-y-5">
      <PageHeader
        title="Checklists"
        subtitle="Templates para vincular a leads via card ou automação"
        actions={<CreateChecklistDialog />}
      />

      {isLoading ? (
        <div className="space-y-3" aria-busy="true">
          <span className="sr-only">Carregando checklists...</span>
          <Skeleton className="h-[360px] rounded-panel" />
        </div>
      ) : checklists.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-1.5 rounded-card border border-card-border bg-card px-6 py-14 text-center shadow-relevo"
        >
          <span className="mb-2 grid h-11 w-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
            <ListChecks className="h-5 w-5" />
          </span>
          <h3 className="text-sm font-semibold">Nenhum template ainda</h3>
          <p className="text-[13px] text-muted-foreground">
            Crie seu primeiro template de checklist
          </p>
        </motion.div>
      ) : (
        <>
          <div className="flex justify-end">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Buscar template"
                placeholder="Buscar template"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="rounded-full pl-9"
              />
            </div>
          </div>

          <InkSplit
            title="Templates de Checklist"
            count={`${checklists.length} ${checklists.length === 1 ? "template" : "templates"}`}
            listClassName="max-h-[520px] overflow-y-auto"
            list={
              visiveis.length === 0 ? (
                <p className="px-3 py-6 text-center text-[13px] text-tinta-muted">Nenhum template com esse nome.</p>
              ) : (
                visiveis.map((c) => {
                  const selected = c.id === sel?.id;
                  return (
                    <InkRow key={c.id} selected={selected} onClick={() => setSelId(c.id)}>
                      <span
                        className={cn(
                          "grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px]",
                          selected ? "bg-primary-foreground/10" : "bg-white/10",
                        )}
                        aria-hidden
                      >
                        <ListChecks className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-bold">{c.title}</span>
                        <span className={cn("block truncate text-[11.5px]", selected ? "text-primary-foreground/70" : "text-tinta-muted")}>
                          {c.total_items} {c.total_items === 1 ? "item" : "itens"}
                        </span>
                      </span>
                    </InkRow>
                  );
                })
              )
            }
            detail={
              sel ? (
                <FocoTemplate
                  checklist={sel}
                  onEditar={() => setEditando(true)}
                  onExcluir={() => deleteChecklist.mutate(sel.id)}
                />
              ) : null
            }
          />
        </>
      )}

      <Dialog open={editando && !!sel} onOpenChange={setEditando}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Editar template</DialogTitle>
            <DialogDescription>Renomeie, inclua, edite ou remova itens do template.</DialogDescription>
          </DialogHeader>
          {sel && <ChecklistCard key={sel.id} checklist={sel} defaultExpanded onDeleted={() => setEditando(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FocoTemplate({
  checklist,
  onEditar,
  onExcluir,
}: {
  checklist: ChecklistWithCounts;
  onEditar: () => void;
  onExcluir: () => void;
}) {
  const { data: itens = [], isLoading } = useChecklistItems(checklist.id);
  const concluidos = itens.filter((i) => i.is_completed).length;

  return (
    <FocusCard className="gap-3.5">
      <div>
        <p className="text-[12px] font-bold text-primary-foreground/70">
          Template · {checklist.total_items} {checklist.total_items === 1 ? "item" : "itens"}
        </p>
        <p className="mt-0.5 text-[1.4rem] font-extrabold leading-tight tracking-[-0.035em]">{checklist.title}</p>
        {checklist.description && (
          <p className="mt-1 text-[13px] text-primary-foreground/75">{checklist.description}</p>
        )}
      </div>

      <FocusTile className="space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12.5px] font-bold">Como o time vê no card do Negócio</p>
          <span className="text-[12px] font-bold tabular-nums">
            {concluidos} de {itens.length}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-primary-foreground/15" aria-hidden>
          <div
            className="h-full rounded-full bg-tinta"
            style={{ width: `${itens.length ? (concluidos / itens.length) * 100 : 0}%` }}
          />
        </div>
        {isLoading ? (
          <Skeleton className="h-16 bg-primary-foreground/10" />
        ) : itens.length === 0 ? (
          <p className="text-[12.5px] text-primary-foreground/70">Sem itens ainda — adicione em Editar template.</p>
        ) : (
          <ul className="space-y-1.5" aria-label="Prévia dos itens">
            {itens.slice(0, 8).map((i) => (
              <li key={i.id} className="flex items-center gap-2.5 text-[13px] font-semibold">
                <span
                  className={cn(
                    "grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border-2 border-primary-foreground/50",
                    i.is_completed && "border-tinta bg-tinta text-tinta-foreground",
                  )}
                  aria-hidden
                >
                  {i.is_completed && <Check className="h-3 w-3" />}
                </span>
                <span className={cn("min-w-0 truncate", i.is_completed && "line-through opacity-70")}>{i.title}</span>
              </li>
            ))}
            {itens.length > 8 && (
              <li className="text-[12px] text-primary-foreground/70">e mais {itens.length - 8}</li>
            )}
          </ul>
        )}
      </FocusTile>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <Button
          variant="on-gold"
          onClick={onEditar}
        >
          <Pencil />
          Editar template
        </Button>
        <Button
          variant="outline"
          onClick={onExcluir}
          aria-label="Excluir template"
          className="border-transparent bg-[hsl(40_60%_8%/.1)] text-primary-foreground shadow-none hover:bg-[hsl(40_60%_8%/.16)]"
        >
          <Trash2 />
          Excluir
        </Button>
      </div>
    </FocusCard>
  );
}
