/**
 * Meta Graph API helper functions
 * Used by meta-oauth-callback, meta-webhook, send-meta-message, refresh-meta-tokens
 */

import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";

const GRAPH_API_VERSION = "v21.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MetaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

export interface MetaPage {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: {
    id: string;
  };
}

export interface MetaPageWithInstagram extends MetaPage {
  instagram_username?: string;
}

export interface MetaUser {
  id: string;
  name: string;
}

export interface MetaLeadgenData {
  id: string;
  form_id: string;
  field_data: Array<{ name: string; values: string[] }>;
  created_time: string;
}

export interface MetaMessagePayload {
  recipient: { id: string };
  message: {
    text?: string;
    attachment?: {
      type: string;
      payload: { url: string };
    };
  };
  messaging_type: string;
}

// ---------------------------------------------------------------------------
// OAuth / Token Exchange
// ---------------------------------------------------------------------------

/**
 * Exchange authorization code for short-lived access token
 */
export async function exchangeCodeForToken(code: string): Promise<MetaTokenResponse> {
  const appId = Deno.env.get("META_APP_ID");
  const appSecret = Deno.env.get("META_APP_SECRET");
  const redirectUri = Deno.env.get("META_REDIRECT_URI");

  if (!appId || !appSecret || !redirectUri) {
    throw new Error("Missing META_APP_ID, META_APP_SECRET, or META_REDIRECT_URI");
  }

  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  });

  const res = await fetch(`${GRAPH_API_BASE}/oauth/access_token?${params}`);
  const data = await res.json();

  if (data.error) {
    throw new Error(`Meta OAuth error: ${data.error.message}`);
  }

  return data as MetaTokenResponse;
}

/**
 * Exchange short-lived token for long-lived token (~60 days)
 */
export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<MetaTokenResponse> {
  const appId = Deno.env.get("META_APP_ID");
  const appSecret = Deno.env.get("META_APP_SECRET");

  if (!appId || !appSecret) {
    throw new Error("Missing META_APP_ID or META_APP_SECRET");
  }

  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLivedToken,
  });

  const res = await fetch(`${GRAPH_API_BASE}/oauth/access_token?${params}`);
  const data = await res.json();

  if (data.error) {
    throw new Error(`Meta token exchange error: ${data.error.message}`);
  }

  return data as MetaTokenResponse;
}

// ---------------------------------------------------------------------------
// User & Pages
// ---------------------------------------------------------------------------

/**
 * Get authenticated Facebook user info
 */
export async function getMe(accessToken: string): Promise<MetaUser> {
  const res = await fetch(`${GRAPH_API_BASE}/me?fields=id,name&access_token=${accessToken}`);
  const data = await res.json();

  if (data.error) {
    throw new Error(`Meta getMe error: ${data.error.message}`);
  }

  return data as MetaUser;
}

/**
 * List all pages the user manages, with page access tokens and Instagram accounts
 */
export async function listPages(userAccessToken: string): Promise<MetaPageWithInstagram[]> {
  const pages: MetaPageWithInstagram[] = [];
  let url: string | null =
    `${GRAPH_API_BASE}/me/accounts?fields=id,name,access_token,instagram_business_account&limit=100&access_token=${userAccessToken}`;

  while (url) {
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      throw new Error(`Meta listPages error: ${data.error.message}`);
    }

    for (const page of data.data || []) {
      const pageWithIg: MetaPageWithInstagram = { ...page };

      // If page has Instagram Business account, fetch username
      if (page.instagram_business_account?.id) {
        try {
          const igRes = await fetch(
            `${GRAPH_API_BASE}/${page.instagram_business_account.id}?fields=username&access_token=${page.access_token}`
          );
          const igData = await igRes.json();
          if (igData.username) {
            pageWithIg.instagram_username = igData.username;
          }
        } catch (err) {
          console.warn(`[META-API] Failed to fetch IG username for page ${page.id}:`, err);
        }
      }

      pages.push(pageWithIg);
    }

    url = data.paging?.next || null;
  }

  return pages;
}

// ---------------------------------------------------------------------------
// Webhook Subscription
// ---------------------------------------------------------------------------

/**
 * Subscribe a page to receive webhook events (messages, leadgen)
 */
