import { User } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "De quem é esta linha", na densidade do Comando.
 *
 * Só aparece para admin — para o vendedor a lista inteira já é dele, e repetir
 * o próprio nome em cada linha seria ruído. É a mesma decisão que o
 * `CardMetas` toma ao degradar de "o time" para "a minha".
 *
 * ─── Por que texto, e não avatar ────────────────────────────────────────────
 *
 * O `dashboard/v2` não usa `UserAvatar` em lugar nenhum — tem três cópias
 * locais de `initials()` (TeamActivityCard, IndividualGoalsList,
 * RankingPodium) e nenhuma decisão registrada sobre qual idioma vale. Além
 * disso há DUAS fontes de foto concorrentes no produto (`profiles.avatar_url`
 * via `useAvatarMap` e `team_members.avatar_url` direto), também sem decisão.
 *
 * Trazer avatar para cá exigiria resolver as duas coisas de passagem, numa
 * fatia que é sobre permissão. Texto curto responde à pergunta do pedido
 * ("identificar claramente qual usuário é responsável") sem abrir esse
 * capítulo, e casa com o selo de instância que a linha de conversa já usa.
 */
export function DonoDaLinha({
  nome,
  className,
  semDonoLabel = "Sem responsável",
}: {
  nome: string | null | undefined;
  className?: string;
  /** O texto de órfão muda por bloco: "Sem responsável" / "Sem dono". */
  semDonoLabel?: string;
}) {
  const orfao = !nome;

  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1 text-[10px]",
        // Órfão é informação, não erro: fica mais apagado ainda, mas legível.
        orfao ? "text-muted-foreground/45 italic" : "text-muted-foreground/60",
        className,
      )}
      title={orfao ? "Ninguém responde por este item" : `Responsável: ${nome}`}
    >
      <User className="h-2.5 w-2.5 shrink-0" aria-hidden />
      <span className="truncate">{orfao ? semDonoLabel : nome}</span>
    </span>
  );
}
