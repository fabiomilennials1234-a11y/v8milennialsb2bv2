/**
 * Master → Usuários: quem está usando o sistema, cliente por cliente.
 *
 * Lista de cima para baixo: um bloco por organização, cada membro com um ponto
 * verde (ativo na janela) ou cinza (sem sinal).
 *
 * ⚠️ HONESTIDADE DO RÓTULO: o sinal vem de `auth.sessions` e só se move a cada
 * ~58min (jwt_exp=3600). Não é "online agora" — é "deu sinal na última hora".
 * A tela diz isso explicitamente; não trocar por "online" sem trocar a fonte.
 */

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Users,
  Search,
  RefreshCw,
  AlertTriangle,
  Info,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useMasterAuth } from "../hooks/useMasterAuth";
import {
  useMasterUserActivity,
  groupByOrg,
  countDistinctOnlineUsers,
  countDistinctUsers,
  isMissingRpcError,
  isAccessDeniedError,
  type OrgActivityGroup,
} from "../hooks/useMasterUserActivity";

const WINDOW_OPTIONS = [
  { value: "60", label: "Última hora" },
  { value: "180", label: "Últimas 3 horas" },
  { value: "1440", label: "Últimas 24 horas" },
  { value: "10080", label: "Últimos 7 dias" },
];

