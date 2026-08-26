/**
 * TemplateEscolhido — o Template aprovado que o Disparo pelo Canal Oficial envia.
 *
 * Mora em `src/shared/` e não no wizard (#1846). Ele é o contrato entre DUAS
 * pontas que não podem se importar: o wizard, que escolhe o Template
 * (`disparo-wizard/wizard-machine`), e a fila, que o persiste em
 * `blast_plans.template` (`campaigns/hooks/useBlastPlans`). Enquanto o tipo
 * morava no wizard, `useBlastPlans` importava dele — e como o barrel de
 * `campaigns` publica `useBlastPlans`, essa aresta fechava o ciclo
 * campaigns ↔ pipelines que o `Dep-cruise ratchet` reprovava no PR #1811:
 *
 *   pipelines/…/DisparoWizard → campaigns/index → useBlastPlans → wizard-machine
 *     → audience-resolve → pipelines/index → … → pipelines/…/DisparoWizard
 *
 * `wizard-machine` continua reexportando o tipo, então nenhum passo do wizard
 * mudou de import. Zero dependências aqui, de propósito: é folha do grafo, e
 * folha não participa de ciclo. Mantenha assim.
 */

/** O Template aprovado escolhido no passo de conteúdo (Canal Oficial). */
export interface TemplateEscolhido {
  name: string;
  language: string;
  components: unknown[];
  /** O corpo renderizado — é o que vai para `blast_plans.message`. */
  previewText: string;
  buttonLabels: string[];
}
