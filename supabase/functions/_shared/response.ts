/**
 * Standardized API response envelope for Supabase Edge Functions
 *
 * Provides consistent response formatting with versioned envelopes,
 * request tracing, and backward-compatible field spreading for v1 clients.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApiMeta {
  request_id: string;
  api_version: number;
  deprecated?: boolean;
  deprecation_notice?: string;
}

export interface ApiSuccessResponse<T = Record<string, unknown>> {
  success: true;
  data: T;
  meta: ApiMeta;
  // v1 backward compat: T's fields are spread at top level
  [key: string]: unknown;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
  details?: unknown;
  meta: ApiMeta;
}

export type ApiResponse<T = Record<string, unknown>> =
  | ApiSuccessResponse<T>
  | ApiErrorResponse;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_API_VERSION = 1;
const MAX_API_VERSION = 1;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generates a unique request ID using the Web Crypto API (available in Deno).
 */
export function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Reads the requested API version from the `X-API-Version` header.
 * Defaults to 1 and clamps to the valid range [MIN_API_VERSION, MAX_API_VERSION].
 */
export function getApiVersion(req?: Request): number {
  if (!req) return MIN_API_VERSION;

  const raw = req.headers.get("X-API-Version");
  if (!raw) return MIN_API_VERSION;

  const parsed = Number(raw);
  if (Number.isNaN(parsed) || !Number.isFinite(parsed)) return MIN_API_VERSION;

  return Math.max(MIN_API_VERSION, Math.min(MAX_API_VERSION, Math.floor(parsed)));
}

// ---------------------------------------------------------------------------
// Response builders
// ---------------------------------------------------------------------------

export interface SuccessResponseOptions {
  req?: Request;
  deprecated?: boolean;
  deprecation_notice?: string;
}

/**
 * Builds a JSON response with the standard success envelope.
 *
 * For API version 1 the data fields are spread at the top level of the
 * response body for backward compatibility with existing clients.
 */
export function successResponse<T>(
  data: T,
  corsHeaders: Record<string, string>,
  options: SuccessResponseOptions = {},
): Response {
  const { req, deprecated, deprecation_notice } = options;

  const apiVersion = getApiVersion(req);
  const requestId = generateRequestId();

  const meta: ApiMeta = {
    request_id: requestId,
    api_version: apiVersion,
  };

  if (deprecated) meta.deprecated = true;
  if (deprecation_notice) meta.deprecation_notice = deprecation_notice;

  // Build the response body
  // For v1: spread data fields at top level for backward compat
  const body: Record<string, unknown> =
    apiVersion === 1 && data && typeof data === "object" && !Array.isArray(data)
      ? { ...data, success: true, data, meta }
      : { success: true, data, meta };

  const headers = new Headers({
    "Content-Type": "application/json",
    "X-API-Version": String(apiVersion),
    "X-Request-ID": requestId,
    ...corsHeaders,
  });

  return new Response(JSON.stringify(body), { status: 200, headers });
}

export interface ErrorResponseOptions {
  req?: Request;
  details?: unknown;
}

/**
 * Builds a JSON error response with the standard error envelope.
 */
export function errorResponse(
  status: number,
  error: string,
  corsHeaders: Record<string, string>,
  options: ErrorResponseOptions = {},
): Response {
  const { req, details } = options;

  const apiVersion = getApiVersion(req);
  const requestId = generateRequestId();

  const meta: ApiMeta = {
    request_id: requestId,
    api_version: apiVersion,
  };

  const body: ApiErrorResponse = {
    success: false,
    error,
    meta,
  };

  if (details !== undefined) body.details = details;

  const headers = new Headers({
    "Content-Type": "application/json",
    "X-API-Version": String(apiVersion),
    "X-Request-ID": requestId,
    ...corsHeaders,
  });

  return new Response(JSON.stringify(body), { status, headers });
}

export interface DeprecatedResponseOptions {
  req?: Request;
  sunset?: string; // ISO 8601 date for the Sunset header
}

/**
 * Convenience wrapper that marks a successful response as deprecated.
 *
 * Sets `Deprecation: true` and optionally a `Sunset` header with the
 * provided date so clients can plan their migration.
 */
export function deprecatedResponse<T>(
  data: T,
  notice: string,
  corsHeaders: Record<string, string>,
  options: DeprecatedResponseOptions = {},
): Response {
  const { req, sunset } = options;

  const response = successResponse(data, corsHeaders, {
    req,
    deprecated: true,
    deprecation_notice: notice,
  });

  // Append deprecation-specific headers to the already-built response
  response.headers.set("Deprecation", "true");
  if (sunset) response.headers.set("Sunset", sunset);

  return response;
}
