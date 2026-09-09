/**
 * Sub-barrel — componentes **compartilhados** de configuração e dispatch
 * (Ghost banner, manage stages, dispatch/distribution, settings).
 *
 * Reexportado pela API pública (`../../index.ts`) com os mesmos nomes.
 */
export { AutoCreateLeadToggle } from "./AutoCreateLeadToggle";
export {
  ManagePipelineStagesContent,
  ManagePipelineStagesModal,
} from "./ManagePipelineStagesModal";
export { PipeDispatchRulesSection } from "./PipeDispatchRulesSection";
export { PipeDistributionSection } from "./PipeDistributionSection";
export { PipeSettingsDialog } from "./PipeSettingsDialog";
export { DeletePipelineDialog } from "./DeletePipelineDialog";
export { FunnelIdentitySection } from "./FunnelIdentitySection";
export { FunnelIdentityDialog } from "./FunnelIdentityDialog";
