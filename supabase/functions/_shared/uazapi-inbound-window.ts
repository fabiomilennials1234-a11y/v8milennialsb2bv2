/** Count a complete inbound window using documented /message/find pagination.
 * Unknown coverage returns null: a truncated sample must never trigger a rebind.
 */
export async function countUazapiInboundWindow(
  baseUrl: string,
  token: string,
  cutoffSeconds: number,
  options: { pageSize?: number; maxPages?: number; timeoutMs?: number } = {},
): Promise<number | null> {
  const limit = options.pageSize ?? 200;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000);
  let offset = 0;
  let previousTimestamp = Infinity;
  let count = 0;
  const seen = new Set<string>();
  try {
    for (let page = 0; page < (options.maxPages ?? 10); page++) {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/message/find`, {
        method: 'POST', headers: { token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit, offset }), signal, redirect: 'error',
      });
      if (!response.ok) return null;
      const body = await response.json();
      const rows = Array.isArray(body) ? body : body?.messages ?? body?.data;
      if (!Array.isArray(rows)) return null;
      let reachedCutoff = false;
      for (const row of rows) {
        const rawTime = row?.messageTimestamp ?? row?.timestamp;
        const timestamp = typeof rawTime === 'number' && rawTime >= 1e12 ? rawTime / 1000 : rawTime;
        const id = row?.id ?? row?.messageid;
        if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp > previousTimestamp
          || typeof id !== 'string' || !id || typeof row.fromMe !== 'boolean' || typeof row.isGroup !== 'boolean') return null;
        previousTimestamp = timestamp;
        if (timestamp < cutoffSeconds) { reachedCutoff = true; continue; }
        if (!seen.has(id) && !row.fromMe && !row.isGroup && !String(row.chatid ?? '').endsWith('@g.us')) count++;
        seen.add(id);
      }
      if (reachedCutoff || body?.hasMore === false) return count;
      if (body?.hasMore === true) {
        if (!rows.length || !Number.isSafeInteger(body.nextOffset) || body.nextOffset <= offset) return null;
        offset = body.nextOffset;
      } else {
        if (rows.length < limit) return count;
        offset += rows.length;
      }
    }
  } catch { /* Network, malformed JSON and time budget all mean unknown coverage. */ }
  return null;
}
