/**
 * Base-URL guard for ERPs hospedados no cliente (on-premise).
 *
 * Omie e Tiny são SaaS: a URL é constante e vive no código. O Toth roda dentro
 * da rede do cliente, então cada org traz a SUA `base_url` — e uma URL vinda do
 * usuário, consumida por uma função de servidor, é SSRF por construção: sem
 * guarda, um admin de qualquer org faz a nossa Edge Function bater em
 * `http://169.254.169.254/` (metadata da nuvem), em `http://127.0.0.1:54321`
 * (Kong/PostgREST local) ou em qualquer host da rede interna do provedor, e nos
 * devolve a resposta.
 *
 * Este módulo é a única porta por onde uma base_url do Toth entra. É puro de
 * propósito — a decisão inteira é testável sem rede.
 *
 * ⚠️ Limite conhecido e aceito: isto valida o **hostname**, não o IP resolvido.
 * Um domínio público que resolve para 10.x.x.x (DNS rebinding) passa. Fechar
 * isso exigiria resolver o DNS e fixar o IP no socket, o que o `fetch` do Deno
 * não expõe. Mitigações em vigor: HTTPS obrigatório (o alvo precisa de
 * certificado válido para o nome), credencial no cofre e escopo somente-leitura.
 * Se um dia isso virar risco material, a saída é um proxy de egresso com
 * allowlist, não mais regex aqui.
 */

export class UnsafeErpUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeErpUrlError";
  }
}

/**
 * As duas permissões são SEPARADAS de propósito.
 *
 * São riscos diferentes e a Café Jurerê precisa exatamente de uma: o ERP dela
 * está publicado num host público de DDNS **sem TLS**, então `allowHttp` é uma
 * decisão comercial consciente (a credencial trafega em claro). Já
 * `allowPrivateHosts` é a guarda de SSRF, e continua fechada — o host ser
 * público não autoriza ninguém a apontar a integração para `10.x` ou para o
 * endpoint de metadata. Um flag único faria a concessão de transporte abrir a
 * porta de rede junto, sem que ninguém tivesse pedido.
 */
export interface BaseUrlPolicy {
  /** Aceita `http://`. Por conexão, com aceite explícito do admin. */
  allowHttp?: boolean;
  /** Aceita loopback e faixas privadas. SOMENTE desenvolvimento local. */
  allowPrivateHosts?: boolean;
}

/** Hostnames que nunca podem ser alvo, mesmo com DNS público. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);

/** Sufixos de domínio que só existem dentro de uma rede. */
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

function parseIPv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    // `01` e `1e2` não são octetos válidos; exigir dígitos puros sem zero à
    // esquerda evita a interpretação octal que alguns resolvers ainda fazem.
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/** Faixas IPv4 que não devem ser alcançáveis a partir de uma Edge Function. */
function isBlockedIPv4([a, b]: number[]): boolean {
  if (a === 0) return true; // 0.0.0.0/8 — "este host"
  if (a === 10) return true; // 10/8 — privada
  if (a === 127) return true; // 127/8 — loopback
  if (a === 169 && b === 254) return true; // 169.254/16 — link-local + metadata da nuvem
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 — privada
  if (a === 192 && b === 168) return true; // 192.168/16 — privada
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 — CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 — benchmark
  if (a === 192 && b === 0) return true; // 192.0.0/24 — IETF protocol assignments
  if (a >= 224) return true; // 224/4 multicast + 240/4 reservado
  return false;
}

/**
 * Desembrulha o IPv4 de um endereço IPv4-mapeado.
 *
 * Aceita as DUAS grafias, porque o parser de URL converte uma na outra: o
 * `new URL("https://[::ffff:127.0.0.1]")` serializa o host como
 * `[::ffff:7f00:1]`. Checar só a forma decimal deixa o loopback passar.
 */
function unwrapMappedIPv4(addr: string): number[] | null {
  if (!addr.startsWith("::ffff:")) return null;
  const rest = addr.slice("::ffff:".length);

  if (rest.includes(".")) return parseIPv4(rest);

  const groups = rest.split(":");
  if (groups.length !== 2) return null;
  const [hi, lo] = groups.map((g) => parseInt(g, 16));
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
  return [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255];
}

