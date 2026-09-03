/**
 * O slot do botão de LIGAR para um lead — injetado pela raiz, consumido pelos
 * cards.
 *
 * Este arquivo exporta SÓ o Provider, de propósito: o contexto, os tipos e o
 * hook `useLeadCallAction` moram em `lead-call-action-context.ts`. Misturar os
 * dois aqui quebra o fast refresh (react-refresh/only-export-components), e o
 * aviso é real — editar o hook remontaria a árvore inteira sob o Provider.
 *
 * O porquê da inversão de dependência está documentado no arquivo do contrato.
 */
import { LeadCallActionContext } from "./lead-call-action-context";

export const LeadCallActionProvider = LeadCallActionContext.Provider;
