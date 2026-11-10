import { useState } from "react";
import { ptBR } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  TOM_SITUACAO,
  dataComSemana,
  diaLocal,
  distanciaRelativa,
  paraDia,
  type SituacaoAgenda,
} from "@/modules/analytics/lib/agenda-contatos";

interface AgendaDataPillProps {
  dia: string;
  situacao: SituacaoAgenda;
  hoje: string;
  /** Remarcar: a pílula vira gatilho do calendário. Sem isto, só leitura. */
  onRemarcar?: (dia: string) => void;
  disabled?: boolean;
}

/**
 * A data da agenda na cor da situação — azul futura, amarelo hoje, vermelho
 * atrasada — com o "há N dias" ao lado. Clicar remarca: na planilha da Café a
 * pessoa troca a data na própria célula; aqui é o mesmo gesto.
 */
export function AgendaDataPill({ dia, situacao, hoje, onRemarcar, disabled }: AgendaDataPillProps) {
  const [aberto, setAberto] = useState(false);
  const tom = TOM_SITUACAO[situacao];

  const conteudo = (
    <>
      <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tom.dot)} />
      <span className="font-semibold tabular-nums">{dataComSemana(dia)}</span>
      <span className="opacity-80">· {distanciaRelativa(dia, hoje)}</span>
    </>
  );
  const classe = cn(
    "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[11.5px]",
    tom.pill,
  );

  if (!onRemarcar) {
    return (
      <span className={classe} aria-label={`${tom.label}: ${dataComSemana(dia)}`}>
        {conteudo}
      </span>
    );
  }

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`${tom.label}: ${dataComSemana(dia)}. Remarcar`}
          className={cn(
            classe,
            "transition-[filter,box-shadow] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
          )}
        >
          {conteudo}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={ptBR}
          selected={diaLocal(dia)}
          defaultMonth={diaLocal(dia)}
          // Remarcar é para frente: hoje ou depois (no fuso da org).
          disabled={(d) => paraDia(d) < hoje}
          onSelect={(d) => {
            if (!d) return;
            const novo = paraDia(d);
            setAberto(false);
            if (novo !== dia) onRemarcar(novo);
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
