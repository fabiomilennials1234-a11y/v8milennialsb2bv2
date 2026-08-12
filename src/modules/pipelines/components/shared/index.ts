/**
 * Sub-barrel — componentes **compartilhados** de configuração e dispatch
 * (Ghost banner, manage stages, dispatch/distribution, settings).
 *
 * Reexportado pela API pública (`../../index.ts`) com os mesmos nomes.
 */
export { AutoCreateLeadToggle } from "./AutoCreateLeadToggle";
export { GhostLeadsBanner } from "./GhostLeadsBanner";
export {
  ManagePipelineStagesContent,
  ManagePipelineStagesModal,
} from "./ManagePipelineStagesModal";
export { PipeDispatchRulesSection } from "./PipeDispatchRulesSection";
export { PipeDistributionSection } from "./PipeDistributionSection";
export { PipeSettingsDialog } from "./PipeSettingsDialog";
