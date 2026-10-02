import { useState, useCallback, useMemo } from "react";
import { Trash2, RotateCcw, Loader2, Search, Check, Hourglass, Inbox, UserRound, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { FocusCard, FocusTile, InkPanel, KpiRow, KpiTile } from "@/components/ui/bento";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useTeamMembers } from "@/modules/identity";
import {
  useTrashLeads,
  useRestoreLead,
  useRestoreLeadsBulk,
  usePurgeLead,
  type TrashLead,
} from "../hooks/useTrashLeads";

/**
 * Lixeira — V5, na composição do mockup.
 *
 * A regra dos 30 dias deixou de ser banner e virou o subtítulo; a tabela diz
 * quanto falta para cada item sumir (barra proporcional) e o painel em tinta à
 * direita põe em foco o que some primeiro. Tudo derivado de `deleted_at` e
 * `deleted_by`, que a RPC `get_trash_leads` já devolvia — nenhum dado novo.
 */

const RETENCAO_DIAS = 30;
const URGENTE_DIAS = 7;

function daysLeft(deletedAt: string): number {
  const passados = Math.floor((Date.now() - new Date(deletedAt).getTime()) / 86_400_000);
  return Math.max(0, RETENCAO_DIAS - passados);
}

function whenLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} · ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

function Checkbox({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
      className={cn(
        "grid size-4 place-items-center rounded-[5px] border-[1.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on ? "border-tinta bg-tinta text-tinta-foreground dark:border-foreground dark:bg-foreground dark:text-background" : "border-border hover:border-foreground/40",
      )}
    >
      {on && <Check className="size-3" aria-hidden />}
    </button>
  );
}

