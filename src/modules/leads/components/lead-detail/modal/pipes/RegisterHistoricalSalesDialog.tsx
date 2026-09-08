import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { Plus, Receipt, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useIdentity, useOrganization } from "@/modules/identity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useRegisterHistoricalSales, type HistoricalSaleInput } from "../../../../hooks/useRegisterHistoricalSales";

type Fields = { sales: { value: string; date: string }[] };
const emptySale = () => ({ value: "", date: "" });

export function RegisterHistoricalSalesDialog({ leadId, disabled }: { leadId: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [submitted, setSubmitted] = useState<HistoricalSaleInput[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { timezone, organizationId } = useOrganization();
  const { userId } = useIdentity();
  const recoveryKey = `historical-sales:${userId}:${organizationId}:${leadId}`;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "America/Sao_Paulo" }).format(new Date());
  const form = useForm<Fields>({ defaultValues: { sales: [emptySale()] } });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "sales" });
  const mutation = useRegisterHistoricalSales(leadId);

  async function save(values: Fields) {
    const sales = submitted ?? values.sales.map(s => ({ value: Number(s.value), date: s.date }));
    setSubmitted(sales);
    setError(null);
    try {
      // Keep an uncertain submission across closing the lead or reloading this tab.
      sessionStorage.setItem(recoveryKey, JSON.stringify({ requestId, sales }));
      await mutation.mutateAsync({ requestId, sales });
      sessionStorage.removeItem(recoveryKey);
      toast.success(sales.length === 1 ? "Venda registrada" : `${sales.length} vendas registradas`);
      setOpen(false);
      form.reset({ sales: [emptySale()] });
      setSubmitted(null);
      setRequestId(crypto.randomUUID());
    } catch (cause) {
      const rawCode = (cause as { code?: unknown }).code;
      const code = typeof rawCode === "string" ? rawCode : "";
      if (code.startsWith("22") || code.startsWith("23") || code === "42501") {
        sessionStorage.removeItem(recoveryKey);
        setSubmitted(null);
        setError("O registro foi recusado. Confira os valores, as datas e seu acesso ao lead.");
        return;
      }
      // Same key and immutable payload on retry: a lost response must not duplicate revenue.
      setError("Não foi possível confirmar o registro. Tente salvar novamente; as vendas não serão duplicadas.");
    }
  }

  return <Dialog open={open} onOpenChange={next => {
    if (mutation.isPending) return;
    if (next) {
      try {
        const raw = sessionStorage.getItem(recoveryKey);
        if (raw) {
          const recovery = JSON.parse(raw) as { requestId: string; sales: HistoricalSaleInput[] };
          if (typeof recovery.requestId === "string" && Array.isArray(recovery.sales)
            && recovery.sales.length > 0 && recovery.sales.length <= 100
            && recovery.sales.every(s => Number.isFinite(s.value) && typeof s.date === "string")) {
            setRequestId(recovery.requestId);
            setSubmitted(recovery.sales);
            form.reset({ sales: recovery.sales.map(s => ({ value: String(s.value), date: s.date })) });
            setError("Há um registro aguardando confirmação. Tente salvar novamente para conferir o resultado sem duplicar vendas.");
          }
        }
      } catch { /* A missing browser draft must not prevent opening the form. */ }
    }
    setOpen(next);
  }}>
    <DialogTrigger asChild><Button type="button" variant="outline" size="sm" disabled={disabled}>
      <Receipt />Registrar Venda
    </Button></DialogTrigger>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Registrar vendas</DialogTitle>
        <DialogDescription>Informe o valor e a data de cada compra anterior. Ao salvar, as vendas serão registradas como negócios ganhos e usadas no cálculo de recompra.</DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(save)} className="flex flex-col gap-4">
          {fields.map((field, index) => <fieldset key={field.id} disabled={mutation.isPending || !!submitted} className="flex flex-col gap-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">Venda {index + 1}</legend>
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <FormField control={form.control} name={`sales.${index}.value`} rules={{
                required: "Informe o valor", validate: value => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 9999999999.99 || "Informe um valor maior que zero",
              }} render={({ field: input }) => <FormItem>
                <FormLabel>Valor (R$)</FormLabel><FormControl><Input {...input} type="number" min="0.01" step="0.01" inputMode="decimal" /></FormControl><FormMessage />
              </FormItem>} />
              <FormField control={form.control} name={`sales.${index}.date`} rules={{
                required: "Informe a data", validate: value => value <= today || "A data não pode ser futura",
              }} render={({ field: input }) => <FormItem>
                <FormLabel>Data da venda</FormLabel><FormControl><Input {...input} type="date" max={today} /></FormControl><FormMessage />
              </FormItem>} />
              <Button type="button" size="icon" variant="ghost" className="justify-self-end sm:mt-6" disabled={fields.length === 1} aria-label={`Remover venda ${index + 1}`} onClick={() => remove(index)}><Trash2 /></Button>
            </div>
          </fieldset>)}
          <Button type="button" variant="outline" disabled={mutation.isPending || !!submitted || fields.length >= 100} onClick={async () => {
            if (await form.trigger("sales")) append(emptySale());
          }}><Plus />Próxima venda</Button>
          <p className="text-sm text-muted-foreground">A lista será gravada somente ao salvar. Duas ou mais datas de compra permitem calcular o ciclo médio.</p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => setOpen(false)}>Fechar</Button>
            <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Salvando…" : error ? "Tentar salvar novamente" : "Salvar vendas"}</Button>
          </DialogFooter>
        </form>
      </Form>
    </DialogContent>
  </Dialog>;
}
