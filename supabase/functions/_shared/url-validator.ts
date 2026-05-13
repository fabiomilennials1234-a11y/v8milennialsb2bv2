const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
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

  if (isPrivateIp(hostname)) {
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
