/**
 * Module cobranca — API pública (ADR-0040).
 *
 * Bounded context da cobrança de inadimplência: inadimplente, título, caso,
 * compromisso, pagamento. Não depende de leads nem de pipelines, e nada fora
 * daqui lê as tabelas `cobranca_*` (métricas isoladas por construção).
 *
 * Pages NÃO são re-exportadas — App.tsx faz deep-import via React.lazy:
 *   @/modules/cobranca/pages/Inadimplentes
 *   @/modules/cobranca/pages/FluxoDeCobranca
 */

export { CobrancaRoute } from "./components/CobrancaRoute";
export { FLAG_COBRANCA, useCobrancaAcesso } from "./hooks/useCobrancaAcesso";
export type { AcessoCobranca } from "./hooks/useCobrancaAcesso";
