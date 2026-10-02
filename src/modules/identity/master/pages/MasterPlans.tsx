/**
 * Página de gerenciamento de planos pelo Master
 * Redesign: grid de cards → clica para abrir editor visual com tabs
 */

import { useState } from "react";
import { Check, X, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMasterPlans, type Plan } from "../hooks/useMasterPlans";
import { PlanEditor } from "../components/PlanEditor";

export default function MasterPlans() {
  const { data: plans, isLoading } = useMasterPlans();
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

  const countEnabledFeatures = (features: Record<string, boolean>) =>
    Object.values(features).filter(Boolean).length;

  // ─── Editor view ──────────────────────────────────────
  if (selectedPlan) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          {/* Voltar é estado local (fecha o editor), não rota — por isso não usa o `back` do PageHeader. */}
          <Button
            variant="outline"
            size="icon"
            className="shrink-0 rounded-full"
            aria-label="Voltar"
            onClick={() => setSelectedPlan(null)}
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <PageHeader
            className="min-w-0 flex-1"
            title="Editar Plano"
            subtitle="Configure features, limites e preços"
          />
        </div>
        {/* O editor é um formulário solto: na bancada com grade ele precisa de cartão. */}
        <Card className="p-5">
          <PlanEditor
            plan={selectedPlan}
            onClose={() => setSelectedPlan(null)}
          />
        </Card>
      </div>
    );
  }

  // ─── Grid view ────────────────────────────────────────
  return (
    <div className="space-y-5">
      <PageHeader
        title="Planos de Assinatura"
        subtitle="Gerencie os planos disponíveis no sistema. Clique em um plano para editar."
      />

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          <div className="col-span-4 text-center py-8 text-muted-foreground">
            Carregando...
          </div>
        ) : (
          plans?.map((plan) => (
            <Card
              key={plan.id}
              className={`cursor-pointer transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-relevo-alto motion-reduce:transition-none ${
                !plan.is_active ? "opacity-60" : ""
              }`}
              onClick={() => setSelectedPlan(plan)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle>{plan.display_name}</CardTitle>
                    <p className="text-sm text-muted-foreground">{plan.name}</p>
                  </div>
                  <div className="flex gap-1">
                    {plan.is_default && (
                      <Badge variant="outline" className="text-xs">Padrão</Badge>
                    )}
                    {!plan.is_active && (
                      <Badge variant="soft" className="text-xs">Inativo</Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Prices */}
                <div>
                  <p className="text-[1.65rem] font-extrabold leading-[1.05] tracking-[-0.04em] tabular-nums">
                    {formatCurrency(plan.price_monthly)}
                    <span className="ml-0.5 text-sm font-semibold tracking-normal text-muted-foreground">/mês</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    ou {formatCurrency(plan.price_yearly)}/ano
                  </p>
                </div>

                {/* Description */}
                {plan.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">{plan.description}</p>
                )}

                {/* Summary */}
                <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-3">
                  <span>{countEnabledFeatures(plan.features)} features ativas</span>
                  <span>
                    {Object.entries(plan.limits)
                      .filter(([, v]) => v === -1).length > 0
                      ? "Com ilimitados"
                      : `${Object.keys(plan.limits).length} limites`}
                  </span>
                </div>

                {/* Features preview */}
                <div className="flex flex-wrap gap-1">
                  {Object.entries(plan.features)
                    .slice(0, 6)
                    .map(([key, value]) => (
                      <Badge
                        key={key}
                        variant={value ? "success" : "soft"}
                        className="text-xs"
                      >
                        {value ? (
                          <Check className="w-3 h-3 mr-1" />
                        ) : (
                          <X className="w-3 h-3 mr-1" />
                        )}
                        {key.replace(/_/g, " ")}
                      </Badge>
                    ))}
                  {Object.keys(plan.features).length > 6 && (
                    <Badge variant="outline" className="text-xs">
                      +{Object.keys(plan.features).length - 6}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
