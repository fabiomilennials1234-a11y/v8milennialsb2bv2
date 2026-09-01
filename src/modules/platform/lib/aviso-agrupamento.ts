/**
 * Como o sino organiza o que mostra: por família e por tempo.
 *
 * Família é recorte de leitura, não de modelo — o vendedor procura "o que os
 * leads falaram" ou "o que quebrou", não `lead_message` nem `workflow_alert`.
 * Tipo que ainda não existe cai em Sistema em vez de sumir da lista: um Aviso
 * invisível é pior que um Aviso mal classificado.
 */

import { instanteDoAviso, type Aviso } from "./aviso-stream";

export type Familia = "tudo" | "mensagens" | "leads" | "agenda" | "sistema";

export const FAMILIAS: { chave: Familia; rotulo: string }[] = [
  { chave: "tudo", rotulo: "Tudo" },
  { chave: "mensagens", rotulo: "Mensagens" },
  { chave: "leads", rotulo: "Leads" },
  { chave: "agenda", rotulo: "Agenda" },
  { chave: "sistema", rotulo: "Sistema" },
];

const POR_TIPO: Record<string, Exclude<Familia, "tudo">> = {
  lead_message: "mensagens",
  transfer_to_human: "mensagens",
  lead_new: "leads",
  meeting_booked: "agenda",
  meeting_soon: "agenda",
  follow_up_due: "agenda",
  follow_up_overdue: "agenda",
  workflow_alert: "sistema",
  cron_drift: "sistema",
};

export function familiaDoAviso(tipo: string): Exclude<Familia, "tudo"> {
  return POR_TIPO[tipo] ?? "sistema";
}

export function contarPorFamilia(avisos: Aviso[]): Record<Familia, number> {
  const contagem: Record<Familia, number> = {
    tudo: avisos.length,
    mensagens: 0,
    leads: 0,
    agenda: 0,
    sistema: 0,
  };
  for (const aviso of avisos) {
    contagem[familiaDoAviso(aviso.type)] += 1;
  }
  return contagem;
}

export function filtrarPorFamilia(avisos: Aviso[], familia: Familia): Aviso[] {
  if (familia === "tudo") return avisos;
  return avisos.filter((a) => familiaDoAviso(a.type) === familia);
}

export interface GrupoDeAvisos {
  rotulo: string;
  avisos: Aviso[];
}

const UMA_HORA = 60 * 60_000;

/**
 * Agrupa por tempo para que a ordem conte uma história sem obrigar ninguém a
 * ler data: o que acabou de acontecer, o que é de hoje, e o resto.
 *
 * O instante entra por parâmetro — teste de tempo com relógio real é teste que
 * falha sozinho de madrugada.
 */
export function agruparPorTempo(avisos: Aviso[], agora: Date): GrupoDeAvisos[] {
  const limiteAgora = agora.getTime() - UMA_HORA;
  const inicioDoDia = new Date(agora);
  inicioDoDia.setHours(0, 0, 0, 0);

  const grupos: GrupoDeAvisos[] = [
    { rotulo: "Agora", avisos: [] },
    { rotulo: "Hoje", avisos: [] },
    { rotulo: "Antes", avisos: [] },
  ];

  for (const aviso of avisos) {
    const instante = instanteDoAviso(aviso);
    if (instante >= limiteAgora) grupos[0].avisos.push(aviso);
    else if (instante >= inicioDoDia.getTime()) grupos[1].avisos.push(aviso);
    else grupos[2].avisos.push(aviso);
  }

  return grupos.filter((g) => g.avisos.length > 0);
}
