import { metaGraphFetch } from "./meta-graph-request.ts";
export interface MetaAdAccount { id: string; name: string; currency?: string; account_status?: number }
export async function listBusinessAdAccounts(token: string, appId: string, systemUserId: string): Promise<MetaAdAccount[]> {
  if (!/^\d+$/.test(systemUserId)) throw new Error("invalid_system_user_subject");
  const accounts: MetaAdAccount[] = [];
  let url: string | undefined = `https://graph.facebook.com/v26.0/${systemUserId}/assigned_ad_accounts?fields=id,name,currency,account_status&limit=100`;
  const visited = new Set<string>();
  while (url) {
    if (visited.has(url) || visited.size >= 100) throw new Error("meta_ad_pagination_limit");
    visited.add(url);
    const response = await metaGraphFetch(url, { headers: { Authorization: `Bearer ${token}` } }, appId);
    const body = await response.json();
    if (!response.ok || body.error || !Array.isArray(body.data)) throw new Error("meta_ad_accounts_failed");
    for (const account of body.data) {
      if (!/^act_\d+$/.test(account.id) || typeof account.name !== "string") throw new Error("invalid_ad_account");
      accounts.push({ id: account.id, name: account.name, currency: account.currency, account_status: account.account_status });
    }
    url = body.paging?.next;
  }
  return accounts;
}
/** Only bounded, calendar-valid date ranges reach the insights endpoint. */
export function insightDateRange(since: unknown, until: unknown): { since: string; until: string } {
  const date = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!date(since) || !date(until)) throw new Error("invalid_date_range");
  const days = (Date.parse(until) - Date.parse(since)) / 86400000;
  if (days < 0 || days > 92) throw new Error("invalid_date_range");
  return { since, until };
}