/** "há 12 min" / "há 3 h" / "há 5 dias" / "nunca acessou" */
function formatLastSeen(iso: string | null): string {
  if (!iso) return "nunca acessou";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "nunca acessou";

  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "agora há pouco";
  if (minutes < 60) return `há ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "há 1 dia";
  if (days < 30) return `há ${days} dias`;

  const months = Math.floor(days / 30);
  return months === 1 ? "há 1 mês" : `há ${months} meses`;
}

function OrgBlock({ group }: { group: OrgActivityGroup }) {
  const hasOnline = group.onlineCount > 0;

  return (
    <div className="border-b last:border-b-0">
      {/* Cabeçalho da org */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-muted/40">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              "w-2 h-2 rounded-full shrink-0",
              hasOnline ? "bg-emerald-500" : "bg-muted-foreground/30",
            )}
            aria-hidden
          />
          <span className="font-medium text-sm truncate">{group.orgName}</span>
          {group.subscriptionStatus !== "active" && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
              {group.subscriptionStatus}
            </Badge>
          )}
        </div>
        <span
          className={cn(
            "text-xs tabular-nums shrink-0",
            hasOnline ? "text-emerald-600 font-medium" : "text-muted-foreground",
          )}
        >
          {group.onlineCount} de {group.totalCount}
        </span>
      </div>

      {/* Membros */}
      {group.members.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground italic">
          Nenhum usuário ativo cadastrado nesta organização.
        </p>
      ) : (
        <ul>
          {group.members.map((m) => (
            <li
              key={m.memberId}
              className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-accent/40"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    m.isOnline ? "bg-emerald-500" : "bg-muted-foreground/30",
                  )}
                  aria-label={m.isOnline ? "ativo" : "sem sinal"}
                />
                <span
                  className={cn(
                    "text-sm truncate",
                    m.isOnline ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {m.name}
                </span>
                {m.isMaster && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1 py-0 shrink-0 border-red-500/30 text-red-600 gap-0.5"
                  >
                    <ShieldCheck className="w-2.5 h-2.5" />
                    master
                  </Badge>
                )}
                {m.email && (
                  <span className="text-xs text-muted-foreground truncate hidden md:inline">
                    {m.email}
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                {formatLastSeen(m.lastSeenAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function MasterUsuariosAtivos() {
  const [windowMinutes, setWindowMinutes] = useState("60");
  const [search, setSearch] = useState("");
  const [includeMasters, setIncludeMasters] = useState(false);
  const [onlyOnline, setOnlyOnline] = useState(false);

  // <MasterRoute> só garante "tem linha em master_users" — o outbounder passa
  // por ele. Esta tela mostra usuários de TODOS os clientes, então exige master
  // pleno. O gate de verdade é o da RPC; este é o espelho para a UI não piscar
  // conteúdo antes do 42501 voltar.
  const { isFullMaster, isLoading: isLoadingAuth } = useMasterAuth();

  const { data: rows, isLoading, error, refetch, isFetching } =
    useMasterUserActivity(Number(windowMinutes), { enabled: isFullMaster });

  const groups = useMemo(
    () => groupByOrg(rows ?? [], { includeMasters }),
    [rows, includeMasters],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return groups
      .filter((g) => (onlyOnline ? g.onlineCount > 0 : true))
      .filter((g) => {
        if (!term) return true;
        if (g.orgName.toLowerCase().includes(term)) return true;
        return g.members.some(
          (m) =>
            m.name.toLowerCase().includes(term) ||
            (m.email ?? "").toLowerCase().includes(term),
        );
      })
      .sort((a, b) => {
        if (b.onlineCount !== a.onlineCount) return b.onlineCount - a.onlineCount;
        return a.orgName.localeCompare(b.orgName, "pt-BR");
      });
  }, [groups, search, onlyOnline]);

  // Contagem DISTINTA de pessoas (não de assentos): quem é membro de 3 orgs
  // conta 1 aqui. É a mesma função do ping da barra superior — os dois números
  // têm de bater, senão a tela se contradiz com o próprio cabeçalho do app.
  const totals = useMemo(
    () => ({
      online: countDistinctOnlineUsers(rows ?? [], { includeMasters }),
      members: countDistinctUsers(rows ?? [], { includeMasters }),
      orgsOnline: groups.filter((g) => g.onlineCount > 0).length,
    }),
    [rows, includeMasters, groups],
  );

  const windowLabel =
    WINDOW_OPTIONS.find((o) => o.value === windowMinutes)?.label.toLowerCase() ??
    "última hora";

  // Bloqueio antes de qualquer render de conteúdo — inclusive antes do mock de
  // desenvolvimento, para que nem em dev um perfil restrito veja a frota.
  if (!isLoadingAuth && !isFullMaster) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <ShieldAlert className="h-12 w-12 text-destructive" />
        <h1 className="text-xl font-bold">Acesso restrito</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Esta tela mostra usuários de todas as organizações e é exclusiva de
          usuários master com acesso total.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6 text-red-500" />
            Usuários
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Quem deu sinal de uso em cada organização — {windowLabel}.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-2"
        >
          <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
          Atualizar
        </Button>
      </div>

      {/* Resumo */}
      {!isLoading && !error && (
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <strong className="tabular-nums">{totals.online}</strong>
            <span className="text-muted-foreground">
              de {totals.members} usuários
            </span>
          </span>
          <span className="text-muted-foreground">
            em <strong className="tabular-nums">{totals.orgsOnline}</strong>{" "}
            {totals.orgsOnline === 1 ? "organização" : "organizações"}
          </span>
        </div>
      )}

      {/* Controles */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar organização ou usuário..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={windowMinutes} onValueChange={setWindowMinutes}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WINDOW_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={onlyOnline ? "default" : "outline"}
          size="sm"
          onClick={() => setOnlyOnline((v) => !v)}
        >
          Só com atividade
        </Button>
        <Button
          variant={includeMasters ? "default" : "outline"}
          size="sm"
          onClick={() => setIncludeMasters((v) => !v)}
        >
          Incluir masters
        </Button>
      </div>

      {/* Aviso de precisão — parte do contrato da tela, não enfeite */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 border rounded-lg px-3 py-2">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <p>
          O sinal vem da sessão de login, que se renova a cada ~1 hora. Serve para
          saber <strong>quem andou usando o sistema</strong>, não para presença ao
          vivo minuto a minuto — alguém que fechou o sistema há 20 minutos ainda
          aparece verde.
        </p>
      </div>

      {/* Estados */}
      {isLoading ? (
        <Card>
          <CardContent className="p-4 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : error ? (
        <Card className="border-amber-500/40">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-1 text-sm">
              {isMissingRpcError(error) ? (
                <>
                  <p className="font-medium">Migration ainda não aplicada.</p>
                  <p className="text-muted-foreground">
                    A função <code>master_org_user_activity</code> não existe no
                    banco. Aplique{" "}
                    <code>
                      supabase/migrations/20270807120000_master_org_user_activity.sql
                    </code>{" "}
                    e recarregue.
                  </p>
                </>
              ) : isAccessDeniedError(error) ? (
                <>
                  <p className="font-medium">Acesso negado.</p>
                  <p className="text-muted-foreground">
                    Esta tela é exclusiva de usuários master.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium">Não foi possível carregar.</p>
                  <p className="text-muted-foreground">
                    {(error as { message?: string })?.message ?? "Erro desconhecido."}
                  </p>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Nenhuma organização encontrada com esses filtros.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            {visible.map((g) => (
              <OrgBlock key={g.organizationId} group={g} />
            ))}
          </CardContent>
        </Card>
      )}
    </motion.div>
  );
}
