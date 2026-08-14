/**
 * notificame-credentials — o CHOKE ÚNICO de `public.notificame_subaccounts`.
 * Nada mais no repo toca essa tabela. Molde: `_shared/erp/omie-credentials.ts`
 * (ADR-0020), com uma fase a mais — o PROVISIONAMENTO.
 *
 * O QUE ESTE MÓDULO GUARDA: o `CompanyId` da subconta daquela org, que **É O
 * TOKEN** dela (provado contra a conta viva: byte-a-byte igual ao `acccount_id`
 * de `GET /v1/resale/`). Cifrado AES-256-GCM com `NOTIFICAME_ENCRYPTION_KEY` —
 * chave PRÓPRIA, não a do Omie. A tabela é deny-all; só service_role entra.
 *
 * ⚠️ A ORDEM DAS OPERAÇÕES É O DESENHO, NÃO ESTILO. `POST /v2/accounts` cria no
 * fornecedor um objeto IRREMOVÍVEL e faturável. A única guarda confiável contra
 * clique-duplo é o BANCO: a claim (`INSERT ... ON CONFLICT DO NOTHING`) é gravada
 * ANTES de falar com o fornecedor. Um `ON CONFLICT DO NOTHING` DEPOIS da chamada
 * já teria criado a subconta duplicada e estaria apenas descartando a linha — e
 * ninguém veria, porque o estado final do banco ficaria idêntico. É por isso que
 * o teste desta ordem assere a SEQUÊNCIA das chamadas, e não só o resultado.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AS TRÊS GUARDAS DO CICLO DE VIDA (cada uma existe por um jeito CONHECIDO de
 * fabricar uma segunda subconta irremovível e faturável para a MESMA org):
 *
 * 1. FALHA NÃO É UMA COISA SÓ. Retomar uma tentativa morta só é seguro quando o
 *    fornecedor RECUSOU EXPLICITAMENTE (`create_account_rejected`) — aí nada
 *    nasceu lá. Quando a requisição SAIU e a resposta se perdeu
 *    (`create_account_transport_error`, `create_account_timeout`),
 *    quando não conseguimos LER a resposta (`create_account_unreadable`,
 *    `create_account_no_company_id`) ou quando a subconta comprovadamente EXISTE e
 *    foi o token que não gravou (`token_persist_failed`), o objeto PODE ou DEVE
 *    existir do outro lado. Nesses estados o `POST` fica PROIBIDO: só a ADOÇÃO é
 *    permitida. Ver `RESUMABLE_LAST_ERROR_CODES` — a lista é de exceções, o
 *    default é proibir.
 *
 * 2. ADOTAR ANTES DE CRIAR. Antes de QUALQUER `POST /v2/accounts`, o
 *    `vendor_email` determinístico é reconciliado contra `GET /v1/resale/`.
 *    Existindo lá, a subconta é ADOTADA (o `acccount_id` é o mesmo token que o
 *    POST devolveria). Isso não é só economia: duas subcontas com o mesmo
 *    `vendor_email` ficam INDISTINGUÍVEIS naquela listagem, que é a única trilha
 *    de reconciliação que existe — criar a segunda destrói a capacidade de
 *    consertar. E "não consegui ler a listagem" NUNCA vale como "não existe".
 *
 * 3. A JANELA DE STALE SAI DO TIMEOUT, e não o contrário. Retomar a claim de uma
 *    execução cujo `POST` ainda está EM VOO cria duas subcontas. Com `fetch` sem
 *    deadline não existe janela segura — o voo pode durar mais que qualquer
 *    número escolhido. Por isso a chamada ao fornecedor tem deadline explícito
 *    (`CREATE_ACCOUNT_TIMEOUT_MS`) e o stale é dimensionado a partir dele.
 *
 * E antes de tudo isso: a CHAVE DE CIFRA é validada por DERIVAÇÃO, não por
 * presença. Uma chave presente e malformada passaria num teste de presença, o
 * POST sairia, a subconta nasceria e a gravação do token quebraria na cifra — a
 * cada tentativa, uma subconta faturável a mais. Chave inválida = estado INERTE,
 * zero escrita, zero chamada ao fornecedor.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A SENHA GERADA NÃO É ARMAZENADA, de propósito e em voz alta: o caminho de
 * acesso à subconta é o token, e guardar uma senha que ninguém usa seria mais um
 * segredo para vazar. Se um dia for preciso entrar no painel DA SUBCONTA, o
 * caminho é reset pelo `vendor_email` determinístico — que é justamente por isso
 * que ele fica em claro na tabela.
 *
 * `last_error_code` guarda CÓDIGO NOSSO, jamais corpo ou mensagem do fornecedor:
 * a coluna não é diagnóstico decorativo, é ELA que decide se uma retomada pode
 * criar, e um texto livre de terceiro não pode entrar num predicado de
 * autorização. Escrever um código novo sem classificá-lo abaixo é reabrir a porta.
 *
 * ⚠️ ISSO NÃO É "NUNCA REGISTRAR O QUE O FORNECEDOR DISSE" — a leitura larga dessa
 * regra já custou uma hora de diagnóstico em produção, com `runtime_logs` guardando
 * só `{"code":"subaccount_provision_failed"}`. A recusa DELES (código e mensagem)
 * sobe no campo `vendor` de `EnsureSubaccountResult`, que existe para a edge
 * function LOGAR. Duas coisas diferentes, dois destinos diferentes: a COLUNA é
 * decisão e só aceita código nosso; o LOG é diagnóstico e precisa dos dois.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encryptSecret, decryptSecret } from "./crypto.ts";
import {
  createSubaccount,
  buildSubaccountEmail,
  lookupResaleAccountByEmail,
  NotificameError,
  type FetchImpl,
  type NotificameParentConfig,
  type NotificameVendorDetail,
  type ResaleLookup,
  type SubaccountDefaults,
} from "./notificame.ts";

export const NOTIFICAME_ENCRYPTION_KEY_ID = "v1";

/**
 * Deadline da chamada que CRIA. Cobre a requisição inteira, incluindo a leitura do
 * corpo: um corpo que nunca termina de chegar prende a claim igual a uma conexão
 * pendurada, e é a duração da claim — não a do socket — que a janela de stale
 * precisa cobrir.
 */
