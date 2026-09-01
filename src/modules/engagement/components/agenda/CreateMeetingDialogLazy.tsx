/**
 * Fronteira PREGUIÇOSA do diálogo de criar reunião — é esta que sai no barrel.
 *
 * ── Por que existe ────────────────────────────────────────────────────────
 * `CreateMeetingDialog` puxa `LeadPorFunilPicker`, que importa
 * `@/modules/pipelines` e `@/modules/leads`. Exportar o diálogo direto no
 * barrel colava essas DUAS árvores no grafo estático de qualquer arquivo que
 * tocasse `@/modules/engagement` — inclusive quem só queria `useAwards`.
 *
 * Não é custo teórico. Três suítes de teste pararam de coletar no ato
 * (`hooks-batch-2`, `hooks-batch-6`, `hooks-final-small`), com
 * `No "useAllPipelineStageOptions" export is defined on the ... mock`: o
 * barrel de `pipelines` reexporta um módulo que elas dublam parcialmente, e o
 * dublê não tinha por que conhecer um símbolo que ninguém pedia até agora. O
 * teste foi o mensageiro; o peso no grafo é o defeito.
 *
 * ── O que isto faz ────────────────────────────────────────────────────────
 * O import vira dinâmico, então nada da árvore pesada entra no grafo até
 * alguém ABRIR o diálogo. `open === false` nem monta o `Suspense` — o caso
 * comum de um card de kanban é não abrir nunca, e aí o custo é zero.
 *
 * `fallback={null}`: o gatilho é um clique de menu, o chunk é pequeno e um
 * esqueleto piscando atrás de um modal que ainda não existe é pior que nada.
 */
import { Suspense, lazy } from "react";
import type { ComponentProps } from "react";
import type { CreateMeetingDialog as DialogReal } from "./CreateMeetingDialog";

const Real = lazy(() =>
  import("./CreateMeetingDialog").then((m) => ({ default: m.CreateMeetingDialog })),
);

type Props = ComponentProps<typeof DialogReal>;

export function CreateMeetingDialog(props: Props) {
  // Fechado não carrega nada. É o estado da esmagadora maioria dos cards.
  if (!props.open) return null;
  return (
    <Suspense fallback={null}>
      <Real {...props} />
    </Suspense>
  );
}
