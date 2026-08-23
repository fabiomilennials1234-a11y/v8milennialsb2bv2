/**
 * Ping de usuários ativos na barra superior (master-only).
 *
 * Só o sinal: ponto verde pulsando + total de PESSOAS distintas com atividade
 * na última hora, somando todas as organizações. O detalhe por cliente fica em
 * /master/usuarios-ativos, para onde este botão navega.
 *
 * Compartilha a queryKey com a tela detalhada — a barra e a página são um
 * fetch só, não dois.
 *
 * ⚠️ "Ativo" aqui = deu sinal de sessão na última hora (jwt_exp=3600s). Não é
 * presença ao vivo; ver o cabeçalho de useMasterUserActivity.
 */

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useMasterAuth } from "../hooks/useMasterAuth";
import {
  useMasterUserActivity,
  countDistinctOnlineUsers,
} from "../hooks/useMasterUserActivity";

const WINDOW_MINUTES = 60;

export function MasterOnlineIndicator({
  forma = "pilula",
  collapsed = false,
}: {
  /**
   * `pilula` é o botão contornado original. `lateral` é a linha do rodapé da
   * barra — mesmo dado, desenho de item de menu, para conviver com Agenda,
   * Notificações e Ajuda sem parecer enxertado.
   *
   * As duas formas compartilham a MESMA consulta e o mesmo rótulo. Um segundo
   * componente teria duplicado a regra do "—" (que distingue "carregando" e
   * "RPC indisponível" de um zero real), e é assim que as duas telas passam a
   * mostrar números diferentes.
   */
  forma?: "pilula" | "lateral";
  /** Só na forma `lateral`: menu recolhido mostra ícone, com o número no title. */
  collapsed?: boolean;
} = {}) {
  const navigate = useNavigate();
  // isFullMaster, NÃO isMaster: o outbounder tem linha em master_users mas é
  // perfil restrito e não pode ver a frota inteira. Ver useMasterAuth.
  const { isFullMaster } = useMasterAuth();

  const { data: rows, isLoading, isError } = useMasterUserActivity(
    WINDOW_MINUTES,
    { enabled: isFullMaster },
  );

  const online = useMemo(
    () => (rows ? countDistinctOnlineUsers(rows, { includeMasters: false }) : null),
    [rows],
  );

  if (!isFullMaster) return null;

  // Sem número confiável (carregando ou RPC indisponível) o botão continua
  // levando à tela — mas não inventa um "0" que pareceria dado real.
  const label = isLoading ? "…" : isError || online === null ? "—" : String(online);
  const hasOnline = typeof online === "number" && online > 0;

  const titulo = hasOnline
    ? `${online} usuário(s) com atividade na última hora — ver por cliente`
    : "Usuários ativos por cliente";

  const ping = (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
      {hasOnline && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      )}
      <span
        className={
          hasOnline
            ? "relative inline-flex h-2 w-2 rounded-full bg-emerald-500"
            : "relative inline-flex h-2 w-2 rounded-full bg-muted-foreground/40"
        }
      />
    </span>
  );

  if (forma === "lateral") {
    return (
      <button
        type="button"
        onClick={() => navigate("/master/usuarios-ativos")}
        title={titulo}
        aria-label={`Usuários ativos: ${label}`}
        className={[
          "flex w-full items-center gap-3 rounded-lg py-2 text-sm text-sidebar-foreground/70",
          "transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          collapsed ? "justify-center px-0" : "px-2.5",
        ].join(" ")}
      >
        {/* O ping ocupa o lugar do ícone das outras linhas — 17px de caixa para
            o ponto de 8px cair no mesmo eixo vertical de Agenda e Ajuda. */}
        <span className="flex h-[17px] w-[17px] items-center justify-center" aria-hidden>
          {ping}
        </span>
        {!collapsed && (
          <>
            <span className="flex-1 truncate text-left">Ativos agora</span>
            <span className="shrink-0 text-xs font-medium tabular-nums text-emerald-500 dark:text-emerald-400">
              {label}
            </span>
          </>
        )}
      </button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5 px-2.5 border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
      onClick={() => navigate("/master/usuarios-ativos")}
      title={titulo}
      aria-label={`Usuários ativos: ${label}`}
    >
      {ping}
      <span className="text-xs font-medium tabular-nums">{label}</span>
    </Button>
  );
}