export const CREATE_ACCOUNT_TIMEOUT_MS = 20_000;

/** Deadline da reconciliação. Só leitura: estourar aqui não cria nada. */
export const RESALE_LOOKUP_TIMEOUT_MS = 10_000;

/**
 * Folga entre o fim dos deadlines e o momento em que a claim é considerada morta.
 * Cobre as escritas no banco que ficam entre eles.
 */
const CLAIM_SLACK_MS = 40_000;

/**
 * Janela em que uma claim `provisioning` é considerada VIVA. Passado isso, ela é
 * entulho de uma execução que morreu no meio (timeout de edge function, deploy) e
 * pode ser tomada — senão a org fica travada para sempre em
 * `provisioning_in_progress` sem nenhuma saída pela UI.
 *
 * ⚠️ DERIVADA, e a direção da derivação é o ponto: o valor é
 * `deadline(resale) + deadline(create) + folga`, de modo que uma claim só é
 * declarada morta DEPOIS que o `fetch` do detentor já foi abortado. Escolher o
 * número primeiro e deixar o `fetch` sem deadline (era o desenho anterior: 90s
 * fixos, `fetch` sem timeout) permite retomar a claim com o POST ainda em voo — e
 * o resultado é a segunda subconta irremovível que este módulo inteiro existe
 * para impedir. Se algum dia um deadline crescer, este valor cresce junto e
 * sozinho.
 */
export const STALE_CLAIM_MS = RESALE_LOOKUP_TIMEOUT_MS + CREATE_ACCOUNT_TIMEOUT_MS + CLAIM_SLACK_MS;

