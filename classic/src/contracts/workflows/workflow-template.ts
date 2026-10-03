/**
 * Contrato do template de workflow.
 *
 * Vive fora de `modules/workflows` porque dois bounded contexts o consomem: a
 * UI de Automações (workflows) e o provisionamento de organização (identity,
 * que semeia os funis padrão ao criar uma org). Enquanto a interface morava
 * dentro de `components/WorkflowTemplates.tsx`, o arquivo de dados importava um
 * COMPONENTE só para tipar um array — e isso fechava ciclo entre os módulos.
 *
 * Forma espelha a tabela `workflows` (id/name/description/category/definition/
 * tags/popularity/is_system). `definition` fica como `Record<string, unknown>`
 * de propósito: o grafo do DAG é validado no executor, não aqui.
 */
export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string;
  definition: Record<string, unknown>;
  tags: string[];
  popularity: number;
  is_system: boolean;
}
