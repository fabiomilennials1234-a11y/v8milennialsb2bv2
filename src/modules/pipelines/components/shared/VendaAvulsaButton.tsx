import { useId, useRef, useState, type FormEvent } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL, maskCurrencyInput, parseCurrencyInput } from "@/lib/format";
import { useFeaturePermission, useOrganization, useResponsibleMembers } from "@/modules/identity";
import { notifyError } from "@/shared/errors";

const SEM_VENDEDOR = "sem-vendedor";
const TAMANHO_PAGINA = 10;

export function VendaAvulsaButton({ pipelineId, pipelineName }: { pipelineId: string; pipelineName: string }) {
  const { organizationId } = useOrganization();
  const { allowed } = useFeaturePermission("pipeline.move_cards");
  const [open, setOpen] = useState(false);

  if (!organizationId) return null;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <ReceiptText className="size-4" aria-hidden />
        {allowed ? "Registrar venda avulsa" : "Vendas avulsas"}
      </Button>
      {open && (
        <VendaAvulsaDialog
          key={pipelineId}
          organizationId={organizationId}
          pipelineId={pipelineId}
          pipelineName={pipelineName}
          canRegister={allowed}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function VendaAvulsaDialog({
  organizationId, pipelineId, pipelineName, canRegister, onClose,
}: {
  organizationId: string;
  pipelineId: string;
  pipelineName: string;
  canRegister: boolean;
  onClose: () => void;
}) {
  const { timezone, teamMemberId } = useOrganization();
  const { allowed: canViewAll } = useFeaturePermission("pipeline.view_all");
  const members = useResponsibleMembers();
  const queryClient = useQueryClient();
  const formId = useId();
  const requestId = useRef<string | null>(null);
  const saving = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [date, setDate] = useState("");
  const [owner, setOwner] = useState<string | null>(null);
  const tz = timezone || "America/Sao_Paulo";
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: tz }).format(new Date());
  const saleDate = date || today;
  const seller = canViewAll
    ? owner ?? (members.some((member) => member.id === teamMemberId) ? teamMemberId : SEM_VENDEDOR)
    : teamMemberId;
  const queryKey = ["vendas-avulsas", organizationId, pipelineId] as const;

  const sales = useInfiniteQuery({
    queryKey,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase
        .from("deals")
        .select("id, title, value, closed_at, owner_id")
        .eq("organization_id", organizationId)
        .eq("metadata->>venda_avulsa", "true")
        .eq("metadata->>pipeline_id", pipelineId)
        .is("deleted_at", null)
        .order("closed_at", { ascending: false })
        .order("id", { ascending: false })
        .range(pageParam, pageParam + TAMANHO_PAGINA - 1);
      if (error) throw error;
      return data;
    },
    getNextPageParam: (page, pages) =>
      page.length === TAMANHO_PAGINA ? pages.length * TAMANHO_PAGINA : undefined,
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;

    const amount = parseCurrencyInput(value);
    if (!title.trim() || amount <= 0 || amount > 9_999_999_999.99 || saleDate > today) {
      toast.error("Informe o nome, um valor positivo e a data da venda até hoje.");
      return;
    }

    saving.current = true;
    setIsSaving(true);
    requestId.current ??= crypto.randomUUID();
    try {
      const { error } = await supabase.rpc("registrar_venda_avulsa", {
        p_organization_id: organizationId,
        p_pipeline_id: pipelineId,
        p_request_id: requestId.current,
        p_title: title.trim(),
        p_value: amount,
        p_date: saleDate,
        p_owner_id: seller === SEM_VENDEDOR ? null : seller,
      });
      if (error) throw error;

      requestId.current = null;
      setTitle("");
      setValue("");
      setDate("");
      toast.success("Venda registrada como negócio ganho");
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
      void queryClient.invalidateQueries({ queryKey: ["ranking-data"] });
      void queryClient.invalidateQueries({ queryKey: ["movement-metrics", organizationId] });
    } catch (error) {
      notifyError(error, { fallback: "Não foi possível registrar a venda." });
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  }

  const rows = sales.data?.pages.flat() ?? [];
  const dateFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: tz });

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving.current) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{canRegister ? "Registrar venda avulsa" : "Vendas avulsas"}</DialogTitle>
          <DialogDescription>{pipelineName} · Negócios ganhos sem lead vinculado</DialogDescription>
        </DialogHeader>
        {canRegister && (
          <form className="space-y-4" onSubmit={(event) => void submit(event)}>
            <fieldset className="space-y-4" disabled={isSaving} onChange={() => { requestId.current = null; }}>
              <div className="space-y-2">
                <Label htmlFor={`${formId}-title`}>Nome da venda</Label>
                <Input id={`${formId}-title`} value={title} maxLength={160} required
                  onChange={(event) => setTitle(event.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor={`${formId}-value`}>Valor (R$)</Label>
                  <Input id={`${formId}-value`} inputMode="numeric" placeholder="0,00"
                    value={value} maxLength={16} required
                    onChange={(event) => setValue(maskCurrencyInput(event.target.value))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${formId}-date`}>Data da venda</Label>
                  <Input id={`${formId}-date`} type="date" value={saleDate} max={today} required
                    onChange={(event) => setDate(event.target.value)} />
                </div>
              </div>
              {canViewAll && (
                <div className="space-y-2">
                  <Label htmlFor={`${formId}-seller`}>Vendedor</Label>
                  <Select value={seller ?? SEM_VENDEDOR} disabled={isSaving}
                    onValueChange={(id) => { requestId.current = null; setOwner(id); }}>
                    <SelectTrigger id={`${formId}-seller`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SEM_VENDEDOR}>Sem vendedor</SelectItem>
                      {members.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </fieldset>
            <DialogFooter>
              <Button type="submit" disabled={isSaving}>{isSaving ? "Registrando…" : "Registrar venda"}</Button>
            </DialogFooter>
          </form>
        )}
        <section className="space-y-2 border-t pt-3" aria-label="Vendas registradas">
          <h3 className="text-sm font-semibold">Vendas registradas</h3>
          {sales.isPending && <p className="text-sm text-muted-foreground">Carregando vendas…</p>}
          {sales.isError && (
            <Button variant="ghost" size="sm" onClick={() => void sales.refetch()}>
              Tentar carregar vendas novamente
            </Button>
          )}
          {sales.isSuccess && rows.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma venda avulsa registrada.</p>}
          <ul className="divide-y">
            {rows.map((sale) => (
              <li key={sale.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="break-words font-medium">{sale.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {sale.closed_at && dateFormat.format(new Date(sale.closed_at))}
                    {" · "}
                    {sale.owner_id ? members.find((member) => member.id === sale.owner_id)?.name ?? "Vendedor indisponível" : "Sem vendedor"}
                  </p>
                </div>
                <span className="shrink-0 font-medium tabular-nums">{formatBRL(sale.value ?? 0, 2)}</span>
              </li>
            ))}
          </ul>
          {sales.hasNextPage && (
            <Button variant="outline" size="sm" disabled={sales.isFetchingNextPage}
              onClick={() => void sales.fetchNextPage()}>
              Carregar mais vendas
            </Button>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