/**
 * Os ÚNICOS `last_error_code` que autorizam uma retomada a CRIAR. Lista de
 * exceções por desenho: código desconhecido, ausente ou novo cai no default, que é
 * PROIBIR a criação e permitir só a adoção. Errar para o lado de proibir custa uma
 * reconciliação manual; errar para o outro custa uma subconta faturável eterna.
 *
 *   • `create_account_rejected`  — o fornecedor devolveu envelope de erro
 *     EXPLÍCITO. Nada nasceu lá.
 *   • `resale_unavailable`       — paramos ANTES do POST porque a listagem não
 *     pôde ser lida. Por construção, o endpoint de criação nunca foi tocado.
 */
export const RESUMABLE_LAST_ERROR_CODES: ReadonlySet<string> = new Set([
  "create_account_rejected",
  "resale_unavailable",
]);

/** Chave AES-256 em hex. 32 bytes = 64 chars. */
const ENCRYPTION_KEY_HEX = /^[0-9a-fA-F]{64}$/;

/**
 * Lida por FUNÇÃO e não em constante de módulo: assim o módulo é importável fora
 * do Deno (o teste unitário roda no Vitest) e a chave pode ser injetada.
 */
function envEncryptionKey(): string {
  try {
    const denoEnv = (globalThis as {
      Deno?: { env?: { get(key: string): string | undefined } };
    }).Deno?.env;
    return (denoEnv?.get("NOTIFICAME_ENCRYPTION_KEY") ?? "").trim();
  } catch {
    return "";
  }
}

/**
 * VALIDA A CHAVE DE VERDADE — hex, tamanho e DERIVAÇÃO real pelo WebCrypto.
 *
 * O teste de presença que existia aqui deixava passar uma chave presente e
 * malformada. O caminho que isso abria era o pior do módulo: guard verde → `POST
 * /v2/accounts` → subconta irremovível NASCE → `encryptSecret` estoura →
 * `token_persist_failed`. Repetindo a cada clique, um laço de subcontas
 * faturáveis com o mesmo `vendor_email`, que é exatamente o estado que destrói a
 * trilha de reconciliação.
 *
 * A derivação é uma operação AES sobre 5 bytes: barata o bastante para pagar em
 * toda tentativa, e é a única prova de que a chave SERVE — `hexToBytes` aceita
 * comprimentos que o `importKey` recusa.
 */
async function classifyEncryptionKey(
  keyHex: string,
): Promise<"ok" | "missing" | "invalid"> {
  const key = keyHex.trim();
  if (!key) return "missing";
  if (!ENCRYPTION_KEY_HEX.test(key)) return "invalid";
  try {
    await encryptSecret("probe", key);
    return "ok";
  } catch {
    return "invalid";
  }
}

export interface NotificameSubaccount {
  /** UUID da NOSSA linha. É ISTO que vai para `provider_config.subaccount_id`. */
  id: string;
  organizationId: string;
  /** O token da subconta, decifrado. NUNCA persistir, nunca logar, nunca devolver em JSON. */
  companyUuid: string;
}

export type EnsureSubaccountResult =
  | { ok: true; subaccount: NotificameSubaccount }
  | {
    ok: false;
    /**
     * O QUE O FORNECEDOR DISSE, quando foi ele que recusou. ⚠️ SERVER-ONLY: existe
     * para a edge function LOGAR, e nunca para compor a resposta HTTP.
     *
     * ESTE CAMPO É O CONSERTO DE UM DEFEITO MEDIDO. O `code` abaixo é NOSSO e é
     * grosso de propósito — `subaccount_provision_failed` cobre "o fornecedor
     * recusou", "o token não gravou", "o POST estourou o deadline" e "a claim não
     * inseriu", que têm consertos diferentes. Em produção, a trilha guardou
     * exatamente `{"code":"subaccount_provision_failed"}` e mais nada, e a
     * resposta do fornecedor — a única coisa que distinguia os casos — tinha sido
     * descartada três camadas abaixo.
     *
     * `null`/ausente = a falha não foi do fornecedor (chave de cifra, banco,
     * transporte, timeout) ou ele não respondeu nada legível. `last_error_code`,
     * que é o que DECIDE a próxima tentativa, continua recebendo só código nosso —
     * a coluna não muda de natureza por causa disto.
     */
    vendor?: NotificameVendorDetail | null;
    code:
      | "provisioning_in_progress"
      | "subaccount_provision_failed"
      /**
       * ESTADO TERMINAL. A org não volta a provisionar sozinha, e isso é a
       * feature: pode existir uma subconta viva e faturável do outro lado que a
       * listagem da revenda não resolveu. Sair daqui é trabalho humano contra
       * `GET /v1/resale/` + `vendor_email`. Retentar não muda nada — e é para
       * NÃO virar re-provisionamento que ele é um código próprio.
       */
      | "subaccount_needs_reconciliation"
      | "encryption_key_missing"
      | "encryption_key_invalid";
  };

