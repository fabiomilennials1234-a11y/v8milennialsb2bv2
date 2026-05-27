import { useState } from "react";
import { X, Trophy, XCircle, Trash2 } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDeal, useUpdateDeal, useMarkDealWon, useMarkDealLost, useDeleteDeal } from "@/modules/carteira/hooks/useDeals";
import { useTeamMembers } from "@/modules/identity";
import { DealItemsTable } from "./DealItemsTable";

const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string | null;
}

export function DealDetailDrawer({ open, onOpenChange, dealId }: Props) {
  const { data: deal, isLoading } = useDeal(dealId);
  const updateDeal = useUpdateDeal();
  const markWon = useMarkDealWon();
  const markLost = useMarkDealLost();
  const deleteDeal = useDeleteDeal();
  const { data: teamMembers } = useTeamMembers();

  const [lossDialogOpen, setLossDialogOpen] = useState(false);
  const [lossReason, setLossReason] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const handleFieldChange = (field: string, value: unknown) => {
    if (!deal) return;
    updateDeal.mutate({ id: deal.id, [field]: value } as any);
  };

  if (!dealId) return null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-xl p-0 overflow-y-auto">
          {isLoading || !deal ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground text-sm">Carregando...</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="sticky top-0 z-10 bg-background border-b px-6 py-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1 flex-1 min-w-0">
                    <Input
                      defaultValue={deal.title}
                      onBlur={(e) => handleFieldChange("title", e.target.value)}
                      className="text-lg font-semibold border-0 p-0 h-auto focus-visible:ring-0 bg-transparent"
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-primary">{fmt(deal.value ?? 0)}</span>
                      {deal.won === true && <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Ganho</Badge>}
                      {deal.won === false && <Badge variant="destructive">Perdido</Badge>}
                      {deal.won === null && <Badge variant="outline">Aberto</Badge>}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                {deal.won === null && (
                  <div className="flex gap-2 mt-3">
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => markWon.mutate(deal.id)}
                      disabled={markWon.isPending}
                    >
                      <Trophy className="h-3.5 w-3.5 mr-1" /> Ganho
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setLossDialogOpen(true)}
                    >
                      <XCircle className="h-3.5 w-3.5 mr-1" /> Perdido
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto text-destructive"
                      onClick={() => setDeleteDialogOpen(true)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>

              {/* Tabs */}
              <Tabs defaultValue="info" className="flex-1">
                <TabsList className="w-full justify-start rounded-none border-b bg-transparent px-6">
                  <TabsTrigger value="info">Info</TabsTrigger>
                  <TabsTrigger value="produtos">Produtos</TabsTrigger>
                  <TabsTrigger value="historico">Histórico</TabsTrigger>
                </TabsList>

                <TabsContent value="info" className="p-6 pt-4 m-0 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Probabilidade (%)</Label>
                      <Input
                        type="number"
                        defaultValue={deal.probability ?? 50}
                        min={0}
                        max={100}
                        onBlur={(e) => handleFieldChange("probability", parseInt(e.target.value) || 0)}
                      />
                    </div>
                    <div>
                      <Label>Previsão fechamento</Label>
                      <Input
                        type="date"
                        defaultValue={deal.expected_close_date ?? ""}
                        onBlur={(e) => handleFieldChange("expected_close_date", e.target.value || null)}
                      />
                    </div>
                  </div>

                  <div>
                    <Label>Responsável</Label>
                    <Select
                      defaultValue={deal.owner_id ?? ""}
                      onValueChange={(v) => handleFieldChange("owner_id", v || null)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecionar responsável" />
                      </SelectTrigger>
                      <SelectContent>
                        {(teamMembers ?? []).map((m) => (
                          <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Lead vinculado</Label>
                    <p className="text-sm mt-1">{deal.lead?.name ?? "—"}</p>
                  </div>

                  <div>
                    <Label>Empresa</Label>
                    <p className="text-sm mt-1">{deal.company?.name ?? "—"}</p>
                  </div>

                  <div>
                    <Label>Notas</Label>
                    <Textarea
                      defaultValue={deal.notes ?? ""}
                      onBlur={(e) => handleFieldChange("notes", e.target.value || null)}
                      rows={3}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="produtos" className="p-6 pt-4 m-0">
                  <DealItemsTable dealId={deal.id} />
                </TabsContent>

                <TabsContent value="historico" className="p-6 pt-4 m-0">
                  <div className="text-center py-8">
                    <p className="text-sm text-muted-foreground">
                      Criado em {new Date(deal.created_at).toLocaleDateString("pt-BR")}
                    </p>
                    {deal.closed_at && (
                      <p className="text-sm text-muted-foreground mt-1">
                        Fechado em {new Date(deal.closed_at).toLocaleDateString("pt-BR")}
                      </p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Loss reason dialog */}
      <AlertDialog open={lossDialogOpen} onOpenChange={setLossDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Motivo da perda</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <Textarea
                  value={lossReason}
                  onChange={(e) => setLossReason(e.target.value)}
                  placeholder="Por que o negócio foi perdido?"
                  rows={3}
                  className="mt-2"
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                if (deal) markLost.mutate({ dealId: deal.id, reason: lossReason });
                setLossDialogOpen(false);
                setLossReason("");
              }}
            >
              Marcar como perdido
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir negócio?</AlertDialogTitle>
            <AlertDialogDescription>
              O negócio será removido. Esta ação pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                if (deal) deleteDeal.mutate(deal.id, { onSuccess: () => onOpenChange(false) });
                setDeleteDialogOpen(false);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
