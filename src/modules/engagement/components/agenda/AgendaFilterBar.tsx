/**
 * Abas de estado + filtros da Agenda.
 *
 * Esquerda: segmentado Pendentes / Todas / Finalizadas.
 * Direita: responsável (só para quem enxerga a agenda inteira) e tipo.
 *
 * O segmentado é neutro de propósito: ouro é dinheiro e ação (DESIGN.md § Cor),
 * e escolher uma aba não é nenhum dos dois.
 */

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import type { AgendaStatusFilter, EventTypeKey } from "./agenda-helpers";
import {
  EVENT_TYPE_COLORS,
  EVENT_TYPE_KEYS,
  EVENT_TYPE_LABELS,
} from "./agenda-helpers";

/** Valor sentinela do Select — Radix não aceita `value=""` em SelectItem. */
export const ALL_OPTION = "all";

const STATUS_TABS: Array<{ key: AgendaStatusFilter; label: string }> = [
  { key: "pending", label: "Pendentes" },
  { key: "all", label: "Todas atividades" },
  { key: "done", label: "Finalizadas" },
];

export interface AgendaOwnerOption {
  /** Chave usada no Select — o `team_members.id`. */
  value: string;
  label: string;
}

interface AgendaFilterBarProps {
  status: AgendaStatusFilter;
  onStatusChange: (status: AgendaStatusFilter) => void;
  /** `ALL_OPTION` quando nenhum responsável está selecionado. */
  owner: string;
  onOwnerChange: (owner: string) => void;
  /** Vazio esconde o filtro — é o caso do usuário que só vê a própria agenda. */
  ownerOptions: AgendaOwnerOption[];
  /** Tipos visíveis. Multi-seleção: dá para ver reunião + ligação sem tarefa. */
  activeTypes: Set<EventTypeKey>;
  onToggleType: (type: EventTypeKey) => void;
}

/** Rótulo do gatilho de tipos — diz o estado sem obrigar a abrir o menu. */
function labelDosTipos(activeTypes: Set<EventTypeKey>): string {
  if (activeTypes.size === EVENT_TYPE_KEYS.length) return "Todos os tipos";
  if (activeTypes.size === 0) return "Nenhum tipo";
  if (activeTypes.size === 1) {
    const [unico] = [...activeTypes];
    return EVENT_TYPE_LABELS[unico];
  }
  return `${activeTypes.size} tipos`;
}

export function AgendaFilterBar({
  status,
  onStatusChange,
  owner,
  onOwnerChange,
  ownerOptions,
  activeTypes,
  onToggleType,
}: AgendaFilterBarProps) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      {/* Abas de estado */}
      {/* `max-w-full overflow-x-auto` porque em 360px os três rótulos não cabem
          e "Finalizadas" ficava cortada — inalcançável, não só feia. */}
      <div
        role="tablist"
        aria-label="Estado das atividades"
        className="scrollbar-hide -mx-1 flex max-w-full items-center gap-1 self-start overflow-x-auto rounded-full border border-border bg-sunken p-1 sm:mx-0"
      >
        {STATUS_TABS.map((tab) => {
          const active = status === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onStatusChange(tab.key)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                // A aba ativa se distingue por SUPERFÍCIE (`bg-card` + borda +
                // sombra sobre o `bg-sunken` do trilho), não por cor de texto.
                // `--muted-foreground` no rótulo inativo mede 3,95:1 sobre o
                // afundado do tema claro contra 7,85:1 no escuro — um tema
                // pior que o outro é exatamente o que o DESIGN.md reprova.
                active
                  ? "border border-border bg-card font-semibold text-foreground shadow-sm"
                  : "font-medium text-foreground/80 hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        {ownerOptions.length > 0 && (
          <Select value={owner} onValueChange={onOwnerChange}>
            <SelectTrigger
              aria-label="Filtrar por atendente"
              className="h-9 w-full sm:w-[210px]"
            >
              <SelectValue placeholder="Selecionar atendente" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_OPTION}>Todos os atendentes</SelectItem>
              {ownerOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Menu de marcação, e não Select: o tipo sempre foi multi-seleção
            nesta tela (dá para ver reunião + ligação sem tarefa). Trocar por
            valor único derrubaria os 32 subconjuntos possíveis para 6. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Filtrar por tipo"
            className={cn(
              "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm sm:w-[170px]",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
            )}
          >
            <span className="truncate">{labelDosTipos(activeTypes)}</span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {EVENT_TYPE_KEYS.map((key) => (
              <DropdownMenuCheckboxItem
                key={key}
                checked={activeTypes.has(key)}
                onCheckedChange={() => onToggleType(key)}
                onSelect={(e) => e.preventDefault()}
                className="gap-2 text-xs"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: EVENT_TYPE_COLORS[key] }}
                />
                {EVENT_TYPE_LABELS[key]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