export default function Trash() {
  const { data: leads, isLoading } = useTrashLeads();
  const { data: members = [] } = useTeamMembers();
  const restoreLead = useRestoreLead();
  const restoreBulk = useRestoreLeadsBulk();
  const purgeLead = usePurgeLead();

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [purgeTarget, setPurgeTarget] = useState<string | null>(null);

  /** `deleted_by` é o usuário (auth) — o nome vem do membro da org com esse `user_id`. */
  const nameByUser = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members as { user_id?: string | null; name?: string | null }[]) {
      if (m.user_id && m.name) map.set(m.user_id, m.name);
    }
    return map;
  }, [members]);
  const deletedByName = (lead: TrashLead) => (lead.deleted_by ? nameByUser.get(lead.deleted_by) ?? null : null);

  const all = useMemo(() => leads ?? [], [leads]);
  const filtered = all.filter((l) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      l.name.toLowerCase().includes(q) ||
      l.company?.toLowerCase().includes(q) ||
      l.phone?.includes(q)
    );
  });

  /** Os que somem em até 7 dias, do mais urgente ao menos. */
  const urgentes = useMemo(
    () =>
      all
        .filter((l) => daysLeft(l.deleted_at) <= URGENTE_DIAS)
        .sort((a, b) => new Date(a.deleted_at).getTime() - new Date(b.deleted_at).getTime()),
    [all],
  );
  const primeiro = useMemo(
    () => [...all].sort((a, b) => new Date(a.deleted_at).getTime() - new Date(b.deleted_at).getTime())[0] ?? null,
    [all],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((l) => l.id)));
    }
  }, [filtered, selected.size]);

  const handleRestore = useCallback(async (id: string) => {
    try {
      await restoreLead.mutateAsync(id);
      toast.success("Lead restaurado");
      setSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
    } catch {
      toast.error("Erro ao restaurar");
    }
  }, [restoreLead]);

  const handleRestoreBulk = useCallback(async () => {
    if (!selected.size) return;
    try {
      await restoreBulk.mutateAsync(Array.from(selected));
      toast.success(`${selected.size} leads restaurados`);
      setSelected(new Set());
    } catch {
      toast.error("Erro ao restaurar leads");
    }
  }, [selected, restoreBulk]);

  const confirmPurge = useCallback(async () => {
    if (!purgeTarget) return;
    try {
      await purgeLead.mutateAsync(purgeTarget);
      toast.success("Lead excluído permanentemente");
      setPurgeTarget(null);
    } catch {
      toast.error("Erro ao excluir permanentemente");
    }
  }, [purgeTarget, purgeLead]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Lixeira"
        subtitle="Leads excluídos ficam aqui por 30 dias antes de sumir de vez."
      />

      <KpiRow cols={2}>
        <KpiTile
          label="Itens na lixeira"
          value={isLoading ? "·" : all.length.toLocaleString("pt-BR")}
          loading={isLoading}
          icon={Trash2}
          tone="neutral"
          note={all.length === 1 ? "lead excluído" : "leads excluídos"}
        />
        <KpiTile
          label="Expiram em 7 dias"
          value={isLoading ? "·" : urgentes.length.toLocaleString("pt-BR")}
          loading={isLoading}
          icon={Hourglass}
          tone={urgentes.length > 0 ? "bad" : "good"}
          note={
            primeiro
              ? `o primeiro em ${daysLeft(primeiro.deleted_at)} ${daysLeft(primeiro.deleted_at) === 1 ? "dia" : "dias"}`
              : "nada prestes a sumir"
          }
        />
      </KpiRow>

      <div className="flex justify-end">
        <div className="relative w-full sm:w-[260px]">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar na lixeira…"
            aria-label="Buscar na lixeira"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-[38px] rounded-full pl-10 shadow-relevo"
          />
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {isLoading ? (
          <div className="flex items-center justify-center rounded-card border border-card-border bg-card py-24 shadow-relevo">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !filtered.length ? (
          <div className="flex flex-col items-center justify-center rounded-card border border-card-border bg-card py-24 text-muted-foreground shadow-relevo">
            <Trash2 className="mb-3 h-10 w-10 opacity-40" />
            <p className="text-sm">{search ? "Nada na lixeira com essa busca" : "Lixeira vazia"}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-card border border-card-border bg-card shadow-relevo">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10 pl-4">
                      <Checkbox on={selected.size > 0 && selected.size === filtered.length} label="Selecionar todos" onClick={toggleAll} />
                    </TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead className="max-md:hidden">Excluído por</TableHead>
                    <TableHead className="max-md:hidden">Quando</TableHead>
                    <TableHead className="max-sm:hidden">Expira em</TableHead>
                    <TableHead className="pr-4 text-right sm:w-40">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((lead) => {
                    const restam = daysLeft(lead.deleted_at);
                    const urgente = restam <= URGENTE_DIAS;
                    const quem = deletedByName(lead);
                    return (
                      <TableRow key={lead.id} className={cn(selected.has(lead.id) && "bg-primary-soft/60 hover:bg-primary-soft")}>
                        <TableCell className="pl-4">
                          <Checkbox on={selected.has(lead.id)} label={`Selecionar ${lead.name}`} onClick={() => toggleSelect(lead.id)} />
                        </TableCell>
                        <TableCell>
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-muted text-muted-foreground max-sm:hidden">
                              <UserRound className="size-4" aria-hidden />
                            </span>
                            <div className="min-w-0 leading-tight">
                              <p className="max-w-[150px] truncate text-[13px] font-bold sm:max-w-[260px]">{lead.name}</p>
                              <p className="max-w-[150px] truncate text-[11px] text-muted-foreground sm:max-w-[260px]">
                                {["Lead", lead.company].filter(Boolean).join(" · ")}
                              </p>
                              {/* No celular a coluna "Expira em" some — o prazo vem aqui. */}
                              <p className={cn("text-[11px] font-semibold tabular-nums sm:hidden", urgente ? "text-destructive" : "text-muted-foreground")}>
                                expira em {restam} {restam === 1 ? "dia" : "dias"}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="max-md:hidden">
                          {quem ? (
                            <span className="inline-flex items-center gap-2 text-[13px]">
                              <UserAvatar name={quem} size="xs" />
                              <span className="max-w-[140px] truncate">{quem}</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </TableCell>
                        <TableCell className="max-md:hidden whitespace-nowrap text-[13px] tabular-nums text-muted-foreground">
                          {whenLabel(lead.deleted_at)}
                        </TableCell>
                        <TableCell className="max-sm:hidden">
                          <div className="w-[96px]">
                            <p className={cn("text-[13px] font-bold tabular-nums", urgente && "text-destructive")}>
                              {restam} {restam === 1 ? "dia" : "dias"}
                            </p>
                            <div className="mt-1 h-[5px] overflow-hidden rounded-full bg-muted">
                              <div
                                className={cn("h-full rounded-full", urgente ? "bg-destructive" : "bg-foreground/40")}
                                style={{ width: `${Math.max(4, (restam / RETENCAO_DIAS) * 100)}%` }}
                              />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="pr-4">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 rounded-full bg-muted text-xs hover:bg-muted/70 max-sm:w-8 max-sm:px-0"
                              onClick={() => handleRestore(lead.id)}
                              disabled={restoreLead.isPending}
                              aria-label={`Restaurar ${lead.name}`}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              <span className="max-sm:sr-only">Restaurar</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 px-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => setPurgeTarget(lead.id)}
                              aria-label={`Excluir ${lead.name} permanentemente`}
                              title="Excluir permanentemente"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-[13px] text-muted-foreground">
              <span className="tabular-nums">
                Mostrando {filtered.length.toLocaleString("pt-BR")} de {all.length.toLocaleString("pt-BR")}
              </span>
              <span>Depois de 30 dias o item é excluído de vez, sem volta.</span>
            </div>
          </div>
        )}

        {/* Prestes a sumir — tinta + ouro, o que expira primeiro em foco */}
        <InkPanel
          title="Prestes a sumir"
          count={`${urgentes.length} em 7 dias`}
          className="lg:sticky lg:top-4"
        >
          {urgentes.length === 0 ? (
            <p className="px-1.5 pb-2 text-[13px] text-tinta-muted">
              Nada expira nos próximos 7 dias.
            </p>
          ) : (
            <div className="space-y-2.5">
              {(() => {
                const foco = urgentes[0];
                const restam = daysLeft(foco.deleted_at);
                const quem = deletedByName(foco);
                return (
                  <FocusCard className="gap-3 p-[18px]">
                    <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary-foreground px-2.5 py-1 text-[11px] font-bold text-primary">
                      <Hourglass className="size-3" aria-hidden />
                      Expira em {restam} {restam === 1 ? "dia" : "dias"}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[1.3rem] font-extrabold leading-tight tracking-[-0.03em]">{foco.name}</p>
                      {foco.company && <p className="truncate text-[12px] font-semibold text-primary-foreground/70">{foco.company}</p>}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <FocusTile className="px-3 py-2.5">
                        <p className="text-[11px] font-bold text-primary-foreground/70">Excluído por</p>
                        <p className="truncate text-[13px] font-extrabold">{quem ?? "—"}</p>
                      </FocusTile>
                      <FocusTile className="px-3 py-2.5">
                        <p className="text-[11px] font-bold text-primary-foreground/70">Quando</p>
                        <p className="truncate text-[13px] font-extrabold tabular-nums">{whenLabel(foco.deleted_at)}</p>
                      </FocusTile>
                    </div>
                    <Button
                      className="w-full border-transparent bg-white text-neutral-900 shadow-none hover:bg-white/90"
                      onClick={() => handleRestore(foco.id)}
                      disabled={restoreLead.isPending}
                    >
                      <RotateCcw />
                      Restaurar agora
                    </Button>
                  </FocusCard>
                );
              })()}
              {urgentes.slice(1, 6).map((lead) => {
                const restam = daysLeft(lead.deleted_at);
                return (
                  <div key={lead.id} className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[.05] px-3 py-2.5">
                    <div className="min-w-0 flex-1 leading-tight">
                      <p className="truncate text-[13px] font-bold text-tinta-foreground">{lead.name}</p>
                      <p className="text-[11px] tabular-nums text-destructive">
                        expira em {restam} {restam === 1 ? "dia" : "dias"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 shrink-0 rounded-full border border-white/10 bg-white/[.06] text-[12px] text-tinta-foreground hover:bg-white/10 hover:text-tinta-foreground"
                      onClick={() => handleRestore(lead.id)}
                      disabled={restoreLead.isPending}
                    >
                      Restaurar
                    </Button>
                  </div>
                );
              })}
              <p className="flex items-center gap-1.5 px-1 pt-1 text-[11px] text-tinta-muted">
                <Inbox className="size-3.5 shrink-0" aria-hidden />
                Ao restaurar, o lead volta com o histórico que tinha.
              </p>
            </div>
          )}
        </InkPanel>
      </div>

      {/* Seleção → pílula tinta flutuante */}
      {selected.size > 0 && (
        <div className="pointer-events-none sticky bottom-4 z-20 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-tinta py-2 pl-4 pr-2 text-tinta-foreground shadow-relevo-tinta">
            <b className="text-[13px] tabular-nums">
              {selected.size} {selected.size === 1 ? "selecionado" : "selecionados"}
            </b>
            <span aria-hidden className="mx-1 h-5 w-px bg-tinta-line" />
            <Button size="sm" onClick={handleRestoreBulk} disabled={restoreBulk.isPending}>
              {restoreBulk.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
              Restaurar {selected.size}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-tinta-foreground hover:bg-white/10 hover:text-tinta-foreground"
              onClick={() => setSelected(new Set())}
            >
              <X />
              Limpar
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={!!purgeTarget} onOpenChange={(o) => !o && setPurgeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir permanentemente</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O lead e todos os dados associados serão removidos permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmPurge}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {purgeLead.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Excluir permanentemente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
