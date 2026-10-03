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
import { Badge } from "@/components/ui/badge";
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
      toast.success("Lead excluido permanentemente");
      setPurgeTarget(null);
    } catch {
      toast.error("Erro ao excluir permanentemente");
    }
  }, [purgeTarget, purgeLead]);

  const daysAgo = (iso: string) => {
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (d === 0) return "hoje";
    if (d === 1) return "ontem";
    return `${d}d atras`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Trash2 className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">Lixeira</h1>
          {leads && (
            <Badge variant="secondary" className="tabular-nums">{leads.length}</Badge>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar na lixeira..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {selected.size > 0 && (
            <Button size="sm" variant="outline" onClick={handleRestoreBulk} disabled={restoreBulk.isPending}>
              {restoreBulk.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              <RotateCcw className="mr-1.5 h-4 w-4" />
              Restaurar {selected.size}
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-amber-500/5 p-3 flex items-center gap-2 text-sm text-amber-600">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Leads na lixeira sao excluidos permanentemente apos 30 dias.
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !filtered.length ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <Trash2 className="mb-3 h-10 w-10 opacity-40" />
          <p className="text-sm">Lixeira vazia</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <button onClick={toggleAll} className="p-1">
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
                <TableHead>Excluido</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell>
                    <button onClick={() => toggleSelect(lead.id)} className="p-1">
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
                    ) : "--"}
                  </TableCell>
                  <TableCell>
                    {lead.phone ? (
                      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                        <Phone className="h-3.5 w-3.5" />
                        {lead.phone}
                      </span>
                    ) : "--"}
                  </TableCell>
                  <TableCell>
                    {lead.email ? (
                      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                        <Mail className="h-3.5 w-3.5" />
                        {lead.email}
                      </span>
                    ) : "--"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {daysAgo(lead.deleted_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => handleRestore(lead.id)}
                        disabled={restoreLead.isPending}
                      >
                        <RotateCcw className="mr-1 h-3.5 w-3.5" />
                        Restaurar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-destructive hover:text-destructive"
                        onClick={() => setPurgeTarget(lead.id)}
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
              Esta acao nao pode ser desfeita. O lead e todos os dados associados serao removidos permanentemente.
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
