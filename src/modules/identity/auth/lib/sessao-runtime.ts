import { useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFASAGEM_TOLERADA_MS,
  criarRenovador,
  defasagemDoRelogio,
  ehTokenVencido,
  msAteRenovar,
  payloadDoJwt,
} from "./sessao-resiliente";

/** Uma renovação por vez para o app inteiro (ver `criarRenovador`). */
export const renovarSessao = criarRenovador(async () => {
  const { data, error } = await supabase.auth.refreshSession();
  return !error && !!data.session;
});

// ── Relógio do computador ────────────────────────────────────────────────
let defasagemAtual: number | null = null;
const ouvintes = new Set<() => void>();
let timerDeRenovacao: ReturnType<typeof setTimeout> | null = null;

function publicar(valor: number | null) {
  defasagemAtual = valor;
  for (const o of ouvintes) o();
}

/**
 * Chamado a cada token NOVO (login e renovação). Mede a defasagem pelo `iat` e,
 * com o relógio errado além do tolerado, agenda a próxima renovação pela hora
 * do servidor — o agendamento do próprio supabase-js usa o relógio local e
 * chegaria tarde (relógio atrasado) ou cedo demais (adiantado).
 */
export function registrarTokenNovo(session: Session | null, agoraMs: number = Date.now()) {
  if (timerDeRenovacao) {
    clearTimeout(timerDeRenovacao);
    timerDeRenovacao = null;
  }
  if (!session?.access_token) {
    publicar(null);
    return;
  }
  const defasagem = defasagemDoRelogio(session.access_token, agoraMs);
  publicar(defasagem);
  const exp = payloadDoJwt(session.access_token)?.exp;
  if (defasagem === null || typeof exp !== "number" || Math.abs(defasagem) <= DEFASAGEM_TOLERADA_MS) return;
  timerDeRenovacao = setTimeout(() => void renovarSessao(), msAteRenovar(exp, defasagem, agoraMs));
}

/** Defasagem do relógio local em ms (null = ainda não medida). */
export function useDefasagemDoRelogio(): number | null {
  return useSyncExternalStore(
    (cb) => {
      ouvintes.add(cb);
      return () => ouvintes.delete(cb);
    },
    () => defasagemAtual,
    () => null,
  );
}

// ── Consultas que falharam por token vencido ────────────────────────────
/**
 * Escuta o cache do React Query: consulta que falhou com "JWT expired" dispara
 * UMA renovação e, se der certo, refaz as consultas em erro. Quem estava vendo
 * a tela nem percebe; antes, ficava com erro ou com "Sua sessão expirou".
 */
export function instalarRecuperacaoDeSessao(queryClient: QueryClient): () => void {
  return queryClient.getQueryCache().subscribe((evento) => {
    if (evento.type !== "updated" || evento.action.type !== "error") return;
    if (!ehTokenVencido(evento.action.error)) return;
    void renovarSessao().then((ok) => {
      if (ok) void queryClient.invalidateQueries({ predicate: (q) => q.state.status === "error" });
    });
  });
}
