/**
 * As preferências de entrega de Aviso, resolvidas contra os padrões.
 *
 * Uma regra atravessa este arquivo inteiro: **preferência corta entrega, nunca
 * registro**. Nada aqui decide se um Aviso é gravado — só se ele toca, aparece
 * na tela ou viaja para o celular. Um histórico com buracos torna "não recebi"
 * impossível de investigar.
 *
 * Os padrões vivem no código, não no banco: tipo novo de Aviso nasce com
 * comportamento definido sem migration, e quem nunca abriu a tela de
 * preferências não fica sem entrega.
 */

export interface PreferenciasDeAviso {
  sound_enabled: boolean;
  volume: number;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  mute_active_conversation: boolean;
  push_enabled: boolean;
  overrides: Record<string, EntregaDoTipo>;
}

export interface EntregaDoTipo {
  som?: boolean;
  tela?: boolean;
  push?: boolean;
}

export const PADROES: PreferenciasDeAviso = {
  sound_enabled: true,
  volume: 55,
  quiet_hours_start: null,
  quiet_hours_end: null,
  mute_active_conversation: true,
  push_enabled: false,
  overrides: {},
};

/** Nasce ligado: uma entrega que só existe depois de configurada nunca acontece. */
const ENTREGA_PADRAO: Required<EntregaDoTipo> = { som: true, tela: true, push: true };

export function resolverPreferencias(
  linha: Partial<PreferenciasDeAviso> | null | undefined,
): PreferenciasDeAviso {
  if (!linha) return { ...PADROES };
  return {
    ...PADROES,
    ...Object.fromEntries(Object.entries(linha).filter(([, v]) => v !== undefined && v !== null)),
    // quiet hours são legitimamente nulos — o filtro acima os descartaria
    quiet_hours_start: linha.quiet_hours_start ?? PADROES.quiet_hours_start,
    quiet_hours_end: linha.quiet_hours_end ?? PADROES.quiet_hours_end,
    overrides: linha.overrides ?? {},
  } as PreferenciasDeAviso;
}

/**
 * O que este tipo de Aviso pode fazer, com o mestre mandando no específico:
 * quem desligou o som inteiro não é acordado por um tipo que pediu som.
 */
export function entregaDoTipo(
  preferencias: PreferenciasDeAviso,
  tipo: string,
): Required<EntregaDoTipo> {
  const doTipo = preferencias.overrides[tipo] ?? {};
  return {
    som: preferencias.sound_enabled && (doTipo.som ?? ENTREGA_PADRAO.som),
    tela: doTipo.tela ?? ENTREGA_PADRAO.tela,
    push: preferencias.push_enabled && (doTipo.push ?? ENTREGA_PADRAO.push),
  };
}
