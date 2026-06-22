const PII_KEY = /phone|email|password|token|secret|jwt/i;

function maskTail(value: string, keep = 4): string {
  if (value.length <= keep) return "*".repeat(value.length);
  return "*".repeat(value.length - keep) + value.slice(-keep);
}

function maskEmail(value: string): string {
  const at = value.indexOf("@");
  if (at <= 0) return maskTail(value);
  return `${value[0]}***${value.slice(at)}`;
}

function maskValue(key: string, value: string): string {
  return /email/i.test(key) && value.includes("@") ? maskEmail(value) : maskTail(value);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function redactEntry(key: string, value: unknown): unknown {
  if (PII_KEY.test(key) && typeof value === "string") return maskValue(key, value);
  if (Array.isArray(value)) return value.map((v) => (isPlainObject(v) ? redact(v) : v));
  if (isPlainObject(value)) return redact(value);
  return value;
}

/**
 * Redact PII from a params object before it is logged/returned.
 * Masks values of keys whose name looks like PII (phone/email/password/...),
 * recursing into nested objects and arrays of objects.
 */
export function redact(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = redactEntry(key, value);
  }
  return out;
}
