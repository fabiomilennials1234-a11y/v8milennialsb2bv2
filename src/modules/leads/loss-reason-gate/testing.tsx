/* eslint-disable react-refresh/only-export-components -- helper de teste, nunca entra no bundle com HMR */
/**
 * Test helper — porta do motivo da perda sem diálogo.
 *
 * O teste decide a resposta (`perda` ou `null` = cancelou) e inspeciona os
 * pedidos. Para exercitar o DIÁLOGO de verdade, use `LossReasonGateProvider`.
 */
import type { ReactNode } from "react";
import type { PerdaResolvida } from "@/contracts/pipe/perda";
import { LossReasonGateContext, type PedidoDeMotivoDaPerda, type RequestLossReason } from "./useLossReasonGate";

export function makeFakeLossReasonGate(resposta: PerdaResolvida | null = { id: "lr-1", texto: "Sem budget" }) {
  const pedidos: PedidoDeMotivoDaPerda[] = [];
  const request: RequestLossReason = async (pedido = {}) => {
    pedidos.push(pedido);
    return fake.resposta;
  };
  const fake = { request, pedidos, resposta };
  return fake;
}

export function FakeLossReasonGateProvider({
  gate,
  children,
}: {
  gate: { request: RequestLossReason };
  children: ReactNode;
}) {
  return <LossReasonGateContext.Provider value={gate.request}>{children}</LossReasonGateContext.Provider>;
}
