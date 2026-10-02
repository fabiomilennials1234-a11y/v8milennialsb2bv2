import { useState, useCallback } from "react";
import {
  Trash2,
  RotateCcw,
  AlertTriangle,
  Loader2,
  Search,
  Phone,
  Mail,
  Building2,
  CheckSquare,
  Square,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useTrashLeads,
  useRestoreLead,
  useRestoreLeadsBulk,
  usePurgeLead,
} from "../hooks/useTrashLeads";

export default function Trash() {
  const { data: leads, isLoading } = useTrashLeads();
  const restoreLead = useRestoreLead();
  const restoreBulk = useRestoreLeadsBulk();
  const purgeLead = usePurgeLead();

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [purgeTarget, setPurgeTarget] = useState<string | null>(null);

  const filtered = leads?.filter((l) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      l.name.toLowerCase().includes(q) ||
      l.company?.toLowerCase().includes(q) ||
      l.phone?.includes(q)
    );
  }) ?? [];

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

  const daysAgo = (iso: string) => {
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (d === 0) return "hoje";
    if (d === 1) return "ontem";
    return `há ${d} dias`;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Lixeira"
        subtitle={
          leads
            ? `${leads.length.toLocaleString("pt-BR")} ${leads.length === 1 ? "lead excluído" : "leads excluídos"}`
            : "Leads excluídos"
        }
        actions={
          <>
            <div className="relative w-64 max-sm:w-full">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar na lixeira…"
                aria-label="Buscar na lixeira"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            {selected.size > 0 && (
              <Button variant="outline" onClick={handleRestoreBulk} disabled={restoreBulk.isPending}>
                {restoreBulk.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                Restaurar {selected.size}
              </Button>
            )}
          </>
        }
      />

      <div className="flex items-center gap-2.5 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-strong">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Leads na lixeira são excluídos permanentemente após 30 dias.
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !filtered.length ? (
        <div className="flex flex-col items-center justify-center rounded-card border border-card-border bg-card py-24 text-muted-foreground shadow-relevo">
          <Trash2 className="mb-3 h-10 w-10 opacity-40" />
          <p className="text-sm">{search ? "Nada na lixeira com essa busca" : "Lixeira vazia"}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-card-border bg-card shadow-relevo">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <button
                    type="button"
                    onClick={toggleAll}
                    aria-label="Selecionar todos"
                    className="rounded-md p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {selected.size === filtered.length ? (
                      <CheckSquare className="h-4 w-4 text-primary" />
                    ) : (
                      <Square className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                </TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Excluído</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => toggleSelect(lead.id)}
                      aria-label={`Selecionar ${lead.name}`}
                      className="rounded-md p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {selected.has(lead.id) ? (
                        <CheckSquare className="h-4 w-4 text-primary" />
                      ) : (
                        <Square className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                  </TableCell>
                  <TableCell className="font-medium">{lead.name}</TableCell>
                  <TableCell>
                    {lead.company ? (
                      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                        <Building2 className="h-3.5 w-3.5" />
                        {lead.company}
                      </span>
                    ) : <span className="text-muted-foreground/60">—</span>}
                  </TableCell>
                  <TableCell>
                    {lead.phone ? (
                      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                        <Phone className="h-3.5 w-3.5" />
                        {lead.phone}
                      </span>
                    ) : <span className="text-muted-foreground/60">—</span>}
                  </TableCell>
                  <TableCell>
                    {lead.email ? (
                      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                        <Mail className="h-3.5 w-3.5" />
                        {lead.email}
                      </span>
                    ) : <span className="text-muted-foreground/60">—</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {daysAgo(lead.deleted_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs"
                        onClick={() => handleRestore(lead.id)}
                        disabled={restoreLead.isPending}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Restaurar
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
              ))}
            </TableBody>
          </Table>
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
