/**
 * SendWindowSettings — janela de horário para ENVIOS AUTOMÁTICOS da org.
 *
 * Problema (feedback Sorvfoods, 2026-07-14): automações (copilot, workflow,
 * campanha, disparo) mandavam texto/áudio 2h-3h da madrugada. Aqui o admin
 * define o horário permitido; fora dele o envio automático é ADIADO p/ a
 * próxima abertura. Envio MANUAL de humano nunca é afetado.
 *
 * Persistência: UPDATE direto em `organizations` (mesma superfície de
 * useAutoCreateLeadSetting — RLS de UPDATE libera admin). Resiliente a coluna
 * ausente (migration pendente no ambiente) → renderiza desabilitado sem quebrar.
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const QUERY_KEY = "org-send-window" as const;

// 0=domingo … 6=sábado (convenção JS, idêntica ao guard no backend).
const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

interface SendWindowRow {
  enabled: boolean;
  fromMinutes: number;
  toMinutes: number;
  days: number[];
  unavailable: boolean;
}

function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map((x) => parseInt(x, 10));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

export function SendWindowSettings() {
  const { organizationId, isReady } = useOrganization();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [QUERY_KEY, organizationId],
    queryFn: async (): Promise<SendWindowRow> => {
      if (!organizationId) {
        return { enabled: true, fromMinutes: 480, toMinutes: 1260, days: ALL_DAYS, unavailable: false };
      }
      const { data, error } = await supabase
        .from("organizations")
        .select(
          "auto_send_window_enabled, auto_send_window_from_minutes, auto_send_window_to_minutes, auto_send_window_days",
        )
        .eq("id", organizationId)
        .single();

      if (error) {
        if (error.code === "PGRST116" || error.message?.includes("column")) {
          return { enabled: true, fromMinutes: 480, toMinutes: 1260, days: ALL_DAYS, unavailable: true };
        }
        throw error;
      }

      const row = data as Record<string, unknown>;
      return {
        enabled: row.auto_send_window_enabled !== false,
        fromMinutes: (row.auto_send_window_from_minutes as number) ?? 480,
        toMinutes: (row.auto_send_window_to_minutes as number) ?? 1260,
        days: Array.isArray(row.auto_send_window_days)
          ? (row.auto_send_window_days as number[])
          : ALL_DAYS,
        unavailable: false,
      };
    },
    enabled: isReady && !!organizationId,
    retry: 1,
  });

  // Estado de edição local, semeado pela query.
  const [enabled, setEnabled] = useState(true);
  const [fromHHMM, setFromHHMM] = useState("08:00");
  const [toHHMM, setToHHMM] = useState("21:00");
  const [days, setDays] = useState<number[]>(ALL_DAYS);

  useEffect(() => {
    if (query.data) {
      setEnabled(query.data.enabled);
      setFromHHMM(minutesToHHMM(query.data.fromMinutes));
      setToHHMM(minutesToHHMM(query.data.toMinutes));
      setDays(query.data.days);
    }
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("Sem organização");
      const from = hhmmToMinutes(fromHHMM);
      const to = hhmmToMinutes(toHHMM);
      if (from >= to) throw new Error("O horário de início deve ser antes do fim.");
      if (days.length === 0) throw new Error("Selecione ao menos um dia.");
      const { error } = await supabase
        .from("organizations")
        .update({
          auto_send_window_enabled: enabled,
          auto_send_window_from_minutes: from,
          auto_send_window_to_minutes: to,
          auto_send_window_days: [...days].sort((a, b) => a - b),
        })
        .eq("id", organizationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, organizationId] });
      toast.success("Janela de envio automático salva.");
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    },
  });

  const unavailable = query.isError || query.data?.unavailable === true;

  const toggleDay = (d: number) => {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Janela de envio automático</CardTitle>
        </div>
        <CardDescription>
          Mensagens de automação (copilot, fluxos, campanhas e disparos) só saem dentro deste horário.
          Fora dele, o envio é adiado para a próxima abertura — nada é perdido. Envio manual pela equipe
          nunca é afetado. Horário no fuso da organização.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {unavailable && (
          <p className="text-sm text-amber-500">
            Configuração indisponível neste ambiente (migração pendente). Os controles abaixo ficam
            desabilitados até a coluna existir.
          </p>
        )}

        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label>Restringir horário dos envios automáticos</Label>
            <p className="text-sm text-muted-foreground">
              Desligado = automações podem enviar a qualquer hora (inclusive de madrugada).
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={unavailable} />
        </div>

        <div className={cn("space-y-4", (!enabled || unavailable) && "pointer-events-none opacity-50")}>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="send-window-from">Início</Label>
              <Input
                id="send-window-from"
                type="time"
                value={fromHHMM}
                onChange={(e) => setFromHHMM(e.target.value)}
                disabled={unavailable}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="send-window-to">Fim</Label>
              <Input
                id="send-window-to"
                type="time"
                value={toHHMM}
                onChange={(e) => setToHHMM(e.target.value)}
                disabled={unavailable}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Dias permitidos</Label>
            <div className="flex flex-wrap gap-2">
              {DAY_LABELS.map((label, d) => {
                const active = days.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(d)}
                    disabled={unavailable}
                    className={cn(
                      "h-9 w-11 rounded-md border text-sm font-medium transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-muted",
                    )}
                    aria-pressed={active}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={() => mutation.mutate()}
            disabled={unavailable || mutation.isPending || query.isLoading}
          >
            {mutation.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
