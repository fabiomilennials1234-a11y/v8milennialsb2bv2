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
    <div className="border rounded-lg divide-y">
      {/* ===== Audiencia ===== */}
      <div className="border-b border-border/40">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <Users className="w-4 h-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Atender contatos sem lead</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {data.attendUnknownContacts
                  ? "IA responde qualquer numero que mandar mensagem"
                  : "IA so responde numeros que ja sao lead no sistema"}
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
