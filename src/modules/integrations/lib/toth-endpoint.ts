/**
 * Leitura do endereço do ERP Toth para a tela de conexão — puro, sem React.
 *
 * ⚠️ Isto é UX, **não** é a fronteira de segurança. A validação que vale é a do
 * servidor (`_shared/erp/toth-url.ts`), que roda antes de qualquer requisição
 * sair. O que existe aqui é feedback imediato: dizer ao admin, enquanto ele
 * digita, que o endereço não vai passar — e, principalmente, que aquele `http://`
 * significa senha trafegando em claro.
 *
 * Consequência de desenho: este módulo pode ser mais frouxo que o servidor sem
 * abrir risco, mas nunca mais permissivo no que ele AFIRMA. Se disser "ok" e o
 * servidor recusar, o usuário toma um erro no submit — irritante, não inseguro.
 */

export type TothEndpointVerdict = "vazio" | "invalido" | "inseguro" | "ok";

export interface TothEndpointReading {
  verdict: TothEndpointVerdict;
  /** Host normalizado, quando dá para extrair. */
  host: string | null;
  /** `true` quando o tráfego vai sem TLS — exige aceite explícito. */
  insecure: boolean;
  /** Mensagem para a tela. Vazia quando `verdict === "ok"`. */
  message: string;
}

/** Hosts que não existem fora da rede do ERP — o servidor também recusa. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);
const LOCAL_SUFFIXES = [".local", ".internal", ".localhost"];

function isPrivateIPv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return false;
  const [a, b] = parts.map(Number);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export function readTothEndpoint(raw: string): TothEndpointReading {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return { verdict: "vazio", host: null, insecure: false, message: "" };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return {
      verdict: "invalido",
      host: null,
      insecure: false,
      message: "Endereço incompleto. Comece com https:// ou http://",
    };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return {
      verdict: "invalido",
      host: null,
      insecure: false,
      message: "Use https:// ou http://",
    };
  }

  const host = url.hostname.toLowerCase();

  if (
    LOCAL_HOSTS.has(host) ||
    LOCAL_SUFFIXES.some((s) => host.endsWith(s)) ||
    isPrivateIPv4(host)
  ) {
    return {
      verdict: "invalido",
      host,
      insecure: url.protocol === "http:",
      message: `"${url.hostname}" só responde dentro da rede do ERP. O Torque roda na nuvem e precisa de um endereço acessível pela internet.`,
    };
  }

  if (url.protocol === "http:") {
    return {
      verdict: "inseguro",
      host,
      insecure: true,
      message:
        "Sem criptografia: a senha e o token do ERP trafegam em texto claro e podem ser lidos por quem estiver no caminho da rede.",
    };
  }

  return { verdict: "ok", host, insecure: false, message: "" };
}

/**
 * O formulário pode ser enviado?
 *
 * Regra central da tela: endereço sem TLS **só** passa com aceite explícito.
 * Deixar o botão ativo e falhar no servidor seria pior — o usuário levaria um
 * erro genérico em vez de entender que precisa decidir sobre o risco.
 */
export function canSubmitTothConnection(params: {
  endpoint: string;
  user: string;
  password: string;
  acceptedInsecure: boolean;
}): boolean {
  const reading = readTothEndpoint(params.endpoint);
  if (reading.verdict === "vazio" || reading.verdict === "invalido") return false;
  if (reading.insecure && !params.acceptedInsecure) return false;
  return params.user.trim().length > 0 && params.password.length > 0;
}
