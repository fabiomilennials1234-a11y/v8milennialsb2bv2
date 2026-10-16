/**
 * usePromptImpression — "este usuário já viu este prompt?", no servidor.
 *
 * Cross-device: a marca mora em `user_prompt_impressions`, não no navegador.
 * Contrato de segurança da tela que usa este hook:
 *
 * - `claim()` é um INSERT simples de `{ prompt_key }` (o dono vem de DEFAULT
 *   auth.uid(); o cliente nem tem grant em `user_id`). Só abre o prompt se
 *   devolver `true`. 23505 = outra aba/device chegou antes → `false`.
 * - Claim que passou vira `status: "claimed"` no cache: a linha já existe, mas
 *   o prompt ainda não foi resolvido. O MainLayout remonta a cada rota; uma
 *   montagem nova que encontra "claimed" abre o diálogo sem novo claim, então
 *   desmontar durante o INSERT não gasta a única exibição.
 * - Claim em voo é UM só por (usuário, prompt): fica num Map de módulo e o
 *   cache mostra "claiming". Uma montagem nova (troca de rota no meio do
 *   INSERT) aguarda a mesma promise em vez de disparar outro INSERT — que daria
 *   23505 e esconderia o prompt. E 23505 nunca rebaixa um "claimed" já obtido.
 * - Falha fecha: qualquer erro (rede, RLS, tabela ainda não migrada) vira
 *   "não mostra". `status: "error"` deve ser tratado como visto.
 * - `resolve()` grava o desfecho uma vez (a policy só deixa sair de NULL) e
 *   marca "seen" no cache. Falhar no banco não muda nada para o usuário: a
 *   linha já existe, o prompt não volta.
 */
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/modules/identity";

export type PromptImpressionStatus = "loading" | "unseen" | "claiming" | "claimed" | "seen" | "error";
export type PromptOutcome = "dismissed" | "submitted";

/** Tabela/coluna ausente no schema: o front chegou antes da migration. Não é defeito a relatar. */
const SCHEMA_MISSING_CODES = new Set(["PGRST205", "PGRST204", "42P01", "42703"]);

function errorCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error as { code: unknown };
    return typeof code === "string" ? code : null;
  }
  return null;
}

/** Claim em voo por `${userId}:${promptKey}` — sobrevive à desmontagem do componente. */
const inflightClaims = new Map<string, Promise<boolean>>();

export function promptImpressionKey(userId: string | null, promptKey: string) {
  return ["prompt-impression", userId, promptKey] as const;
}

type ImpressionData = Exclude<PromptImpressionStatus, "loading">;

export function usePromptImpression(promptKey: string, { enabled }: { enabled: boolean }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const queryKey = promptImpressionKey(userId, promptKey);

  const query = useQuery({
    queryKey,
    enabled: enabled && !!userId,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async (): Promise<ImpressionData> => {
      const { data, error } = await supabase
        .from("user_prompt_impressions")
        .select("prompt_key")
        .eq("user_id", userId!)
        .eq("prompt_key", promptKey)
        .maybeSingle();
      if (error) {
        // Migration ainda não aplicada: silêncio (sem relatório a cada abertura).
        if (SCHEMA_MISSING_CODES.has(errorCode(error) ?? "")) return "error";
        throw error;
      }
      return data ? "seen" : "unseen";
    },
  });

  const status: PromptImpressionStatus = query.isError ? "error" : (query.data ?? "loading");

  const setStatus = useCallback(
    (next: ImpressionData) => queryClient.setQueryData(promptImpressionKey(userId, promptKey), next),
    [promptKey, queryClient, userId],
  );

  const claim = useCallback((): Promise<boolean> => {
    if (!userId) return Promise.resolve(false);
    const cacheKey = promptImpressionKey(userId, promptKey);
    if (queryClient.getQueryData<ImpressionData>(cacheKey) === "claimed") return Promise.resolve(true);
    const flightKey = `${userId}:${promptKey}`;
    const inflight = inflightClaims.get(flightKey);
    if (inflight) return inflight;

    // Falha nunca rebaixa um "claimed" já obtido.
    const settleFailure = () => {
      if (queryClient.getQueryData<ImpressionData>(cacheKey) !== "claimed") setStatus("seen");
      return false;
    };
    setStatus("claiming");
    const flight = (async () => {
      try {
        const { error } = await supabase.from("user_prompt_impressions").insert({ prompt_key: promptKey });
        // Sucesso → "claimed" (a próxima montagem abre sem novo claim).
        // 23505 = outra aba/device chegou antes; qualquer outro erro = falha fecha.
        if (error) return settleFailure();
        setStatus("claimed");
        return true;
      } catch {
        return settleFailure();
      } finally {
        inflightClaims.delete(flightKey);
      }
    })();
    inflightClaims.set(flightKey, flight);
    return flight;
  }, [promptKey, queryClient, setStatus, userId]);

  const resolve = useCallback(
    async (outcome: PromptOutcome): Promise<void> => {
      if (!userId) return;
      setStatus("seen");
      try {
        await supabase
          .from("user_prompt_impressions")
          .update({ outcome })
          .eq("user_id", userId)
          .eq("prompt_key", promptKey)
          .is("outcome", null);
      } catch {
        // Desfecho é telemetria de produto; o "visto" já está gravado.
      }
    },
    [promptKey, setStatus, userId],
  );

  return { status, claim, resolve };
}
