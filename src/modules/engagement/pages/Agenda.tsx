/**
 * Rota `/agenda`.
 *
 * No desktop a Agenda abre como painel sobreposto pelo botão da lateral
 * (`AgendaPanel`), deixando a página de baixo à mostra. Esta rota continua
 * existindo porque o painel não atende todo mundo:
 *
 * - **celular** — não há lateral (`MainLayout` só monta a `Sidebar` no
 *   desktop) e um painel de 65% da largura não deixaria sliver nenhum; quem
 *   leva o usuário aqui é o `MobileBottomNav`;
 * - **paleta de comandos e link direto** — `/agenda` é um destino que já
 *   circula;
 * - **guarda mecânica** — `tests/unit/nav-paths-tem-rota.test.ts` reprova se
 *   um caminho do modelo de navegação ficar sem rota, e `SIDEBAR_AGENDA` segue
 *   apontando para cá.
 *
 * É a MESMA tela do painel, não uma segunda implementação.
 */

import { AgendaAtividades } from "@/modules/engagement/components/agenda/AgendaAtividades";

export default function Agenda() {
  return <AgendaAtividades />;
}
