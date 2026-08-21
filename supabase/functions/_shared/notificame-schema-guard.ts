/**
 * notificame-schema-guard — a ponte que aguenta a JANELA entre o deploy da função
 * e o apply da migration da fatia 1.1.
 *
 * ⚠️ POR QUE ESTE ARQUIVO EXISTE (dano real, não hipótese):
 *
 * A FATIA 1 JÁ ESTÁ EM PRODUÇÃO — `notificame-channel-start` e
 * `notificame-channel-finish` no ar, flag `notificame` ligada, WhatsApp Oficial
 * conectando de verdade. A migration `20270814093000_notificame_instagram_channel`
 * NÃO está aplicada em prod. Deploy de função e apply de migration são DOIS atos
 * manuais, em duas ferramentas diferentes, e nada no CI os ordena.
 *
 * Sem esta guarda, deployar as funções da 1.1 ANTES da migration derruba o fluxo
 * de WhatsApp que hoje funciona:
 *
 *   - `readConnectSession` pede `requested_channel_type` no SELECT. Coluna ausente
 *     ⇒ PostgREST devolve erro ⇒ a função lê `{state:'invalid'}` ⇒ o finish
 *     responde 403 `session_invalid` para TODA conexão de WhatsApp. O canal já
 *     nasceu no fornecedor, é FATURÁVEL e IRREMOVÍVEL, e nunca é vinculado a org
 *     nenhuma. Órfão permanente, por deploy fora de ordem.
 *   - `loadClaimedChannels` lê `messaging_channels`. Tabela ausente ⇒ erro ⇒ 500
 *     `claimed_lookup_failed`, mesmo desfecho.
 *   - `openConnectSession` grava `requested_channel_type` no INSERT. Coluna ausente
 *     ⇒ a sessão não abre ⇒ o finish perde a BASELINE e degrada para a regra sem
 *     foto — a regra que trava a org em `ambiguous_channel`.
 *
 * A ORDEM CERTA CONTINUA SENDO MIGRATION PRIMEIRO, FUNÇÕES DEPOIS. Esta guarda
 * NÃO autoriza inverter: ela existe para que inverter custe uma linha de log em
 * vez de um canal órfão cobrado para sempre. Documento da ordem: o cabeçalho de
 * `supabase/migrations/20270814093000_notificame_instagram_channel.sql`.
 *
 * ─── BÔNUS NÃO-ACIDENTAL: O CACHE DE SCHEMA DO POSTGREST ────────────────────
 *
 * Mesmo com a ordem certa, existe uma janela de segundos DEPOIS do apply em que o
 * PostgREST ainda não recarregou o cache e responde `PGRST204`/`PGRST205` para
 * coluna e tabela que JÁ existem no banco. Sem a guarda, essa janela é indistinta
 * de um deploy fora de ordem — e cai em cima de quem estiver conectando naquele
 * minuto.
 *
 * ─── O QUE ESTAS FUNÇÕES NÃO SÃO ────────────────────────────────────────────
 *
 * Não são `catch {}`. Elas reconhecem UM erro nomeado sobre UM objeto nomeado:
 * o chamador precisa passar o nome da coluna/tabela, e o nome tem de aparecer na
 * mensagem do erro. Qualquer outra falha — permissão, RLS, timeout, coluna
 * DIFERENTE ausente — continua subindo e derrubando o caminho, como deve.
 * Tolerância larga aqui viraria "verde por ausência": o schema errado passaria
 * despercebido até alguém notar um inbox mudo semanas depois.
 *
 * ─── QUANDO DELETAR ─────────────────────────────────────────────────────────
 *
 * Quando a migration `…093000` estiver aplicada em PROD e em DEV, e não houver
 * ambiente com as funções novas sobre schema velho. `rm` neste arquivo + os três
 * pontos de chamada (`notificame-sessions.ts` ×2, `notificame-channel-finish` ×1).
 * O rollback da migration REINTRODUZ a janela — na direção inversa (schema velho
 * sob funções novas), que é exatamente o caso que estas funções cobrem.
 */

/** O recorte de `PostgrestError` que interessa aqui. Estrutural, não nominal. */
export interface PostgrestErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

/**
 * Coluna ausente. Dois códigos porque são duas camadas distintas:
 *   `42703`    — o Postgres viu a query e não achou a coluna (caminho de SELECT);
 *   `PGRST204` — o PostgREST recusou ANTES de ir ao banco, porque o cache de
 *                schema dele não tem a coluna (caminho de INSERT/UPDATE).
 */
const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);

/**
 * Tabela ausente. `42P01` é o Postgres; `PGRST205` é o cache do PostgREST.
 */
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);

/** Todo o texto do erro num lugar só — a mensagem útil migra entre os campos. */
function errorText(err: PostgrestErrorLike): string {
  return [err.message, err.details, err.hint].filter(Boolean).join(" | ");
}

/**
 * O NOME do objeto tem de aparecer no texto do erro. É esta exigência — e não o
 * código sozinho — que impede a guarda de engolir "outra coluna qualquer sumiu".
 *
 * Escapa os metacaracteres do nome: os nomes aqui são literais nossos, mas montar
 * regex com string sem escapar é hábito que sobrevive ao autor.
 */
function mentions(err: PostgrestErrorLike, objectName: string): boolean {
  const escaped = objectName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, "i").test(errorText(err));
}

/**
 * `true` SÓ quando o erro é "esta coluna nomeada não existe (ainda)".
 *
 * Exige as DUAS coisas: código conhecido de coluna ausente E o nome da coluna no
 * texto. Sem o nome, um `42703` sobre outra coluna ligaria o caminho de fallback
 * e esconderia um schema torto de verdade.
 */
export function isMissingColumnError(
  err: PostgrestErrorLike | null | undefined,
  column: string,
): boolean {
  if (!err) return false;
  if (!MISSING_COLUMN_CODES.has(String(err.code ?? ""))) return false;
  return mentions(err, column);
}

/**
 * `true` SÓ quando o erro é "esta tabela nomeada não existe (ainda)".
 *
 * Mesma dupla exigência de `isMissingColumnError`, e pela mesma razão.
 */
export function isMissingTableError(
  err: PostgrestErrorLike | null | undefined,
  table: string,
): boolean {
  if (!err) return false;
  if (!MISSING_TABLE_CODES.has(String(err.code ?? ""))) return false;
  return mentions(err, table);
}