export async function subscribePageWebhook(pageId: string, pageAccessToken: string): Promise<boolean> {
  const res = await fetch(
    `${GRAPH_API_BASE}/${pageId}/subscribed_apps`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscribed_fields: ["messages", "messaging_postbacks", "feed", "leadgen"],
        access_token: pageAccessToken,
      }),
    }
  );

  const data = await res.json();

  if (data.error) {
    console.error(`[META-API] Subscribe webhook error for page ${pageId}:`, data.error);
    return false;
  }

  return data.success === true;
}

/**
 * Unsubscribe a page from webhook events
 */
export async function unsubscribePageWebhook(pageId: string, pageAccessToken: string): Promise<boolean> {
  const res = await fetch(
    `${GRAPH_API_BASE}/${pageId}/subscribed_apps?access_token=${pageAccessToken}`,
    { method: "DELETE" }
  );

  const data = await res.json();
  return data.success === true;
}

// ---------------------------------------------------------------------------
// Sending Messages
// ---------------------------------------------------------------------------

/**
 * Send a message via Messenger or Instagram Direct
 */
export async function sendMessage(
  pageAccessToken: string,
  recipientId: string,
  text: string,
  channel: "messenger" | "instagram",
  pageId?: string,
  igAccountId?: string
): Promise<{ message_id: string; recipient_id: string }> {
  // Messenger uses page_id, Instagram uses ig_account_id
  const senderId = channel === "instagram" ? igAccountId : pageId;
  if (!senderId) {
    throw new Error(`Missing ${channel === "instagram" ? "igAccountId" : "pageId"} for sending`);
  }

  const endpoint = channel === "instagram"
    ? `${GRAPH_API_BASE}/${senderId}/messages`
    : `${GRAPH_API_BASE}/${senderId}/messages`;

  const payload: MetaMessagePayload = {
    recipient: { id: recipientId },
    message: { text },
    messaging_type: "RESPONSE",
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${pageAccessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (data.error) {
    throw new Error(`Meta sendMessage error: ${data.error.message} (code: ${data.error.code})`);
  }

  return data;
}

/**
 * Send a media attachment via Messenger or Instagram Direct
 */
export async function sendMediaMessage(
  pageAccessToken: string,
  recipientId: string,
  mediaUrl: string,
  mediaType: "image" | "video" | "audio" | "file",
  channel: "messenger" | "instagram",
  pageId?: string,
  igAccountId?: string
): Promise<{ message_id: string; recipient_id: string }> {
  const senderId = channel === "instagram" ? igAccountId : pageId;
  if (!senderId) {
    throw new Error(`Missing sender ID for ${channel}`);
  }

  const payload = {
    recipient: { id: recipientId },
    message: {
      attachment: {
        type: mediaType,
        payload: { url: mediaUrl, is_reusable: true },
      },
    },
    messaging_type: "RESPONSE",
  };

  const res = await fetch(`${GRAPH_API_BASE}/${senderId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${pageAccessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (data.error) {
    throw new Error(`Meta sendMedia error: ${data.error.message}`);
  }

  return data;
}

// ---------------------------------------------------------------------------
// Lead Ads TOS
// ---------------------------------------------------------------------------

/**
 * Accept Lead Ads Terms of Service for a page.
 * Called automatically during OAuth connection.
 */
export async function acceptLeadgenTos(
  pageId: string,
  pageAccessToken: string
): Promise<boolean> {
  try {
    const res = await fetch(
      `${GRAPH_API_BASE}/${pageId}/leadgen_tos`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: pageAccessToken }),
      }
    );
    const data = await res.json();
    if (data.error) {
      console.warn(`[META-API] acceptLeadgenTos failed for ${pageId}:`, data.error.message);
      return false;
    }
    return data.success === true || data.accepted === true;
  } catch (err) {
    console.warn(`[META-API] acceptLeadgenTos error for ${pageId}:`, err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Lead Ads
// ---------------------------------------------------------------------------

/**
 * Fetch lead data from a leadgen event
 */
export async function getLeadgenData(
  leadgenId: string,
  pageAccessToken: string
): Promise<MetaLeadgenData> {
  const res = await fetch(
    `${GRAPH_API_BASE}/${leadgenId}?access_token=${pageAccessToken}`
  );

  const data = await res.json();

  if (data.error) {
    throw new Error(`Meta getLeadgenData error: ${data.error.message}`);
  }

  return data as MetaLeadgenData;
}

/**
 * List active lead forms for a page.
 * Returns tos_not_accepted flag when the page hasn't accepted Lead Ads TOS.
 */
export async function listLeadForms(
  pageId: string,
  pageAccessToken: string
): Promise<{
  forms: Array<{ id: string; name: string; status: string }>;
  tos_not_accepted?: boolean;
  tos_accept_url?: string;
}> {
  // Check if page has accepted Lead Ads TOS
  const tosRes = await fetch(
    `${GRAPH_API_BASE}/${pageId}?fields=leadgen_tos_accepted&access_token=${pageAccessToken}`
  );
  const tosData = await tosRes.json();

  if (!tosData.leadgen_tos_accepted) {
    return {
      forms: [],
      tos_not_accepted: true,
      tos_accept_url: `https://www.facebook.com/ads/leadgen/tos?page_id=${pageId}`,
    };
  }

  // Paginate through all lead forms
  const forms: Array<{ id: string; name: string; status: string }> = [];
  let formsUrl: string | null =
    `${GRAPH_API_BASE}/${pageId}/leadgen_forms?fields=id,name,status&limit=100&access_token=${pageAccessToken}`;

  while (formsUrl) {
    const res = await fetch(formsUrl);
    const data = await res.json();

    if (data.error) {
      throw new Error(`Meta listLeadForms error: ${data.error.message}`);
    }

    if (data.data) {
      forms.push(...data.data);
    }

    formsUrl = data.paging?.next || null;
  }

  return { forms };
}

/**
 * Get the fields/questions of a specific lead form
 */
export async function getLeadFormFields(
  formId: string,
  pageAccessToken: string
): Promise<Array<{ key: string; label: string; type: string }>> {
  const res = await fetch(
    `${GRAPH_API_BASE}/${formId}?fields=questions&access_token=${pageAccessToken}`
  );

  const data = await res.json();

  if (data.error) {
    throw new Error(`Meta getLeadFormFields error: ${data.error.message}`);
  }

  return (data.questions || []).map((q: { key: string; label: string; type: string }) => ({
    key: q.key,
    label: q.label,
    type: q.type,
  }));
}

// ---------------------------------------------------------------------------
// Webhook Verification
// ---------------------------------------------------------------------------

/**
 * Verify Meta webhook signature (X-Hub-Signature-256)
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string | null
): boolean {
  const appSecret = Deno.env.get("META_APP_SECRET");

  if (!appSecret) {
    console.error("[META-API] META_APP_SECRET not configured");
    return false;
  }

  if (!signature) {
    return false;
  }

  const expectedSignature = "sha256=" +
    createHmac("sha256", appSecret)
      .update(payload)
      .digest("hex");

  // Timing-safe comparison to prevent timing attacks
  const encoder = new TextEncoder();
  const sigBuf = encoder.encode(signature);
  const expectedBuf = encoder.encode(expectedSignature);
  if (sigBuf.length !== expectedBuf.length) {
    // Compare against expectedBuf to avoid leaking length info through timing
    const dummy = new Uint8Array(expectedBuf.length);
    try { crypto.subtle.timingSafeEqual(expectedBuf, dummy); } catch { /* ignore */ }
    return false;
  }
  try {
    return crypto.subtle.timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Token Refresh
// ---------------------------------------------------------------------------

/**
 * Refresh a long-lived token (returns new long-lived token)
 */
export async function refreshLongLivedToken(currentToken: string): Promise<MetaTokenResponse> {
  return exchangeForLongLivedToken(currentToken);
}

/**
 * Build the Meta Login Dialog URL for OAuth
 */
export function buildLoginUrl(state?: string, options?: { authType?: string }): string {
  const appId = Deno.env.get("META_APP_ID");
  const redirectUri = Deno.env.get("META_REDIRECT_URI");

  if (!appId || !redirectUri) {
    throw new Error("Missing META_APP_ID or META_REDIRECT_URI");
  }

  const scopes = [
    "pages_manage_metadata",
    "pages_messaging",
    "pages_read_engagement",
    "pages_manage_ads",
    "instagram_manage_messages",
    "instagram_basic",
    "leads_retrieval",
  ].join(",");

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: scopes,
    response_type: "code",
    ...(state ? { state } : {}),
  });

  if (options?.authType) {
    params.set("auth_type", options.authType);
  }

  return `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?${params}`;
}
