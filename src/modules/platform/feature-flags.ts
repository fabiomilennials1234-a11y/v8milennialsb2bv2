/** API pública de flags, sem carregar os painéis e diálogos da plataforma. */
export { useFeatureFlag, type FeatureFlagResult } from "./hooks/useFeatureFlag";
export {
  FLAG_AGENDA_SO_NO_COMANDO,
  ROTA_AGENDA,
  ROTA_COMANDO,
  useAgendaSoNoComando,
  type AgendaSoNoComando,
} from "./hooks/useAgendaSoNoComando";