function isBlockedIPv6(host: string): boolean {
  const addr = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (addr === "::1" || addr === "::") return true;

  const mapped = unwrapMappedIPv4(addr);
  if (mapped !== null) return isBlockedIPv4(mapped);
  // `::ffff:` com resto irreconhecível: recusa por precaução.
  if (addr.startsWith("::ffff:")) return true;

  const head = addr.split(":")[0];
  if (/^f[cd]/.test(head)) return true; // fc00::/7 — unique local
  if (/^fe[89ab]/.test(head)) return true; // fe80::/10 — link local
  return false;
}

/**
 * Valida e normaliza a base_url de um ERP on-premise.
 *
 * Devolve a URL normalizada (sem barra final no path) ou lança
 * `UnsafeErpUrlError` com motivo legível — a mensagem sobe pra UI de conexão,
 * então precisa explicar o que o admin deve corrigir.
 */
/**
 * Tira o que vem grudado quando se cola um endereço de uma mensagem.
 *
 * Aspas, parênteses e — o caso que apareceu na conexão real de 19/08 — o ponto
 * final da frase. O endereço chegou como `.../users/login.`, e o ponto sozinho
 * impediu o casamento do sufixo, produzindo `/users/login./users/login` e um 404
 * que parecia defeito do servidor do cliente.
 */
function sanitizePastedUrl(raw: string): string {
  return (raw ?? "")
    .trim()
    .replace(/^[<("'\s]+/, "")
    .replace(/[>)"'\s.,;:]+$/, "");
}

export function assertSafeErpBaseUrl(raw: string, policy: BaseUrlPolicy = {}): URL {
  const trimmed = sanitizePastedUrl(raw);
  if (!trimmed) throw new UnsafeErpUrlError("Informe o endereço da API do ERP.");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new UnsafeErpUrlError(
      "Endereço inválido. Use o formato https://host/caminho (ex.: https://erp.exemplo.com.br/toth/services).",
    );
  }

  if (url.protocol !== "https:" && !(policy.allowHttp && url.protocol === "http:")) {
    throw new UnsafeErpUrlError(
      "O endereço precisa começar com https:// — em http:// a senha e o token trafegam em texto claro. " +
        "Se o ERP ainda não tem certificado, marque explicitamente a conexão como sem criptografia.",
    );
  }

  // Credencial embutida na URL vaza em log e em toda mensagem de erro.
  if (url.username || url.password) {
    throw new UnsafeErpUrlError("Não use usuário e senha dentro da URL.");
  }

  const host = url.hostname.toLowerCase();

  if (!policy.allowPrivateHosts) {
    if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
      throw new UnsafeErpUrlError(
        `"${url.hostname}" só existe dentro da rede do ERP. Informe o endereço público publicado para a integração.`,
      );
    }
    const v4 = parseIPv4(host);
    if (v4 !== null && isBlockedIPv4(v4)) {
      throw new UnsafeErpUrlError(
        `O IP ${url.hostname} é de rede interna e não é alcançável a partir do CRM. Informe o endereço público.`,
      );
    }
    if (host.includes(":") && isBlockedIPv6(host)) {
      throw new UnsafeErpUrlError(
        `O IP ${url.hostname} é de rede interna e não é alcançável a partir do CRM. Informe o endereço público.`,
      );
    }
  }

  // Normaliza: sem query, sem fragmento, sem barra final — o client concatena
  // `${base}/users/login` e uma barra duplicada quebra roteador de path.
  url.search = "";
  url.hash = "";
  url.pathname = stripEndpointSuffix(url.pathname.replace(/\/+$/, ""));
  return url;
}

/**
 * Endpoints que a pessoa pode colar junto sem perceber.
 *
 * O campo pede a BASE (`/toth/services`), mas o que se tem à mão é a URL de um
 * endpoint, copiada do Postman. Colar `.../toth/services/users/login` fazia o
 * client montar `.../users/login/users/login` e o ERP devolver 404 — erro que
 * parece "o endpoint não existe" quando é só um sufixo sobrando.
 *
 * Aconteceu na primeira tentativa real de conexão (19/08). Tolerar aqui é mais
 * barato que explicar na mensagem de erro, e cada sufixo removido é um caminho
 * a menos para um 404 sem causa aparente.
 */
const ENDPOINT_SUFFIXES = ["/users/login", "/clientes", "/cobrancas"];

function stripEndpointSuffix(pathname: string): string {
  for (const suffix of ENDPOINT_SUFFIXES) {
    if (pathname.toLowerCase().endsWith(suffix)) {
      return pathname.slice(0, -suffix.length);
    }
  }
  return pathname;
}
