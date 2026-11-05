import { lazy, Suspense, useEffect, useState } from "react";
import { lazyRetry } from "@/core/stale-build-recovery";
import { useAuth, useCurrentTeamMember } from "@/modules/identity";
import { useBoasVindasSemana } from "../../hooks/useBoasVindasSemana";
import type { ResumoSemana } from "../../lib/boas-vindas-semana";

/**
 * Quando a abertura de segunda-feira entra em cena.
 *
 * Quem decide SE é o banco (uma vez por usuário por semana, só na segunda, só
 * com dado) e o hook (só quem pode ver Métricas). Este gate decide QUANDO e COMO:
 *
 *   · espera o `TorqueIntro` — que cobre a tela por ~3,25 s ao carregar o app,
 *     por cima desta camada (z-200 contra z-190). Começar a sequência embaixo
 *     dele gastaria os primeiros segundos de uma peça de 42 s sem ninguém ver;
 *   · carrega a animação em chunk à parte: ela e o `framer-motion` das telas só
 *     descem em 1 de cada 7 dias, para quem de fato vai vê-la;
 *   · guarda o resumo no estado. O cache do hook é eterno, mas a abertura que
 *     está tocando não pode depender dele para continuar na tela.
 */

const BoasVindasSemana = lazy(() =>
  lazyRetry(() =>
    import("./BoasVindasSemana").then((m) => ({ default: m.BoasVindasSemana })),
  ),
);

/** O `TorqueIntro` dura 3250 ms; a folga cobre o fade de saída dele. */
const ESPERA_DO_INTRO_MS = 3_500;

export function BoasVindasSemanaGate() {
  const { user } = useAuth();
  const { data: membro } = useCurrentTeamMember();
  const { data } = useBoasVindasSemana();
  const [resumo, setResumo] = useState<ResumoSemana | null>(null);
  const [introPassou, setIntroPassou] = useState(false);
  const [concluida, setConcluida] = useState(false);

  useEffect(() => {
    if (data && !resumo) setResumo(data);
  }, [data, resumo]);

  // Conta a partir da abertura da PÁGINA, não do componente: se o app já está de
  // pé há tempo (login numa sessão aberta), não há intro e a espera é zero.
  useEffect(() => {
    const falta = Math.max(0, ESPERA_DO_INTRO_MS - performance.now());
    const t = window.setTimeout(() => setIntroPassou(true), falta);
    return () => window.clearTimeout(t);
  }, []);

  if (!resumo || !introPassou || concluida) return null;

  const nome =
    membro?.name?.trim() ||
    (user?.user_metadata?.full_name as string | undefined)?.trim() ||
    user?.email?.split("@")[0] ||
    "";

  return (
    <Suspense fallback={null}>
      <BoasVindasSemana nome={nome} resumo={resumo} onConcluir={() => setConcluida(true)} />
    </Suspense>
  );
}
