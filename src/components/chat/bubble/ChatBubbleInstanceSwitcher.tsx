/**
 * ChatBubbleInstanceSwitcher — filtra a lista do Chat Bubble por instância.
 *
 * Trigger compacto (28px) com dot + nome da seleção atual.
 * Popover Radix (260px) lista "Todas as conversas" + instâncias permitidas em
 * ordem alfabética; item selecionado recebe Check à direita. Status muted
 * (ex: "• desconectada") quando `instance.status !== "connected"`.
 *
 * Filtro é puramente visual — não muda `useQueries` cross-instance, nem badge
 * FAB, nem realtime subscriptions. State persistido por user via
 * ChatBubbleContext (localStorage `chat-bubble:list-filter:${userId}`).
 */
import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { instanceColor } from "./utils/instanceColor";
import type { WhatsAppInstanceForUser } from "@/hooks/chat/types";

interface ChatBubbleInstanceSwitcherProps {
  instances: WhatsAppInstanceForUser[];
  value: string | "all";
  onChange: (next: string | "all") => void;
  preferredId?: string | null;
}

function statusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  if (status === "connected") return null;
  if (status === "disconnected") return "desconectada";
  if (status === "connecting") return "conectando";
  if (status === "qrcode" || status === "qr") return "aguardando QR";
  return status;
}

export function ChatBubbleInstanceSwitcher({
  instances,
  value,
  onChange,
  preferredId,
}: ChatBubbleInstanceSwitcherProps) {
  const [open, setOpen] = useState(false);

  const sorted = useMemo(
    () =>
      [...instances].sort((a, b) =>
        (a.instance_name ?? "").localeCompare(b.instance_name ?? "", undefined, {
          sensitivity: "base",
        }),
      ),
    [instances],
  );

  const selected = useMemo(
    () => (value === "all" ? null : instances.find((i) => i.id === value) ?? null),
    [instances, value],
  );

  const triggerLabel = selected ? selected.instance_name : "Todas as conversas";
  const ariaLabel = selected
    ? `Filtro de instância: ${selected.instance_name}. Toque para trocar.`
    : "Filtro de instância: todas as conversas. Toque para escolher uma.";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            "group inline-flex items-center gap-1.5",
            "h-7 px-2 max-w-[200px]",
            "rounded-md",
            "text-foreground",
            "transition-colors duration-150",
            "hover:bg-accent/50",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
          )}
        >
          {selected && (
            <span
              aria-hidden
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: instanceColor(selected.id) }}
            />
          )}
          <span className="text-[13px] font-medium leading-none truncate">
            {triggerLabel}
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              "w-3 h-3 shrink-0 text-muted-foreground",
              "transition-transform duration-150 ease-out",
              open && "rotate-180",
            )}
          />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={6}
        className={cn(
          "w-[260px] p-1",
          "rounded-lg",
          "bg-popover text-popover-foreground",
          "border border-border/60",
          "shadow-lg",
        )}
      >
        <ul role="listbox" aria-label="Selecionar instância">
          <li>
            <button
              type="button"
              role="option"
              aria-selected={value === "all"}
              onClick={() => {
                onChange("all");
                setOpen(false);
              }}
              className={cn(
                "w-full h-9 px-2 flex items-center gap-2",
                "rounded-md",
                "text-[13px] text-foreground",
                "transition-colors duration-150",
                "hover:bg-accent/60 focus-visible:bg-accent/60",
                "focus-visible:outline-none",
              )}
            >
              <span className="flex-1 text-left truncate">Todas as conversas</span>
              {value === "all" && (
                <Check
                  className="w-3.5 h-3.5 text-foreground shrink-0"
                  aria-hidden
                />
              )}
            </button>
          </li>

          {sorted.length > 0 && (
            <li aria-hidden className="my-1 px-1">
              <Separator className="bg-border/50" />
            </li>
          )}

          {sorted.map((inst) => {
            const isSelected = value === inst.id;
            const isPreferred = preferredId === inst.id;
            const status = statusLabel(inst.status as string | null | undefined);
            return (
              <li key={inst.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(inst.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full h-9 px-2 flex items-center gap-2",
                    "rounded-md",
                    "text-[13px] text-foreground",
                    "transition-colors duration-150",
                    "hover:bg-accent/60 focus-visible:bg-accent/60",
                    "focus-visible:outline-none",
                  )}
                >
                  <span
                    aria-hidden
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: instanceColor(inst.id) }}
                  />
                  <span className="flex-1 min-w-0 text-left truncate">
                    <span className="truncate">{inst.instance_name}</span>
                    {isPreferred && (
                      <span className="text-[10px] text-muted-foreground/60 ml-1.5 font-medium uppercase tracking-wider">
                        padrão
                      </span>
                    )}
                    {status && (
                      <span className="text-muted-foreground/70 ml-1">
                        • {status}
                      </span>
                    )}
                  </span>
                  {isSelected && (
                    <Check
                      className="w-3.5 h-3.5 text-foreground shrink-0"
                      aria-hidden
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
