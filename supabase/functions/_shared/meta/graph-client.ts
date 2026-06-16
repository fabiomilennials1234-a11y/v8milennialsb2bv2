/**
 * meta-graph-client — pure Meta Graph API wrapper for the agency System-User
 * model (ADR-0009). No DB, no global state. All network I/O goes through an
 * injectable `fetchImpl` so the client is testable without touching Meta.
 *
 * The token is the Torque Meta System User token (or a derived page token,
 * passed per-call where the Graph endpoint requires a page-scoped token).
 */

const DEFAULT_VERSION = "v21.0";
const GRAPH_BASE = "https://graph.facebook.com";

export type FetchImpl = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface MetaGraphClientOptions {
  token: string;
  fetchImpl?: FetchImpl;
  version?: string;
}

export interface MetaAdAccount {
  id: string;
  name: string;
  account_id: string;
  account_status: number;
}

export interface MetaPage {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string };
}

export interface MetaLeadForm {
  id: string;
  name: string;
  status: string;
}

export interface MetaLeadFieldDatum {
  name: string;
  values: string[];
}

export interface MetaLead {
  id: string;
  created_time: string;
  field_data: MetaLeadFieldDatum[];
}

export interface FetchLeadsResult {
  leads: MetaLead[];
  /** Newest lead's created_time as epoch seconds, or null if no leads. Used as the next poll cursor. */
  newestCreatedTime: number | null;
}

/**
 * Normalizes a Graph `error` object into an Error. Deliberately carries only
 * the Graph-supplied message + code — never the access token, which would
 * otherwise leak through logs/Sentry if callers print the error.
 */
function graphError(error: { message?: string; code?: number; type?: string }): Error {
  const code = error.code != null ? ` (code ${error.code})` : "";
  return new Error(`Meta Graph error: ${error.message ?? "unknown"}${code}`);
}

export function createMetaGraphClient(opts: MetaGraphClientOptions) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const version = opts.version ?? DEFAULT_VERSION;
  const base = `${GRAPH_BASE}/${version}`;

  /**
   * Walks a paginated Graph edge, following `paging.next` until exhausted,
   * accumulating every `data` row. `firstUrl` is the fully-formed first URL.
   */
  async function paginate<T>(firstUrl: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | null = firstUrl;
    while (url) {
      const res = await fetchImpl(url);
      const json = await res.json();
      if (json.error) throw graphError(json.error);
      for (const row of json.data ?? []) out.push(row as T);
      url = json.paging?.next ?? null;
    }
    return out;
  }

  async function listAdAccounts(): Promise<MetaAdAccount[]> {
    const url =
      `${base}/me/adaccounts?fields=id,name,account_id,account_status&limit=100&access_token=${opts.token}`;
    return paginate<MetaAdAccount>(url);
  }

  /**
   * Lists Pages the System User can reach for a business: its own
   * (`owned_pages`) plus partner-shared client Pages (`client_pages`), merged
   * and deduped by id (owned first). `/me/accounts` is NOT used — it only
   * surfaces the token owner's own pages, missing partner-access client pages
   * (validated 2026-06-15: it returned 1 page while 25 ad accounts were shared).
   */
  async function listPages(businessId: string): Promise<MetaPage[]> {
    const fields = "id,name,access_token,instagram_business_account";
    const owned = await paginate<MetaPage>(
      `${base}/${businessId}/owned_pages?fields=${fields}&limit=100&access_token=${opts.token}`,
    );
    const client = await paginate<MetaPage>(
      `${base}/${businessId}/client_pages?fields=${fields}&limit=100&access_token=${opts.token}`,
    );
    const seen = new Set<string>();
    const merged: MetaPage[] = [];
    for (const p of [...owned, ...client]) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      merged.push(p);
    }
    return merged;
  }

  /** Lists the active Lead Ads forms of a page (page-scoped token). */
  async function listLeadForms(pageId: string, pageToken: string): Promise<MetaLeadForm[]> {
    return paginate<MetaLeadForm>(
      `${base}/${pageId}/leadgen_forms?fields=id,name,status&limit=100&access_token=${pageToken}`,
    );
  }

  /**
   * Pulls Lead Ads submissions for a form via a page-scoped token. When
   * `since` (epoch seconds) is given, only leads created after it are
   * requested (Graph `time_created GREATER_THAN` filter). Returns the leads
   * plus the newest created_time as the next poll cursor. Dedup by leadgen id
   * is the caller's responsibility (poller, slice 4).
   */
  async function fetchLeadsSince(
    formId: string,
    pageToken: string,
    since?: number,
  ): Promise<FetchLeadsResult> {
    const params = new URLSearchParams({
      fields: "id,created_time,field_data",
      limit: "100",
      access_token: pageToken,
    });
    if (since != null) {
      params.set(
        "filtering",
        JSON.stringify([
          { field: "time_created", operator: "GREATER_THAN", value: since },
        ]),
      );
    }
    const leads = await paginate<MetaLead>(`${base}/${formId}/leads?${params}`);

    let newestCreatedTime: number | null = null;
    for (const lead of leads) {
      const t = Math.floor(Date.parse(lead.created_time) / 1000);
      if (newestCreatedTime == null || t > newestCreatedTime) newestCreatedTime = t;
    }

    return { leads, newestCreatedTime };
  }

  /**
   * Sends a Lead Conversion Signal back to Meta via the Conversions API
   * (ADR-0009). Keyed by the Meta lead id (`user_data.lead_id`),
   * `action_source: system_generated`. Carries NO monetary value by policy —
   * revenue is never exposed to Meta. `eventName` is one of the escalated
   * funnel events (qualified | meeting | sold).
   */
  /**
   * Lists the datasets (a.k.a. pixels / event sets) a given Ad Account can use,
   * via /{act}/adspixels. Lets the dispatcher auto-resolve the conversion
   * destination instead of the master typing a dataset id by hand. Returns
   * [] when none, multiple when the account has several.
   */
  async function listAdAccountDatasets(adAccountId: string): Promise<Array<{ id: string; name: string }>> {
    return paginate<{ id: string; name: string }>(
      `${base}/${adAccountId}/adspixels?fields=id,name&limit=50&access_token=${opts.token}`,
    );
  }

  async function sendConversion(input: {
    datasetId: string;
    leadId: string;
    eventName: string;
    eventTime?: number;
  }): Promise<{ events_received: number }> {
    const payload = {
      data: [
        {
          event_name: input.eventName,
          event_time: input.eventTime ?? Math.floor(Date.now() / 1000),
          action_source: "system_generated",
          user_data: { lead_id: input.leadId },
        },
      ],
    };

    const res = await fetchImpl(`${base}/${input.datasetId}/events?access_token=${opts.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (json.error) throw graphError(json.error);
    return json;
  }

  return { listAdAccounts, listAdAccountDatasets, listPages, listLeadForms, fetchLeadsSince, sendConversion };
}
