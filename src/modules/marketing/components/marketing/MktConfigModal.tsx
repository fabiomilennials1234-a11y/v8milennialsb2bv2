import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Settings2, DollarSign } from "lucide-react";
import {
  ALL_ORIGINS,
  ORIGIN_LABELS,
  ORIGIN_COLORS,
  type MktOriginConfig,
  type LeadOrigin,
  useBatchUpsertMktOriginConfig,
} from "@/modules/analytics/hooks/useMktOriginConfig";
import { toast } from "sonner";

interface OriginFormState {
  investimentoReais: string;
  show_leads: boolean;
  show_agendamentos: boolean;
  show_comparecimentos: boolean;
  show_propostas: boolean;
  show_vendas: boolean;
}

const DEFAULT_STATE: OriginFormState = {
  investimentoReais: "",
  show_leads: true,
  show_agendamentos: true,
  show_comparecimentos: true,
  show_propostas: true,
  show_vendas: true,
};

const METRIC_LABELS: Record<string, string> = {
  show_leads: "Leads",
  show_agendamentos: "Agendamentos",
  show_comparecimentos: "Comparecimentos",
  show_propostas: "Propostas",
  show_vendas: "Vendas",
};

interface MktConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: number;
  year: number;
  configMap: Record<string, MktOriginConfig>;
}

export function MktConfigModal({
  open,
  onOpenChange,
  month,
  year,
  configMap,
}: MktConfigModalProps) {
  const batchUpsert = useBatchUpsertMktOriginConfig();
  const [formState, setFormState] = useState<Record<string, OriginFormState>>({});

  // Initialize form from configMap when modal opens
  useEffect(() => {
    if (!open) return;
    const initial: Record<string, OriginFormState> = {};
    ALL_ORIGINS.forEach((origin) => {
      const config = configMap[origin];
      if (config) {
        initial[origin] = {
          investimentoReais: config.investimento_cents > 0 ? (config.investimento_cents / 100).toString() : "",
          show_leads: config.show_leads,
          show_agendamentos: config.show_agendamentos,
          show_comparecimentos: config.show_comparecimentos,
          show_propostas: config.show_propostas,
          show_vendas: config.show_vendas,
        };
      } else {
        initial[origin] = { ...DEFAULT_STATE };
      }
    });
    setFormState(initial);
  }, [open, configMap]);

  const updateOrigin = (origin: string, patch: Partial<OriginFormState>) => {
    setFormState((prev) => ({
      ...prev,
      [origin]: { ...(prev[origin] ?? DEFAULT_STATE), ...patch },
    }));
  };

  const handleSave = async () => {
    const inputs = ALL_ORIGINS.map((origin) => {
      const state = formState[origin] ?? DEFAULT_STATE;
      const reais = parseFloat(state.investimentoReais.replace(",", ".")) || 0;
      return {
        origin,
        month,
        year,
        investimento_cents: Math.round(reais * 100),
        show_leads: state.show_leads,
        show_agendamentos: state.show_agendamentos,
        show_comparecimentos: state.show_comparecimentos,
        show_propostas: state.show_propostas,
        show_vendas: state.show_vendas,
      };
    });

    try {
      await batchUpsert.mutateAsync(inputs);
      toast.success("Configurações salvas");
      onOpenChange(false);
    } catch {
      // Error handled by mutation onError
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-primary" />
            Configuração de Marketing
          </DialogTitle>
          <DialogDescription>
            Configure o investimento e métricas visíveis para cada origem de lead.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {ALL_ORIGINS.map((origin) => {
            const state = formState[origin] ?? DEFAULT_STATE;
            const color = ORIGIN_COLORS[origin as LeadOrigin];
            const label = ORIGIN_LABELS[origin as LeadOrigin];

            return (
              <div
                key={origin}
                className="rounded-xl border border-border p-4 space-y-3"
              >
                {/* Origin header + investment */}
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="font-medium text-sm flex-1">{label}</span>
                  <div className="flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder="0,00"
                      className="w-28 h-8 text-sm"
                      value={state.investimentoReais}
                      onChange={(e) =>
                        updateOrigin(origin, { investimentoReais: e.target.value })
                      }
                    />
                  </div>
                </div>

                {/* Metric toggles */}
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {(Object.keys(METRIC_LABELS) as Array<keyof typeof METRIC_LABELS>).map(
                    (key) => (
                      <label
                        key={key}
                        className="flex items-center gap-1.5 cursor-pointer"
                      >
                        <Switch
                          checked={state[key as keyof OriginFormState] as boolean}
                          onCheckedChange={(checked) =>
                            updateOrigin(origin, { [key]: checked })
                          }
                          className="scale-75"
                        />
                        <span className="text-xs text-muted-foreground">
                          {METRIC_LABELS[key]}
                        </span>
                      </label>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={batchUpsert.isPending}>
            {batchUpsert.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
