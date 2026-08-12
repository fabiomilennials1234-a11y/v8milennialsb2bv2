const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  // Sem colchetes: `validateExternalUrl` remove os de `URL.hostname` antes de consultar
  // este Set. A entrada `"[::1]"` que existia aqui nunca casava com nada.
  "::1",
  "metadata.google.internal",
  "metadata.google.com",
]);

const PRIVATE_RANGES = [
  { start: 0x0a000000, end: 0x0affffff },   // 10.0.0.0/8
  { start: 0xac100000, end: 0xac1fffff },   // 172.16.0.0/12
  { start: 0xc0a80000, end: 0xc0a8ffff },   // 192.168.0.0/16
  { start: 0x7f000000, end: 0x7fffffff },   // 127.0.0.0/8
  { start: 0xa9fe0000, end: 0xa9feffff },   // 169.254.0.0/16 (link-local / cloud metadata)
  { start: 0x00000000, end: 0x00ffffff },   // 0.0.0.0/8
];

function ipToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = parseInt(p, 10);
    if (isNaN(v) || v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function isPrivateIp(ip: string): boolean {
  const n = ipToInt(ip);
  if (n === null) return false;
  return PRIVATE_RANGES.some((r) => n >= r.start && n <= r.end);
}

/**
 * Contraparte IPv6 de `isPrivateIp`. Sem ela, todo alvo interno bloqueado em IPv4
 * volta a ser alcançável pela notação IPv6 — inclusive o endpoint de metadados da
 * nuvem, via `::ffff:169.254.169.254`.
 *
 * O host chega aqui já sem os colchetes de `URL.hostname`.
 */
function isPrivateIpv6(host: string): boolean {
  // Zone id (`fe80::1%eth0`) não muda o destino — descarta antes de comparar.
  const h = host.toLowerCase().replace(/%.*$/, "");
  if (!h.includes(":")) return false;

  if (h === "::1" || h === "::") return true;

  // IPv4 mapeado, forma decimal (`::ffff:169.254.169.254`) e hexadecimal
  // (`::ffff:a9fe:a9fe`) — as duas apontam para o mesmo endereço IPv4.
  const dotted = /^(?:0*:)*:?ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (dotted) return isPrivateIp(dotted[1]);

  const hex = /^(?:0*:)*:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return isPrivateIp(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }

  if (/^fe[89ab][0-9a-f]?:/.test(h)) return true;  // fe80::/10 link-local
  if (/^f[cd][0-9a-f]{0,2}:/.test(h)) return true; // fc00::/7  unique local

  return false;
}

export function validateExternalUrl(raw: string): { valid: true; url: URL } | { valid: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { valid: false, reason: "Invalid URL" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { valid: false, reason: `Blocked protocol: ${parsed.protocol}` };
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  if (BLOCKED_HOSTS.has(hostname.toLowerCase())) {
    return { valid: false, reason: "Blocked host" };
  }

  if (isPrivateIp(hostname) || isPrivateIpv6(hostname)) {
    return { valid: false, reason: "Private IP not allowed" };
  }

  if (parsed.port && !["80", "443", ""].includes(parsed.port)) {
    const port = parseInt(parsed.port, 10);
    if (port < 1024) {
      return { valid: false, reason: "System port not allowed" };
    }
  }

  return { valid: true, url: parsed };
}
