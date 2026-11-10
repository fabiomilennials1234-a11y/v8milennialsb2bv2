import { useEffect, useState } from "react";
import { ptBR } from "date-fns/locale";
import { Check, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/shared/hooks/useDebounce";
import { formatPhoneBR } from "@/shared/format/phone";
import {
  useBuscaClientesAgenda,
  useMarcarAgendaContato,
  type ClienteParaAgenda,
} from "@/modules/analytics/hooks/useAgendaContatos";
import { dataComSemana, diaLocal, paraDia } from "@/modules/analytics/lib/agenda-contatos";

interface NovaAgendaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hoje: string;
}

/**
 * Marcar o próximo contato com um cliente. Se o cliente já tem agenda aberta
 * com a pessoa, salvar REMARCA (uma agenda por cliente e dono) — o aviso no
 * rodapé diz isso antes do clique.
 */
export function NovaAgendaDialog({ open, onOpenChange, hoje }: NovaAgendaDialogProps) {
  const [busca, setBusca] = useState("");
  const termo = useDebounce(busca, 250);
  const [cliente, setCliente] = useState<ClienteParaAgenda | null>(null);
  const [dia, setDia] = useState<string>(hoje);
  const [observacao, setObservacao] = useState("");
  const resultados = useBuscaClientesAgenda(termo);
  const marcar = useMarcarAgendaContato();

  useEffect(() => {
    if (!open) return;
    setBusca("");
    setCliente(null);
    setDia(hoje);
    setObservacao("");
  }, [open, hoje]);

  const salvar = async () => {
    if (!cliente) return;
    try {
      await marcar.mutateAsync({ leadId: cliente.id, dia, observacao: observacao.trim() || null });
      onOpenChange(false);
    } catch {
      /* a mutation avisa */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Nova agenda</DialogTitle>
          <DialogDescription>Escolha o cliente e o dia do próximo contato.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 sm:grid-cols-[1fr_auto]">
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="agenda-busca" className="text-[12px] font-semibold">Cliente</label>
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="agenda-busca"
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Nome, empresa, código do ERP ou telefone"
                className="pl-9"
                autoComplete="off"
              />
            </div>
            <ul role="listbox" aria-label="Clientes encontrados" className="max-h-[260px] min-h-[120px] overflow-y-auto rounded-xl border border-border">
              {termo.trim().length < 2 ? (
                <li className="px-3 py-6 text-center text-[12px] text-muted-foreground">Digite ao menos 2 letras.</li>
              ) : resultados.isLoading ? (
                <li className="flex items-center justify-center gap-2 px-3 py-6 text-[12px] text-muted-foreground">
                  <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Procurando…
                </li>
              ) : resultados.isError ? (
                <li className="px-3 py-6 text-center text-[12px] text-destructive-strong">Não deu para buscar. Tente de novo.</li>
              ) : (resultados.data ?? []).length === 0 ? (
                <li className="px-3 py-6 text-center text-[12px] text-muted-foreground">Nenhum cliente com “{termo.trim()}”.</li>
              ) : (
                (resultados.data ?? []).map((c) => {
                  const escolhido = cliente?.id === c.id;
                  return (
                    <li key={c.id} role="option" aria-selected={escolhido}>
                      <button
                        type="button"
                        onClick={() => setCliente(c)}
                        className={cn(
                          "flex w-full items-center gap-3 border-b border-border/60 px-3 py-2 text-left last:border-b-0 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
                          escolhido && "bg-primary-soft/60 hover:bg-primary-soft/60",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold">{c.name || "Sem nome"}</span>
                          <span className="block truncate text-[11.5px] text-muted-foreground">
                            {[c.company, c.erp_code ? `ERP ${c.erp_code}` : null, c.phone ? formatPhoneBR(c.phone) : null]
                              .filter(Boolean)
                              .join(" · ") || "Sem dados"}
                          </span>
                        </span>
                        {escolhido && <Check aria-hidden className="h-4 w-4 shrink-0 text-primary-soft-foreground" />}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-semibold">Data da agenda</span>
            <div className="rounded-xl border border-border">
              <Calendar
                mode="single"
                locale={ptBR}
                selected={diaLocal(dia)}
                defaultMonth={diaLocal(dia)}
                disabled={(d) => paraDia(d) < hoje}
                onSelect={(d) => d && setDia(paraDia(d))}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="agenda-obs" className="text-[12px] font-semibold">
            Observação <span className="font-normal text-muted-foreground">(opcional)</span>
          </label>
          <Textarea
            id="agenda-obs"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Ex.: ligar para fechar o pedido de dezembro"
          />
        </div>

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <p className="text-[11.5px] text-muted-foreground">
            {cliente
              ? <>Próximo contato com <b className="text-foreground">{cliente.name}</b> em <b className="text-foreground">{dataComSemana(dia)}</b>. Se já houver agenda dele com você, a data é trocada.</>
              : "Escolha um cliente na lista."}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={() => void salvar()} disabled={!cliente || marcar.isPending}>
              {marcar.isPending && <Loader2 aria-hidden className="mr-1.5 h-4 w-4 animate-spin" />}
              Salvar agenda
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
