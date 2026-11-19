import { useState } from "react";
import { ptBR } from "date-fns/locale";
import { CalendarDays, X } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  calendarioDoPeriodo,
  periodoDosDias,
  presetsDePeriodo,
  rotuloDoPeriodo,
  type PeriodoDeCriacao,
} from "../lib/periodo-de-criacao";

interface Props {
  /** Instantes ISO já cortados no fuso da org; `undefined` = sem recorte. */
  from?: string;
  to?: string;
  timeZone: string;
  onChange: (periodo: PeriodoDeCriacao | null) => void;
  /** Nome do recorte no botão e no aria-label. */
  rotulo?: string;
}

/**
 * Filtro de período pela data em que o lead chegou (`created_at`).
 *
 * Atalhos para o que se pede todo dia (este mês, mês passado…) e um
 * "Personalizado" com calendário de intervalo. O dia é cortado no fuso da org
 * (`periodo-de-criacao.ts`): quem acessa de outro fuso vê a mesma lista.
 */
export function FiltroPeriodoDeCriacao({ from, to, timeZone, onChange, rotulo = "Chegada" }: Props) {
  const [aberto, setAberto] = useState(false);
  const [rascunho, setRascunho] = useState<DateRange | undefined>(undefined);
  const ativo = !!from || !!to;
  const presets = presetsDePeriodo(new Date(), timeZone);

  const abrir = (open: boolean) => {
    if (open) setRascunho(calendarioDoPeriodo(from, to, timeZone));
    setAberto(open);
  };
  const aplicar = (periodo: PeriodoDeCriacao | null) => {
    onChange(periodo);
    setAberto(false);
  };
  const presetAtivo = presets.find((p) => p.periodo.from === from && p.periodo.to === to)?.key;

  return (
    <div className="flex items-center gap-1">
      <Popover open={aberto} onOpenChange={abrir}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            aria-label={`Período de ${rotulo.toLowerCase()}`}
            className={cn("gap-2", ativo && "border-primary/50 text-foreground")}
          >
            <CalendarDays className="h-4 w-4" />
            {ativo ? `${rotulo}: ${rotuloDoPeriodo(from, to, timeZone)}` : `${rotulo}: qualquer data`}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <div className="flex flex-col sm:flex-row">
            <div className="flex flex-row flex-wrap gap-1 border-b border-border p-2 sm:w-44 sm:flex-col sm:border-b-0 sm:border-r">
              {presets.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => aplicar(p.periodo)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-left text-sm transition-colors hover:bg-secondary",
                    presetAtivo === p.key && "bg-secondary font-semibold",
                  )}
                >
                  {p.label}
                </button>
              ))}
              <span className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Personalizado
              </span>
              <p className="px-3 text-xs text-muted-foreground">Escolha o primeiro e o último dia no calendário.</p>
            </div>
            <div className="flex flex-col">
              <Calendar
                mode="range"
                selected={rascunho}
                onSelect={setRascunho}
                numberOfMonths={2}
                locale={ptBR}
                defaultMonth={rascunho?.from ?? new Date()}
                disabled={{ after: new Date() }}
              />
              <div className="flex justify-end gap-2 border-t border-border p-2">
                <Button variant="ghost" onClick={() => setAberto(false)}>Cancelar</Button>
                <Button
                  disabled={!rascunho?.from}
                  onClick={() => rascunho?.from && aplicar(periodoDosDias(rascunho.from, rascunho.to, timeZone))}
                >
                  Aplicar período
                </Button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {ativo && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remover período de ${rotulo.toLowerCase()}`}
          onClick={() => onChange(null)}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
