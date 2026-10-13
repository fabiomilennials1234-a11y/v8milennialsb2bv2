/**
 * Endereço estável de `patchEntryMetadata` para `pipelines`. A implementação
 * desceu para a infra (`@/integrations/supabase/entry-metadata`) quando `leads`
 * passou a gravar o motivo da perda pela mesma escrita — `leads` não importa
 * `pipelines` (PipeOpsPort).
 */
export { patchEntryMetadata } from "@/integrations/supabase/entry-metadata";
