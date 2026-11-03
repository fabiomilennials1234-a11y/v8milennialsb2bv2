/**
 * Selo "Novo" da lateral: aparece enquanto a novidade está no prazo e o usuário ainda não abriu a tela.
 * Pura; o "já vi" mora em `useNovidadeVista` (localStorage, por navegador).
 */
import type { NavNode } from "./navigation-model";

/** Hoje em AAAA-MM-DD no fuso local (o prazo é de calendário, não de instante). */
export function hojeLocal(agora: Date = new Date()): string {
  const mm = String(agora.getMonth() + 1).padStart(2, "0");
  const dd = String(agora.getDate()).padStart(2, "0");
  return `${agora.getFullYear()}-${mm}-${dd}`;
}

/** A novidade do item ainda vale? Prazo inclusivo; data ilegível não mostra (na dúvida, silêncio). */
export function novidadeNoPrazo(item: Pick<NavNode, "novo">, hoje: string = hojeLocal()): boolean {
  const ate = item.novo?.ate;
  if (!ate || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) return false;
  return hoje <= ate;
}
