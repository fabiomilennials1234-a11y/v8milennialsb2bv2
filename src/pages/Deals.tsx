import { useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  Handshake, Plus, Search, DollarSign, Building2, Calendar,
  Loader2, MoreHorizontal, Pencil, Trash2, TrendingUp, TrendingDown,
  Clock, CheckCircle2, XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import { useDeals, useCreateDeal, useUpdateDeal, useDeleteDeal, Deal, DealInsert } from "@/hooks/useDeals";
import { useCompanies } from "@/hooks/useCompanies";
import { useAuth } from "@/contexts/AuthContext";
import { DealDetailDrawer } from "@/components/deals/DealDetailDrawer";

// ── Helpers ───────────────────────────────────────────────────────────────

const formatBRL = (value: number | null) =>
  value != null
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value)
    : "---";

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR") : "---";

const isThisMonth = (iso: string | null) => {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
};

// ── Schema ────────────────────────────────────────────────────────────────

const dealSchema = z.object({
  title: z.string().min(1, "Titulo obrigatorio"),
  value: z.coerce.number().min(0).nullable().default(null),
  company_id: z.string().nullable().default(null),
  probability: z.coerce.number().min(0).max(100).nullable().default(null),
  expected_close_date: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
});

type DealFormValues = z.infer<typeof dealSchema>;

// ── Component ─────────────────────────────────────────────────────────────

