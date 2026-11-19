/**
 * Régua de espera (CX ①) — a API pública das primitivas.
 * Mockup aprovado: .specs/cx/regua-de-espera-mockup.html
 */
export { REGUA, deveNarrar, useFaseEspera, type FaseEspera } from "./regua";
export { Espera, type EsperaProps } from "./Espera";
export { Osso } from "./Osso";
export {
  TrabalhoNarrado,
  type FaseNarrada,
  type ProgressoNarrado,
  type TrabalhoNarradoProps,
} from "./TrabalhoNarrado";
export { useAcaoOtimista, AlvoRaizError, type AcaoOtimista } from "./useAcaoOtimista";
export { estimarRestanteMs } from "./estimativa";
export { useIntencao, type HandlersDeIntencao } from "./useIntencao";
export { useSegurarEsqueleto } from "./useSegurarEsqueleto";
