import { useId, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL, maskCurrencyInput, parseCurrencyInput } from "@/lib/format";
import { useAuth, useFeaturePermission, useOrganization, useTeamMembers } from "@/modules/identity";
import { notifyError } from "@/shared/errors";
import { zonedDayStartOfYMD } from "@/shared/time/zoned-day";

const RIOFIX_ORG_ID = "36971ff5-fd73-4f30-a733-04bf8c90e5b6";
const MUSTANG_PIPELINE_ID = "a9a2f3cb-63fe-4ca1-a453-f27002cc4944";
const SEM_VENDEDOR = "sem-vendedor";
const TODOS = "todos";
const BATCH_SIZE = 250;
const PAGE_SIZE = 10;

type Venda = { id: string; title: string; value: number | null; closed_at: string | null; owner_id: string | null };

export function VendaAvulsaButton({ pipelineId }: { pipelineId: string }) {
  const { organizationId } = useOrganization();
  if (organizationId !== RIOFIX_ORG_ID || pipelineId !== MUSTANG_PIPELINE_ID) return null;

  return <VendaAvulsaAction />;
}

function VendaAvulsaAction() {
  const { user } = useAuth();
  const { allowed, isLoading } = useFeaturePermission("pipeline.move_cards");
  const [open, setOpen] = useState(false);
  const canRegister = !!user && allowed && !isLoading;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <ReceiptText className="size-4" aria-hidden />
        {canRegister ? "Registrar venda avulsa" : "Vendas avulsas"}
      </Button>
      {open && (
        <VendaAvulsaDialog
          actorId={canRegister ? user.id : null}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function VendaAvulsaDialog({ actorId, onClose }: { actorId: string | null; onClose: () => void }) {
  const { timezone, teamMemberId } = useOrganization();
  const { allowed: canViewAll, isLoading: loadingVisibility } = useFeaturePermission("pipeline.view_all");
  const { data: members = [] } = useTeamMembers();
  const queryClient = useQueryClient();
  const formId = useId();
  const requestId = useRef<string | null>(null);
  const saving = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [date, setDate] = useState("");
  const [owner, setOwner] = useState<string | null>(null);
  const [month, setMonth] = useState("");
  const [sellerFilter, setSellerFilter] = useState(TODOS);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const tz = timezone || "America/Sao_Paulo";
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: tz }).format(new Date());
  const selectedMonth = month || today.slice(0, 7);
  const saleDate = date || today;
  const activeMembers = members.filter((member) => member.is_active);
  const seller = canViewAll
    ? owner ?? (activeMembers.some((member) => member.id === teamMemberId) ? teamMemberId : SEM_VENDEDOR)
    : teamMemberId;
  const canRegister = !!actorId && !loadingVisibility && (!!seller || canViewAll);
  const ownerFilter = canViewAll ? sellerFilter : teamMemberId;
  const queryKey = ["vendas-avulsas", RIOFIX_ORG_ID, MUSTANG_PIPELINE_ID] as const;

  const sales = useQuery({
    queryKey: [...queryKey, selectedMonth, tz, ownerFilter],
    enabled: !loadingVisibility && !!ownerFilter,
    queryFn: async ({ signal }) => {
      const [year, monthNumber] = selectedMonth.split("-").map(Number);
      const start = zonedDayStartOfYMD(year, monthNumber, 1, tz).toISOString();
      const end = zonedDayStartOfYMD(year, monthNumber + 1, 1, tz).toISOString();
      const rows: Venda[] = [];
      for (let offset = 0; ; offset += BATCH_SIZE) {
        let query = supabase.from("deals")
          .select("id, title, value, closed_at, owner_id")
          .eq("organization_id", RIOFIX_ORG_ID)
          .eq("metadata->>venda_avulsa", "true")
          .eq("metadata->>pipeline_id", MUSTANG_PIPELINE_ID)
          .eq("outcome", "won")
          .eq("currency", "BRL")
          .is("source_lead_id", null)
          .is("deleted_at", null)
          .gte("closed_at", start)
          .lt("closed_at", end);
        if (ownerFilter === SEM_VENDEDOR) query = query.is("owner_id", null);
        else if (ownerFilter && ownerFilter !== TODOS) query = query.eq("owner_id", ownerFilter);

        const { data, error } = await query
          .order("closed_at", { ascending: false })
          .order("id", { ascending: false })
          .range(offset, offset + BATCH_SIZE - 1)
          .abortSignal(signal);
        if (error) throw error;
        rows.push(...data);
        if (data.length < BATCH_SIZE) return rows;
      }
    },
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || !canRegister) return;

    const amount = parseCurrencyInput(value);
    if (!title.trim() || amount <= 0 || amount > 9_999_999_999.99 || saleDate > today) {
      toast.error("Informe o nome, um valor positivo e a data da venda até hoje.");
      return;
    }

    const [year, monthNumber, day] = saleDate.split("-").map(Number);
    const closedAt = zonedDayStartOfYMD(year, monthNumber, day, tz).toISOString();
    saving.current = true;
    setIsSaving(true);
    requestId.current ??= crypto.randomUUID();
    try {
      // O id do formulário também é o PK do negócio. Repetir o envio após
      // perda de resposta preserva a primeira gravação.
      const { error } = await supabase.from("deals").upsert({
        id: requestId.current,
        organization_id: RIOFIX_ORG_ID,
        title: title.trim(),
        value: amount,
        currency: "BRL",
        source_lead_id: null,
        owner_id: seller === SEM_VENDEDOR ? null : seller,
        created_by: actorId,
        source: "human",
        won: true,
        outcome: "won",
        closed_at: closedAt,
        outcome_at: closedAt,
        outcome_source: "ui",
        metadata: { venda_avulsa: true, pipeline_id: MUSTANG_PIPELINE_ID },
      }, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw error;

      requestId.current = null;
      setTitle("");
      setValue("");
      setDate("");
      setMonth(saleDate.slice(0, 7));
      setSellerFilter(TODOS);
      setVisibleCount(PAGE_SIZE);
      toast.success("Venda avulsa registrada");
      void queryClient.invalidateQueries({ queryKey });
    } catch (error) {
      notifyError(error, { fallback: "Não foi possível registrar a venda avulsa." });
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  }

  const rows = sales.data ?? [];
  const total = rows.reduce((sum, sale) => sum + Math.round((sale.value ?? 0) * 100), 0) / 100;
  const dateFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: tz });

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving.current) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{canRegister ? "Registrar venda avulsa" : "Vendas avulsas"}</DialogTitle>
          <DialogDescription>Funil Mustang · Controle separado do faturamento oficial</DialogDescription>
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
                      {activeMembers.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}
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
        <section className="space-y-3 border-t pt-3" aria-label="Vendas registradas">
          <h3 className="text-sm font-semibold">Vendas registradas</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${formId}-month`}>Mês</Label>
              <Input id={`${formId}-month`} type="month" value={selectedMonth}
                onChange={(event) => { setMonth(event.target.value); setVisibleCount(PAGE_SIZE); }} />
            </div>
            {canViewAll && (
              <div className="space-y-2">
                <Label htmlFor={`${formId}-seller-filter`}>Filtrar por vendedor</Label>
                <Select value={sellerFilter} onValueChange={(id) => { setSellerFilter(id); setVisibleCount(PAGE_SIZE); }}>
                  <SelectTrigger id={`${formId}-seller-filter`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TODOS}>Todos</SelectItem>
                    <SelectItem value={SEM_VENDEDOR}>Sem vendedor</SelectItem>
                    {members.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {sales.isFetching && !sales.data && <p className="text-sm text-muted-foreground">Carregando vendas…</p>}
          {sales.isError && (
            <Button variant="ghost" size="sm" onClick={() => void sales.refetch()}>
              Tentar carregar vendas novamente
            </Button>
          )}
          {sales.isSuccess && (
            <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
              <span>Total de vendas avulsas ({rows.length})</span>
              <strong className="tabular-nums">{formatBRL(total, 2)}</strong>
            </div>
          )}
          <ul className="divide-y">
            {rows.slice(0, visibleCount).map((sale) => (
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
          {rows.length > visibleCount && (
            <Button variant="outline" size="sm" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
              Mostrar mais vendas
            </Button>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
