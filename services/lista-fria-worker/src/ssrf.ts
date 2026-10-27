/**
 * Busca de página pública com proteção contra SSRF.
 *
 * O endereço do site vem do listing do Google Maps: texto de terceiro. Sem
 * guarda, um negócio cadastrado com `http://169.254.169.254/` ou `http://redis:6379`
 * faria o worker (que tem a chave de serviço do banco no ambiente) bater em
 * metadata de nuvem ou serviço interno.
 *
 * Regras:
 *   - só http/https, só portas 80/443, sem credencial na URL;
 *   - o IP é validado NO MOMENTO DA CONEXÃO (o `lookup` do socket), não antes: um
 *     DNS que responde público na checagem e privado na conexão (rebinding) não
 *     passa. Por isso usa `node:http(s)` e não `fetch`, que não deixa pinar;
 *   - redirecionamento é seguido à mão, até 3 saltos, e cada salto passa pelas
 *     mesmas regras;
 *   - corpo limitado em bytes, tempo limitado, só `text/html`.
 */
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

/** IPv4 ou IPv6 que NÃO é endereço público roteável. */
export function ipNaoPublico(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return v4NaoPublico(ip);
  if (v === 6) return v6NaoPublico(ip.toLowerCase());
  return true;
}

function v4NaoPublico(ip: string): boolean {
  const [a, b, c] = ip.split(".").map(Number);
  return (
    a === 0 || // "esta rede"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, inclusive metadata de nuvem
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) || // IETF
    (a === 192 && b === 0 && c === 2) || // TEST-NET-1
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast e reservado
  );
}

function v6NaoPublico(ip: string): boolean {
  if (ip === "::" || ip === "::1") return true;
  // IPv4 embutido (::ffff:a.b.c.d e a forma em hex) segue a regra do v4.
  const mapeado = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapeado) return v4NaoPublico(mapeado[1]);
  const hex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return v4NaoPublico(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const primeiro = parseInt(ip.split(":")[0] || "0", 16);
  return (
    (primeiro & 0xfe00) === 0xfc00 || // fc00::/7 ULA
    (primeiro & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (primeiro & 0xff00) === 0xff00 || // multicast
    ip.startsWith("64:ff9b:") || // NAT64
    ip.startsWith("2001:db8:") // documentação
  );
}

type Endereco = { address: string; family: number };
/** O socket chama com `all: true` (Node 20+, autoSelectFamily) e espera uma lista; sem isso, um endereço. */
type LookupCb = (err: NodeJS.ErrnoException | null, address: string | Endereco[], family?: number) => void;

/**
 * `lookup` para o socket: resolve o nome e recusa se QUALQUER resposta for não
 * pública (não basta escolher a primeira pública: o resolvedor pode alternar).
 */
export function lookupSeguro(
  resolver: typeof dns.lookup = dns.lookup,
): (host: string, opts: unknown, cb: LookupCb) => void {
  return (host, opts, cb) => {
    const querLista = typeof opts === "object" && opts !== null && (opts as { all?: boolean }).all === true;
    resolver(host, { all: true, verbatim: true }, (err, enderecos) => {
      if (err) return cb(err, "", 0);
      const lista = Array.isArray(enderecos) ? enderecos : [];
      if (lista.length === 0 || lista.some((e) => ipNaoPublico(e.address))) {
        const e: NodeJS.ErrnoException = new Error(`endereço não público para ${host}`);
        e.code = "ESSRF";
        return cb(e, "", 0);
      }
      if (querLista) return cb(null, lista.map((x) => ({ address: x.address, family: x.family })));
      cb(null, lista[0].address, lista[0].family);
    });
  };
}

export interface OpcoesDeBusca {
  timeoutMs?: number;
  maxBytes?: number;
  maxSaltos?: number;
  /** Troca o `lookup` (testes). Em produção é `lookupSeguro()`. */
  lookup?: (host: string, opts: unknown, cb: LookupCb) => void;
  /** Permite porta diferente de 80/443 (só testes). */
  portaLivre?: boolean;
}

export interface PaginaBuscada {
  url: string;
  html: string;
}

export function urlPermitida(bruta: string, portaLivre = false): URL | null {
  let u: URL;
  try {
    u = new URL(bruta);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (!portaLivre && u.port !== "" && u.port !== "80" && u.port !== "443") return null;
  if (u.hostname === "") return null;
  // IP literal na URL nem passa pelo DNS: confere aqui.
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && ipNaoPublico(host)) return null;
  return u;
}

function umaRequisicao(u: URL, o: Required<Pick<OpcoesDeBusca, "timeoutMs" | "maxBytes">> & OpcoesDeBusca) {
  return new Promise<{ status: number; location: string | null; tipo: string; corpo: string }>((resolve, reject) => {
    const modulo = u.protocol === "https:" ? https : http;
    const req = modulo.request(
      u,
      {
        method: "GET",
        lookup: o.lookup ?? lookupSeguro(),
        timeout: o.timeoutMs,
        headers: {
          "User-Agent": "TorqueListaFria/1.0 (+contato publico de negocios)",
          Accept: "text/html,application/xhtml+xml",
          // Sem compressão: o limite de bytes vale para o que chega, sem descompressor no meio.
          "Accept-Encoding": "identity",
        },
      },
      (res) => {
        const tipo = String(res.headers["content-type"] ?? "");
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === "string" ? res.headers.location : null;
        if (status >= 300 || !/text\/html|application\/xhtml/i.test(tipo)) {
          res.resume();
          return resolve({ status, location, tipo, corpo: "" });
        }
        const partes: Buffer[] = [];
        let total = 0;
        res.on("data", (b: Buffer) => {
          total += b.length;
          if (total > o.maxBytes) {
            partes.push(b.subarray(0, b.length - (total - o.maxBytes)));
            res.destroy();
            return;
          }
          partes.push(b);
        });
        const fim = () => resolve({ status, location, tipo, corpo: Buffer.concat(partes).toString("utf8") });
        res.on("end", fim);
        res.on("close", fim);
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("tempo esgotado")));
    req.on("error", reject);
    req.end();
  });
}

/** HTML da página, ou null se foi recusada, saiu do ar, não é HTML ou passou do limite de saltos. */
export async function buscarPagina(bruta: string, opcoes: OpcoesDeBusca = {}): Promise<PaginaBuscada | null> {
  const o = { timeoutMs: 8_000, maxBytes: 1_000_000, maxSaltos: 3, ...opcoes };
  let atual = urlPermitida(bruta, o.portaLivre);
  for (let salto = 0; atual && salto <= o.maxSaltos; salto++) {
    let r;
    try {
      r = await umaRequisicao(atual, o);
    } catch {
      return null;
    }
    if (r.status >= 300 && r.status < 400 && r.location) {
      let proxima: string;
      try {
        proxima = new URL(r.location, atual).toString();
      } catch {
        return null;
      }
      atual = urlPermitida(proxima, o.portaLivre);
      continue;
    }
    if (r.status < 200 || r.status >= 300 || r.corpo === "") return null;
    return { url: atual.toString(), html: r.corpo };
  }
  return null;
}
