/**
 * Module lista-fria — API pública (ADR-0042).
 *
 * Contatos frios do Instagram e do Google Maps: o cliente informa o alvo, a IA
 * acha telefone e e-mail, paga em créditos e importa o resultado como lead da
 * seção "Lista fria" (sem funil, sem disparo).
 *
 * Atrás da flag `organizations.feature_flags.lista_fria` e das permissões
 * `lista_fria.view` / `lista_fria.edit`. Ligada só na TorqueCRM.
 *
 * Pages NÃO são re-exportadas — App.tsx faz deep-import via React.lazy:
 *   @/modules/lista-fria/pages/RevisarBusca
 *
 * `leads` importa daqui (a aba "Lista fria" mora na tela de Leads); este módulo
 * não importa `leads`. A fronteira entre os dois é a coluna
 * `leads.lista_fria_busca_id`, lida por `ABA_LISTA_FRIA` em `lead-list-filters`.
 */

export { BuscasCard } from "./components/BuscasCard";
export { ListaFriaRoute } from "./components/ListaFriaRoute";
export { NovaBuscaDialog } from "./components/NovaBuscaDialog";
export { FLAG_LISTA_FRIA, useListaFriaAcesso } from "./hooks/useListaFriaAcesso";
export type { AcessoListaFria } from "./hooks/useListaFriaAcesso";
export { useSaldoDeCreditos } from "./hooks/useListaFriaDados";