/**
 * Carrega e decifra a subconta PRONTA de uma org, ou `null`.
 *
 * Só `status='ready'` conta: o CHECK `chk_notificame_subaccount_ready` garante que
 * uma linha 'ready' tem ciphertext e nonce, e uma linha 'provisioning' pode ter
 * campos pela metade. Fail-closed silencioso em qualquer falha (chave errada,
 * cifra corrompida), igual a `loadOmieCredentials`: quem chama trata `null` como
 * "ainda não pronta" e o usuário reabre o fluxo.
 */
export async function loadNotificameSubaccount(
  admin: SupabaseClient,
  organizationId: string,
  encryptionKeyHex: string = envEncryptionKey(),
): Promise<NotificameSubaccount | null> {
  if (!encryptionKeyHex) return null;

  const { data, error } = await admin
    .from("notificame_subaccounts")
    .select("id, company_uuid_ciphertext, company_uuid_nonce")
    .eq("organization_id", organizationId)
    .eq("status", "ready")
    .maybeSingle();

  if (error || !data) return null;

  const row = data as {
    id: string;
    company_uuid_ciphertext: string | null;
    company_uuid_nonce: string | null;
  };
  if (!row.company_uuid_ciphertext || !row.company_uuid_nonce) return null;

  try {
    const companyUuid = await decryptSecret(
      row.company_uuid_ciphertext,
      row.company_uuid_nonce,
      encryptionKeyHex,
    );
    if (!companyUuid) return null;
    return { id: row.id, organizationId, companyUuid };
  } catch {
    return null;
  }
}

// ─── Deadline (o que transforma "esperar" em "abortar") ──────────────────────

/** Erro interno do deadline. Não sai deste módulo; vira `last_error_code`. */
class DeadlineExceeded extends Error {
  constructor() {
    super("deadline_exceeded");
    this.name = "DeadlineExceeded";
  }
}

/**
 * Roda uma operação de rede com deadline DURO e aborta o `fetch` ao estourar.
 *
 * Envolve a operação inteira — não só o `fetch` —, porque `createSubaccount` só
 * decide depois de `res.text()`: um deadline que morresse na resolução do `fetch`
 * deixaria a leitura do corpo sem teto e a claim presa além da janela de stale.
 *
 * O `signal` vai para o `fetch` de verdade (não é enfeite): o timer sozinho
 * devolveria o controle ao chamador com a requisição ainda EM VOO, que é
 * precisamente o cenário que fabrica a subconta duplicada.
 */
