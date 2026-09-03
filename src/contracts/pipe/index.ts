/**
 * Contracts — pipe.
 *
 * Camada `contracts`: símbolos puros compartilhados entre bounded contexts,
 * sem dependência de domínio. Quebra o acoplamento de import direto
 * `leads → pipelines/hooks/*` na inversão de dependência (arch-deepening Fase 7).
 */
export * from "./pipe-status";
export * from "./pipe-defaults";
export * from "./pipe-columns";
export * from "./pipe-entities";
export * from "./kanban";
export * from "./nome-do-funil";
export * from "./funil-de-vendas";
