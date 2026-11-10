import { supabase } from "@/integrations/supabase/client";

/**
 * Chama uma RPC que `types.ts` ainda não conhece.
 *
 * `src/integrations/supabase/types.ts` é gerado a partir do schema de PROD, e o
 * apply de uma migration vem DEPOIS do merge do front. Entre um e outro, a
 * assinatura tipada de `supabase.rpc` não tem a função nova e o `tsc` reprova.
 *
 * O precedente no repo é `(supabase.rpc as any)(...)`, que resolve o tipo e
 * também apaga a checagem do retorno inteiro — e cada uso novo custa um warning
 * de `no-explicit-any` no ratchet. Este helper faz a mesma ponte com o buraco
 * do tamanho certo: os ARGUMENTOS deixam de ser checados (é o que precisa
 * ceder), o retorno continua tendo forma, e quem chama escolhe `T`.
 *
 * ⚠️ `T` é uma PROMESSA, não uma prova — nada valida que a RPC devolve esse
 * shape. Só use com função cujo `RETURNS` você leu na migration.
 *
 * 🔑 Depois do apply em prod + `supabase gen types`, o certo é trocar por
 * `supabase.rpc("nome", {...})` direto e apagar o uso daqui.
 */
type ChamadaRpc = (
  nome: string,
  args: Record<string, unknown>,
) => Promise<{
  data: unknown;
  error: { message: string; code?: string; details?: string | null; hint?: string | null } | null;
}>;

export async function rpcNaoTipada<T>(
  nome: string,
  args: Record<string, unknown>,
): Promise<T> {
  const chamar = supabase.rpc as unknown as ChamadaRpc;
  // SupabaseClient.rpc acessa this.rest; preservar o cliente como receiver.
  const { data, error } = await chamar.call(supabase, nome, args);
  if (error) {
    // Continua um `Error` com a mesma mensagem, mas com os campos do erro do
    // PostgREST — como o resto do app o entrega ao `notifyError`: timeout
    // (57014), sem permissão (42501) e sessão vencida (PGRST30x) são
    // reconhecidos, em vez de virar "erro desconhecido" com convite ao suporte.
    throw Object.assign(new Error(error.message), { code: error.code, details: error.details, hint: error.hint });
  }
  return data as T;
}