async function withDeadline<T>(
  timeoutMs: number,
  fetchImpl: FetchImpl,
  run: (fetchImpl: FetchImpl) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new DeadlineExceeded());
    }, timeoutMs);
  });

  const signalled: FetchImpl = (input, init) =>
    fetchImpl(input, { ...init, signal: init?.signal ?? controller.signal });

  const running = run(signalled);
  // Quando o deadline vence, `running` ainda vai rejeitar (abort). Sem este
  // `catch` inerte isso vira unhandled rejection e derruba o worker inteiro.
  running.catch(() => {});

  try {
    return await Promise.race([running, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ─── Máquina de estados da claim ─────────────────────────────────────────────

/**
 * O que uma retomada tem direito de fazer.
 *   • `create_allowed` — pode adotar E, se a revenda PROVAR ausência, criar.
 *   • `adopt_only`     — pode SÓ adotar. Ausência na revenda vira estado terminal,
 *                        nunca um POST.
 */
type ResumeMode = "create_allowed" | "adopt_only";

/**
 * Classifica a linha existente. A regra é uma só e vale acima do `status`: se
 * `last_error_code` marca uma falha que PODE ter tocado o fornecedor, a criação
 * fica proibida — inclusive numa linha que já voltou para `provisioning`, porque a
 * retomada preserva o código justamente para não perder essa memória.
 */
function resumeModeFor(lastErrorCode: string | null): ResumeMode {
  if (!lastErrorCode) return "create_allowed";
  return RESUMABLE_LAST_ERROR_CODES.has(lastErrorCode) ? "create_allowed" : "adopt_only";
}

interface SubaccountRow {
  id: string;
  status: string;
  updated_at: string;
  vendor_email: string | null;
  last_error_code: string | null;
}

async function markFailed(
  admin: SupabaseClient,
  rowId: string,
  code: string,
): Promise<void> {
  await admin
    .from("notificame_subaccounts")
    .update({ status: "failed", last_error_code: code })
    .eq("id", rowId);
}

/**
 * Garante que a org TEM uma subconta pronta, criando-a no fornecedor SÓ quando a
 * revenda prova que ela não existe. IDEMPOTENTE — e a idempotência mora no banco
 * (`UNIQUE (organization_id)`), nunca no cache do cliente.
 *
 * Sequência, na ordem exata:
 *   (a) chave de cifra VÁLIDA (derivada)  → sem ela, inerte: zero escrita, zero
 *                                           chamada ao fornecedor;
 *   (b) já pronta                         → devolve, ZERO chamadas;
 *   (c) CLAIM                             → INSERT ... ON CONFLICT DO NOTHING;
 *   (d) claim perdida                     → 'ready' devolve; claim viva devolve
 *                                           `provisioning_in_progress`; claim
 *                                           morta é TOMADA por UPDATE condicional,
 *                                           carregando o modo de retomada;
 *   (e) detendo a claim                   → RECONCILIA `GET /v1/resale/`:
 *                                           existe → ADOTA;
 *                                           ilegível → para (retentável);
 *                                           ausente → só então `POST /v2/accounts`,
 *                                           e só em `create_allowed`;
 *   (f) sucesso                           → cifra e marca 'ready';
 *   (g) falha                             → 'failed' com CÓDIGO NOSSO, que é o que
 *                                           decide o direito da PRÓXIMA tentativa.
 */
export async function ensureNotificameSubaccount(
  admin: SupabaseClient,
  params: {
    organizationId: string;
    orgName: string;
    parent: NotificameParentConfig;
    defaults: SubaccountDefaults;
    encryptionKeyHex?: string;
  },
  fetchImpl: FetchImpl = fetch,
): Promise<EnsureSubaccountResult> {
  const { organizationId, orgName, parent, defaults } = params;
  const keyHex = (params.encryptionKeyHex ?? envEncryptionKey()).trim();

  // (a) Antes de QUALQUER escrita e de QUALQUER chamada. Sem chave utilizável não
  // há como guardar o token, e uma subconta criada cujo token não pode ser gravado
  // é a pior linha possível: objeto vivo e faturável no fornecedor, invisível para
  // nós — e recriado a cada nova tentativa.
  const keyState = await classifyEncryptionKey(keyHex);
  if (keyState === "missing") return { ok: false, code: "encryption_key_missing" };
  if (keyState === "invalid") {
    console.warn("[notificame] NOTIFICAME_ENCRYPTION_KEY presente mas inutilizável");
    return { ok: false, code: "encryption_key_invalid" };
  }

  // (b) Caminho quente: já existe e está pronta.
  const existing = await loadNotificameSubaccount(admin, organizationId, keyHex);
  if (existing) return { ok: true, subaccount: existing };

  const defaultEmail = buildSubaccountEmail(organizationId, defaults.email_domain);

  // (c) CLAIM. `ignoreDuplicates` é o `ON CONFLICT (organization_id) DO NOTHING`:
  // sob corrida, exatamente uma execução recebe a linha de volta.
  const { data: claimed, error: claimErr } = await admin
    .from("notificame_subaccounts")
    .upsert(
      { organization_id: organizationId, status: "provisioning", vendor_email: defaultEmail },
      { onConflict: "organization_id", ignoreDuplicates: true },
    )
    .select("id");

  if (claimErr) {
    console.warn("[notificame] claim insert failed:", claimErr.message);
    return { ok: false, code: "subaccount_provision_failed" };
  }

  let subaccountRowId = (claimed as Array<{ id: string }> | null)?.[0]?.id ?? null;

  // Claim nova = linha que ACABAMOS de criar: nenhuma tentativa anterior existiu,
  // e o direito de criar é pleno (a reconciliação de (e) ainda assim roda).
  let mode: ResumeMode = "create_allowed";
  // O email da RETOMADA sai da linha, não do secret: se `email_domain` mudou entre
  // as tentativas, o email GRAVADO é o que aponta para a subconta que pode existir
  // no fornecedor. Recalcular apagaria a trilha e faria a revenda dizer "absent"
  // para uma conta viva — direto na criação da segunda.
  let vendorEmail = defaultEmail;
  // Preservado através da retomada: é a memória de "isto pode ter tocado o
  // fornecedor", e ela não pode morrer quando a linha volta para 'provisioning'.
  let priorErrorCode: string | null = null;

  // (d) Claim perdida — alguém mais detém, ou a linha já existia.
  if (!subaccountRowId) {
    const { data: current } = await admin
      .from("notificame_subaccounts")
      .select("id, status, updated_at, vendor_email, last_error_code")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!current) {
      // Nem inseriu nem encontrou: só acontece se a linha sumiu entre as duas
      // chamadas. Retentável, e o cliente já sabe repetir esse código.
      return { ok: false, code: "provisioning_in_progress" };
    }

    const row = current as SubaccountRow;
    if (row.status === "ready") {
      const ready = await loadNotificameSubaccount(admin, organizationId, keyHex);
      if (ready) return { ok: true, subaccount: ready };
      // 'ready' que não decifra = chave trocada ou cifra corrompida. NÃO
      // reprovisionar: criaria uma segunda subconta irremovível para a mesma org.
      // Terminal por decisão — a saída é humana, com a chave certa ou com o
      // `acccount_id` da revenda.
      return { ok: false, code: "subaccount_needs_reconciliation" };
    }

    priorErrorCode = row.last_error_code ?? null;
    mode = resumeModeFor(priorErrorCode);
    vendorEmail = (row.vendor_email ?? "").trim() || defaultEmail;

    const isStale = Date.parse(row.updated_at) < Date.now() - STALE_CLAIM_MS;
    // `failed` é uma tentativa ENCERRADA: quem escreveu esse status já recebeu (ou
    // desistiu de) a resposta do fornecedor e foi embora — não há POST em voo para
    // atropelar. Tomar na hora é seguro, e é o que faz a org receber o veredito
    // imediatamente em vez de um `provisioning_in_progress` que ela ficaria
    // repetindo por uma janela inteira de stale. O DIREITO DE CRIAR continua
    // decidido por `mode`, e só por ele: tomar a claim não é permissão para o POST.
    const isClosedAttempt = row.status === "failed";

    if (!isStale && !isClosedAttempt) {
      // Claim VIVA. Não tomar é a guarda: o POST do detentor pode estar em voo, e
      // atropelá-lo é como nasce a segunda subconta.
      return { ok: false, code: "provisioning_in_progress" };
    }

    // TOMADA da claim, atômica: o predicado do UPDATE é a autorização, e sob
    // corrida só uma execução recebe a linha de volta — os dois predicados abaixo
    // são AUTO-EXCLUDENTES, porque a própria tomada muda o campo que eles testam
    // (`status` num caso, `updated_at` no outro).
    //
    // `last_error_code` é PRESERVADO de propósito. Zerá-lo aqui apagaria a única
    // memória de que aquela tentativa pode ter criado a subconta, e a próxima
    // execução — vendo `provisioning` com código nulo — se acharia no direito de
    // criar. Ele só é limpo em (f), quando a subconta está de fato pronta.
    let takeQuery = admin
      .from("notificame_subaccounts")
      .update({ status: "provisioning", updated_at: new Date().toISOString() })
      .eq("organization_id", organizationId);

    takeQuery = isClosedAttempt
      ? takeQuery.eq("status", "failed")
      // `neq('ready')` fecha a janela entre o SELECT acima e este UPDATE: se a
      // execução que detinha a claim concluiu nesse intervalo, tomar a linha
      // apagaria o token de uma subconta viva e provocaria uma segunda criação.
      : takeQuery
        .neq("status", "ready")
        .lt("updated_at", new Date(Date.now() - STALE_CLAIM_MS).toISOString());

    const { data: taken } = await takeQuery.select("id");

    const takenId = (taken as Array<{ id: string }> | null)?.[0]?.id ?? null;
    if (!takenId) return { ok: false, code: "provisioning_in_progress" };
    subaccountRowId = takenId;
  }

  // (e) A claim está gravada. SÓ AGORA se fala com o fornecedor — e a PRIMEIRA
  // palavra é uma PERGUNTA (`GET /v1/resale/`), nunca a criação.
  let companyId: string;

  let lookup: ResaleLookup | { ok: false; code: string };
  try {
    lookup = await withDeadline(RESALE_LOOKUP_TIMEOUT_MS, fetchImpl, (f) =>
      lookupResaleAccountByEmail(parent, vendorEmail, f));
  } catch {
    lookup = { ok: false, code: "resale_timeout" };
  }

  if (!lookup.ok) {
    // Não sabemos se existe. Criar aqui seria trocar uma espera por uma subconta
    // eterna. `resale_unavailable` é RETOMÁVEL por construção: este caminho prova
    // que o endpoint de criação não foi tocado.
    //
    // ⚠️ Mas só pode ser gravado quando a linha JÁ era retomável. Numa linha em
    // `adopt_only`, escrever um código retomável por cima seria um REBAIXAMENTO:
    // apagaria a memória de que o fornecedor pode ter criado a subconta e daria à
    // próxima tentativa o direito de criar a segunda.
    // O detalhe do fornecedor sobe para quem loga. Sem ele, `resale_unavailable`
    // não distingue "token da conta-mãe expirou" (AUTHENTICATION_ERROR) de "a rota
    // mudou" (Hub404) de "a revenda foi desabilitada" — e este caminho é o que
    // TRAVA a org, porque bloqueia a criação por desenho.
    const lookupVendor = ("vendor" in lookup ? lookup.vendor : null) ?? null;
    console.warn(
      "[notificame] resale reconciliation unavailable:",
      lookup.code,
      lookupVendor?.code ?? "",
      lookupVendor?.message ?? "",
    );
    await markFailed(
      admin,
      subaccountRowId,
      mode === "adopt_only" ? (priorErrorCode ?? "reconcile_required") : "resale_unavailable",
    );
    return {
      ok: false,
      code: mode === "adopt_only"
        ? "subaccount_needs_reconciliation"
        : "subaccount_provision_failed",
      vendor: lookupVendor,
    };
  }

  if (lookup.status === "found") {
    // ADOÇÃO. O `acccount_id` da revenda é o mesmo token que o POST devolveria —
    // e é isto que torna `token_persist_failed` recuperável em vez de fatal.
    companyId = lookup.accountToken;
  } else if (lookup.status === "found_without_token" || lookup.status === "duplicated") {
    // Existe do outro lado e não dá para adotar em segurança. Criar agora é
    // empilhar mais uma subconta faturável sobre um problema que já é manual.
    await markFailed(
      admin,
      subaccountRowId,
      lookup.status === "duplicated" ? "resale_duplicated" : "resale_token_unreadable",
    );
    return { ok: false, code: "subaccount_needs_reconciliation" };
  } else if (mode === "adopt_only") {
    // A revenda diz "absent", mas a tentativa anterior PODE ter criado: uma conta
    // recém-nascida pode ainda não aparecer na listagem, e `token_persist_failed`
    // é prova documental de que ela existe. Este é o ponto exato onde a retomada
    // cega fabricava a segunda subconta irremovível com o MESMO `vendor_email`.
    // Restaura o estado terminal SEM perder o código original, que é a trilha.
    await markFailed(admin, subaccountRowId, priorErrorCode ?? "reconcile_required");
    return { ok: false, code: "subaccount_needs_reconciliation" };
  } else {
    // Ausente na revenda E nenhuma tentativa anterior tocou a criação. É o único
    // caminho do módulo que gasta dinheiro — e ele roda com deadline.
    try {
      companyId = await withDeadline(CREATE_ACCOUNT_TIMEOUT_MS, fetchImpl, (f) =>
        createSubaccount(
          parent,
          {
            organizationId,
            orgName,
            defaults,
            // Aleatória e descartada: ver cabeçalho. `crypto.randomUUID` existe em
            // Deno e em qualquer runtime moderno.
            password: crypto.randomUUID(),
          },
          f,
        ));
    } catch (err) {
      // (g) Falha — código NOSSO na coluna, nunca o corpo do fornecedor. E o
      // código aqui não é diagnóstico: é a autorização da próxima tentativa.
      // O default é o lado seguro (`transport_error` ⇒ NÃO retomável): a
      // requisição pode ter chegado e a resposta ter se perdido.
      const code = err instanceof DeadlineExceeded
        ? "create_account_timeout"
        : err instanceof NotificameError
        ? err.code
        : "create_account_transport_error";
      await markFailed(admin, subaccountRowId, code);
      // ⚠️ A COLUNA continua recebendo só `code`; o que o fornecedor DISSE sai por
      // aqui, no retorno, para o log de servidor. Esta é a recusa mais cara do
      // módulo — é a que decide se uma subconta faturável nasceu — e era a que não
      // deixava rastro nenhum além do nosso código genérico.
      const vendor = err instanceof NotificameError ? err.vendor : null;
      console.warn(
        "[notificame] POST /v2/accounts recusado:",
        code,
        vendor?.code ?? "",
        vendor?.message ?? "",
      );
      return { ok: false, code: "subaccount_provision_failed", vendor };
    }
  }

  // (f) Sucesso — cifra e promove a 'ready'. O CHECK da tabela impede que uma
  // escrita parcial se passe por pronta. `last_error_code` só é zerado AQUI: até
  // este ponto ele é a memória que protege a próxima tentativa.
  try {
    const enc = await encryptSecret(companyId, keyHex);
    const { error: updErr } = await admin
      .from("notificame_subaccounts")
      .update({
        company_uuid_ciphertext: enc.ciphertext,
        company_uuid_nonce: enc.nonce,
        encryption_key_id: NOTIFICAME_ENCRYPTION_KEY_ID,
        status: "ready",
        vendor_email: vendorEmail,
        provisioned_at: new Date().toISOString(),
        last_error_code: null,
      })
      .eq("id", subaccountRowId);
    if (updErr) throw new Error(updErr.message);
  } catch (err) {
    // A subconta EXISTE no fornecedor e nós não conseguimos guardar o token.
    // `token_persist_failed` fica FORA de `RESUMABLE_LAST_ERROR_CODES`: a próxima
    // tentativa tem direito de ADOTAR (e a adoção conserta isto sozinha, porque o
    // `acccount_id` da revenda é o mesmo token), mas nunca de criar. Nunca apagar
    // a linha — apagá-la faria a próxima tentativa criar uma SEGUNDA subconta.
    console.warn("[notificame] failed to persist subaccount token:", (err as Error)?.message);
    await markFailed(admin, subaccountRowId, "token_persist_failed");
    return { ok: false, code: "subaccount_provision_failed" };
  }

  return {
    ok: true,
    subaccount: { id: subaccountRowId, organizationId, companyUuid: companyId },
  };
}
