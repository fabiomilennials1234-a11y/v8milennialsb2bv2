/**
 * Página de gerenciamento de planos pelo Master
 * Redesign: grid de cards → clica para abrir editor visual com tabs
 */

import { useState } from "react";
import { CreditCard, Check, X, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMasterPlans, type Plan } from "../../hooks/useMasterPlans";
import { PlanEditor } from "../../components/master/PlanEditor";

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
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setSelectedPlan(null)}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CreditCard className="w-6 h-6" />
              Editar Plano
            </h1>
            <p className="text-muted-foreground">
              Configure features, limites e preços
            </p>
          </div>
        </div>
        <PlanEditor
          plan={selectedPlan}
          onClose={() => setSelectedPlan(null)}
        />
      </div>
    );
  }

  // ─── Grid view ────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CreditCard className="w-6 h-6" />
          Planos de Assinatura
        </h1>
        <p className="text-muted-foreground">
          Gerencie os planos disponíveis no sistema. Clique em um plano para editar.
        </p>
      </div>

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
              className={`cursor-pointer hover:border-primary/50 transition-colors ${
                !plan.is_active ? "opacity-60" : ""
              }`}
              onClick={() => setSelectedPlan(plan)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{plan.display_name}</CardTitle>
                    <p className="text-sm text-muted-foreground">{plan.name}</p>
                  </div>
                  <div className="flex gap-1">
                    {plan.is_default && (
                      <Badge variant="outline" className="text-xs">Padrão</Badge>
                    )}
                    {!plan.is_active && (
                      <Badge variant="secondary" className="text-xs">Inativo</Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Prices */}
                <div>
                  <p className="text-2xl font-bold">
                    {formatCurrency(plan.price_monthly)}
                    <span className="text-sm font-normal text-muted-foreground">/mês</span>
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
                        variant={value ? "default" : "secondary"}
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
