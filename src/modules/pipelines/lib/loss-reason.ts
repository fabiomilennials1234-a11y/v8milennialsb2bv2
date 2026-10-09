/**
 * Motivo da perda — a regra mora em `@/contracts/pipe/perda` desde que o
 * diálogo virou porta única (LossReasonGate, em `leads`): `leads` não importa
 * `pipelines` (PipeOpsPort), então a regra pura desceu para `contracts`.
 * Este arquivo segue como endereço estável dos consumidores de `pipelines`.
 */
export {
  ETAPA_DE_PERDA_INDISPONIVEL,
  exigeTextoLivre,
  isEtapaDePerda,
  primeiraEtapaSemPerda,
  MINIMO_DO_TEXTO_LIVRE,
  MOTIVOS_DE_PERDA_FALLBACK,
  patchDaPerda,
  resolverMotivoDaPerda,
  type EtapaComPapelDePerda,
  type MotivoDePerda,
  type PatchDaPerda,
  type PerdaResolvida,
} from "@/contracts/pipe/perda";