export default function Deals() {
  const { user } = useAuth();
  const { data: deals = [], isLoading } = useDeals();
  const { data: companies = [] } = useCompanies();
  const createDeal = useCreateDeal();
  const updateDeal = useUpdateDeal();
  const deleteDeal = useDeleteDeal();

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("todos");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Deal | null>(null);
  const [detailId, setDetailId] = useState<string | undefined>();

  const form = useForm<DealFormValues>({
    resolver: zodResolver(dealSchema),
    defaultValues: { title: "", value: null, company_id: null, probability: null, expected_close_date: null, notes: null },
  });

  // ── Metrics ───────────────────────────────────────────────────────────

  const metrics = useMemo(() => {
    const open = deals.filter((d) => d.won === null);
    const wonMonth = deals.filter((d) => d.won === true && isThisMonth(d.closed_at));
    const lostMonth = deals.filter((d) => d.won === false && isThisMonth(d.closed_at));
    return {
      openCount: open.length,
      openValue: open.reduce((s, d) => s + (d.value ?? 0), 0),
      wonMonth: wonMonth.length,
      lostMonth: lostMonth.length,
    };
  }, [deals]);

  // ── Filtered list ─────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let list = deals;
    if (tab === "abertos") list = list.filter((d) => d.won === null);
    else if (tab === "ganhos") list = list.filter((d) => d.won === true);
    else if (tab === "perdidos") list = list.filter((d) => d.won === false);

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((d) => {
        const company = companies.find((c) => c.id === d.company_id);
        return (
          d.title.toLowerCase().includes(q) ||
          company?.name.toLowerCase().includes(q)
        );
      });
    }
    return list;
  }, [deals, companies, tab, search]);

  // ── Sheet helpers ─────────────────────────────────────────────────────

  function openCreate() {
    setEditingDeal(null);
    form.reset({ title: "", value: null, company_id: null, probability: null, expected_close_date: null, notes: null });
    setSheetOpen(true);
  }

  function openEdit(deal: Deal) {
    setEditingDeal(deal);
    form.reset({
      title: deal.title,
      value: deal.value,
      company_id: deal.company_id,
      probability: deal.probability,
      expected_close_date: deal.expected_close_date,
      notes: deal.notes,
    });
    setSheetOpen(true);
  }

  async function onSubmit(values: DealFormValues) {
    try {
      if (editingDeal) {
        await updateDeal.mutateAsync({ id: editingDeal.id, ...values });
        toast.success("Negocio atualizado");
      } else {
        const insert: DealInsert = {
          title: values.title,
          value: values.value,
          company_id: values.company_id,
          probability: values.probability,
          expected_close_date: values.expected_close_date,
          notes: values.notes,
          currency: "BRL",
          pipeline_id: null,
          stage_id: null,
          owner_id: null,
          source_lead_id: null,
          closed_at: null,
          won: null,
          loss_reason: null,
          loss_reason_id: null,
          metadata: {},
          created_by: user?.id ?? null,
        };
        await createDeal.mutateAsync(insert);
        toast.success("Negocio criado");
      }
      setSheetOpen(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Erro ao salvar negocio");
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || !user?.id) return;
    try {
      await deleteDeal.mutateAsync({ id: deleteTarget.id, userId: user.id });
      toast.success("Negocio removido");
    } catch (err: any) {
      toast.error(err?.message ?? "Erro ao remover negocio");
    } finally {
      setDeleteTarget(null);
    }
  }

  // ── Status badge ──────────────────────────────────────────────────────

  function StatusBadge({ won }: { won: boolean | null }) {
    if (won === true)
      return <Badge className="bg-green-500/10 text-green-500 gap-1"><CheckCircle2 className="h-3 w-3" /> Ganho</Badge>;
    if (won === false)
      return <Badge className="bg-red-500/10 text-red-500 gap-1"><XCircle className="h-3 w-3" /> Perdido</Badge>;
    return <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" /> Aberto</Badge>;
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Handshake className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">Negocios</h1>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="mr-2 h-4 w-4" /> Novo negocio
        </Button>
      </div>

      {/* Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <DollarSign className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">Abertos</p>
              <p className="text-xl font-bold">{metrics.openCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <DollarSign className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">Valor total aberto</p>
              <p className="text-xl font-bold">{formatBRL(metrics.openValue)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <TrendingUp className="h-5 w-5 text-green-500" />
            <div>
              <p className="text-sm text-muted-foreground">Ganhos este mes</p>
              <p className="text-xl font-bold">{metrics.wonMonth}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <TrendingDown className="h-5 w-5 text-red-500" />
            <div>
              <p className="text-sm text-muted-foreground">Perdidos este mes</p>
              <p className="text-xl font-bold">{metrics.lostMonth}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search + Tabs */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar negocio..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="todos">Todos</TabsTrigger>
          <TabsTrigger value="abertos">Abertos</TabsTrigger>
          <TabsTrigger value="ganhos">Ganhos</TabsTrigger>
          <TabsTrigger value="perdidos">Perdidos</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
              <Handshake className="h-10 w-10 mb-3" />
              <p className="text-sm">Nenhum negocio cadastrado</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Titulo</TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">Probabilidade</TableHead>
                    <TableHead>Previsao fechamento</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Criado em</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((deal) => {
                    const company = companies.find((c) => c.id === deal.company_id);
                    return (
                      <TableRow key={deal.id} className="cursor-pointer" onClick={() => setDetailId(deal.id)}>
                        <TableCell className="font-medium">{deal.title}</TableCell>
                        <TableCell>
                          {company ? (
                            <span className="flex items-center gap-1.5">
                              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                              {company.name}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">---</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatBRL(deal.value)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {deal.probability != null ? `${deal.probability}%` : "---"}
                        </TableCell>
                        <TableCell>
                          {deal.expected_close_date ? (
                            <span className="flex items-center gap-1.5">
                              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                              {formatDate(deal.expected_close_date)}
                            </span>
                          ) : (
                            "---"
                          )}
                        </TableCell>
                        <TableCell><StatusBadge won={deal.won} /></TableCell>
                        <TableCell>{formatDate(deal.created_at)}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEdit(deal); }}>
                                <Pencil className="mr-2 h-4 w-4" /> Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={(e) => { e.stopPropagation(); setDeleteTarget(deal); }}
                              >
                                <Trash2 className="mr-2 h-4 w-4" /> Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Detail Drawer */}
      <DealDetailDrawer
        dealId={detailId}
        open={!!detailId}
        onOpenChange={(o) => !o && setDetailId(undefined)}
      />

      {/* Create / Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editingDeal ? "Editar negocio" : "Novo negocio"}</SheetTitle>
            <SheetDescription>
              {editingDeal ? "Atualize os dados do negocio." : "Preencha os dados do novo negocio."}
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-6">
            <div className="space-y-2">
              <Label htmlFor="title">Titulo *</Label>
              <Input id="title" {...form.register("title")} />
              {form.formState.errors.title && (
                <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="value">Valor (R$)</Label>
              <Input id="value" type="number" step="0.01" min="0" {...form.register("value")} />
            </div>

            <div className="space-y-2">
              <Label>Empresa</Label>
              <Select
                value={form.watch("company_id") ?? "none"}
                onValueChange={(v) => form.setValue("company_id", v === "none" ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhuma</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="probability">Probabilidade (%)</Label>
              <Input id="probability" type="number" min="0" max="100" {...form.register("probability")} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="expected_close_date">Previsao de fechamento</Label>
              <Input id="expected_close_date" type="date" {...form.register("expected_close_date")} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Observacoes</Label>
              <Input id="notes" {...form.register("notes")} />
            </div>

            <SheetFooter className="pt-4">
              <Button type="submit" disabled={createDeal.isPending || updateDeal.isPending}>
                {(createDeal.isPending || updateDeal.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingDeal ? "Salvar" : "Criar"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir negocio</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir "{deleteTarget?.title}"? Essa acao pode ser revertida.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
