/**
 * Navegação da área de cobrança — Inadimplentes · Fluxo de Cobrança.
 * São rotas; a pílula só troca de rota (mesmo molde de AutomacoesTabs).
 */
import { useNavigate } from "react-router-dom";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type AbaDaCobranca = "inadimplentes" | "fluxo";

const ROTA_DA_ABA: Record<AbaDaCobranca, string> = {
  inadimplentes: "/cobranca/inadimplentes",
  fluxo: "/cobranca/fluxo",
};

export function CobrancaTabs({ ativa, abertos }: { ativa: AbaDaCobranca; abertos?: number }) {
  const navigate = useNavigate();
  return (
    <Tabs value={ativa} onValueChange={(v) => v !== ativa && navigate(ROTA_DA_ABA[v as AbaDaCobranca])}>
      <TabsList variant="pill" aria-label="Seções da cobrança">
        <TabsTrigger value="inadimplentes">
          Inadimplentes
          {abertos != null && <span className="text-[11px] font-bold tabular-nums opacity-70">{abertos}</span>}
        </TabsTrigger>
        <TabsTrigger value="fluxo">Fluxo de Cobrança</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
