/**
 * PlaygroundSettings — Painel colapsavel de Settings
 *
 * Contem:
 * - Audiencia (atender contatos sem lead)
 *
 * NOTE: Disponibilidade, delay, temperatura e behavior windows foram movidos
 * para a tab Comportamento (PlaygroundComportamento).
 */

import { Users } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { PlaygroundData } from "./types";

interface PlaygroundSettingsProps {
  data: PlaygroundData;
  onChange: (updates: Partial<PlaygroundData>) => void;
}

export function PlaygroundSettings({ data, onChange }: PlaygroundSettingsProps) {
  return (
    <div className="rounded-2xl border border-border/70">
      {/* ===== Audiencia ===== */}
      <div>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-muted text-foreground/60">
              <Users className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Atender contatos sem lead</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {data.attendUnknownContacts
                  ? "IA responde qualquer número que mandar mensagem"
                  : "IA só responde números que já são lead no sistema"}
              </p>
            </div>
          </div>
          <Switch
            checked={data.attendUnknownContacts}
            onCheckedChange={(v) => onChange({ attendUnknownContacts: v })}
          />
        </div>
      </div>
    </div>
  );
}
