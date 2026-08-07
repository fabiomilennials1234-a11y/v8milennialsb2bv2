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

export function MasterOnlineIndicator() {
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

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5 px-2.5 border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
      onClick={() => navigate("/master/usuarios-ativos")}
      title={
        hasOnline
          ? `${online} usuário(s) com atividade na última hora — ver por cliente`
          : "Usuários ativos por cliente"
      }
      aria-label={`Usuários ativos: ${label}`}
    >
      <span className="relative flex h-2 w-2" aria-hidden>
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
      <span className="text-xs font-medium tabular-nums">{label}</span>
    </Button>
  );
}
