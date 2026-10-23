import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { metaPrivacyEndpoint } from "../_shared/meta-privacy-endpoint.ts";

// Meta callbacks authenticate by signed_request HMAC, never by a Supabase JWT.
Deno.serve(withErrorBoundary("meta-deauthorize", metaPrivacyEndpoint("deauthorization")));
