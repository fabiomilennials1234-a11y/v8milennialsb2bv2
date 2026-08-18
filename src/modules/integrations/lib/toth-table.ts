/**
 * 🟠 PONTE DE TIPOS TEMPORÁRIA — remover quando a migration do Toth estiver em prod.
 *
 * `src/integrations/supabase/types.ts` é gerado a partir do **projeto de
 * produção**. A migration `20270817100000_toth_foundation.sql` ainda não foi
 * aplicada lá, então `toth_connections` não existe no `Database` e qualquer
 * `supabase.from("toth_connections")` não compila.
 *
 * Regenerar os tipos agora NÃO é a saída: o CLAUDE.md registra que gerar
 * `types.ts` a partir de uma branch efêmera **corrompe** o arquivo, porque a
 * branch não carrega as tabelas que só existem em prod. A ordem correta é
 * aplicar em prod → regenerar → apagar este arquivo.
 *
 * Por isso o escape fica aqui, num módulo só dele, em vez de espalhar `as any`
 * pelo hook: o dia da limpeza é `git rm` de um arquivo e a troca dos imports,
 * não uma caça a casts perdidos.
 *
 * **Ao remover:** trocar `tothConnectionsTable()` por
 * `supabase.from("toth_connections")` em `hooks/useToth.ts` e apagar
 * `TothConnectionRow` — o tipo gerado passa a valer.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/** Espelho manual das colunas lidas pela UI. Fonte: a migration do Toth. */
export interface TothConnectionRow {
  base_url: string | null;
  token_transport: string | null;
  allow_insecure_transport: boolean | null;
  connected_at: string | null;
  status: string | null;
  erp_sync_mode: string | null;
  last_clientes_sync_at: string | null;
  last_cobrancas_sync_at: string | null;
  last_error: string | null;
}

/**
 * Acesso à tabela sem a tipagem do `Database`. O retorno é tratado como
 * `TothConnectionRow` no chamador — tipagem manual, não ausência de tipagem.
 */
export function tothConnectionsTable() {
  return (supabase as unknown as SupabaseClient).from("toth_connections");
}
