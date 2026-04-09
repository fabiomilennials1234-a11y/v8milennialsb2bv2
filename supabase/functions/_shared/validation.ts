/**
 * Input validation helpers for Supabase Edge Functions
 */

export interface WebhookLeadInput {
  name?: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  origin?: string;
  segment?: string | null;
  faturamento?: string | null;
  urgency?: string | null;
  notes?: string | null;
  rating?: number | string | null;
  sdr_id?: string | null;
  closer_id?: string | null;
  responsible_id?: string | null;
  meeting_date?: string | null;
  compromisso_date?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
}

/**
 * Validates email format
 */
export function isValidEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validates phone format (basic validation)
 */
export function isValidPhone(phone: string | null | undefined): boolean {
  if (!phone) return true; // Phone is optional
  // Remove common formatting characters (including + prefix)
  const cleaned = phone.replace(/[\s\-\(\)\+]/g, '');
  // Check if it's a valid phone number (at least 10 digits)
  return /^\d{10,15}$/.test(cleaned);
}

/**
 * Sanitizes string input to prevent XSS
 * SECURITY: Comprehensive sanitization against multiple XSS vectors
 */
export function sanitizeString(input: string | null | undefined, maxLength = 1000): string | null {
  if (!input) return null;
  
  // Trim and limit length
  let sanitized = input.trim().slice(0, maxLength);
  
  // SECURITY: Comprehensive HTML entity encoding
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;',
  };
  
  sanitized = sanitized.replace(/[&<>"'`=/]/g, (char) => htmlEntities[char] || char);
  
  // SECURITY: Remove javascript: and data: URLs
  sanitized = sanitized.replace(/javascript\s*:/gi, '');
  sanitized = sanitized.replace(/data\s*:/gi, '');
  sanitized = sanitized.replace(/vbscript\s*:/gi, '');
  
  // SECURITY: Remove event handlers (onclick, onerror, etc.)
  sanitized = sanitized.replace(/on\w+\s*=/gi, '');
  
  // SECURITY: Remove expression() (IE CSS expression)
  sanitized = sanitized.replace(/expression\s*\(/gi, '');
  
  // SECURITY: Remove null bytes
  sanitized = sanitized.replace(/\x00/g, '');
  
  return sanitized;
}

/**
 * Sanitizes string for use in HTML context (display only)
 * Use this when the string will be rendered in HTML
 */
export function sanitizeForHtml(input: string | null | undefined): string {
  if (!input) return '';
  
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  
  return input.replace(/[&<>"']/g, (char) => htmlEntities[char] || char);
}

/**
 * Sanitizes URL to prevent javascript: and data: URLs
 */
export function sanitizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  
  const trimmed = url.trim().toLowerCase();
  
  // SECURITY: Block dangerous URL schemes
  const dangerousSchemes = ['javascript:', 'data:', 'vbscript:', 'file:'];
  for (const scheme of dangerousSchemes) {
    if (trimmed.startsWith(scheme)) {
      return null;
    }
  }
  
  // Only allow http, https, and relative URLs
  if (!trimmed.startsWith('http://') && 
      !trimmed.startsWith('https://') && 
      !trimmed.startsWith('/') &&
      !trimmed.startsWith('./') &&
      !trimmed.startsWith('../')) {
    // If no scheme, assume https
    return `https://${url.trim()}`;
  }
  
  return url.trim();
}

/**
 * Validates lead input data
 */
export function validateLeadInput(data: WebhookLeadInput): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Name is required
  if (!data.name || data.name.trim().length === 0) {
    errors.push("Nome é obrigatório");
  } else if (data.name.length > 200) {
    errors.push("Nome deve ter no máximo 200 caracteres");
  }

  // Email validation (if provided)
  if (data.email && !isValidEmail(data.email)) {
    errors.push("Email inválido");
  }

  // Phone validation (if provided)
  if (data.phone && !isValidPhone(data.phone)) {
    errors.push("Telefone inválido");
  }

  // Rating validation
  if (data.rating !== undefined && data.rating !== null) {
    const ratingNum = typeof data.rating === 'string' ? parseInt(data.rating, 10) : data.rating;
    if (isNaN(ratingNum) || ratingNum < 0 || ratingNum > 10) {
      errors.push("Rating deve ser um número entre 0 e 10");
    }
  }

  // Origin validation
  const validOrigins = ["whatsapp", "meta_ads", "instagram", "tiktok", "google_ads", "site", "landing_page", "remarketing", "indicacao", "evento", "prospeccao_ativa", "cal", "outro", "calendly", "base_clientes", "parceiro", "quiz", "organico", "ambos"];
  if (data.origin && !validOrigins.includes(data.origin)) {
    errors.push(`Origin inválido. Deve ser um dos: ${validOrigins.join(", ")}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates RFC 4122 UUID format
 */
export function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Validates ISO 8601 date string
 * Rejects nonsensical dates like "2026-13-45" even if Date constructor doesn't throw
 */
export function isValidISODate(value: string): boolean {
  const d = new Date(value);
  if (isNaN(d.getTime())) return false;

  // Extract the date portion (YYYY-MM-DD) from the input to cross-check
  const datePortion = value.slice(0, 10);
  return d.toISOString().startsWith(datePortion);
}

/**
 * Validates that an array does not exceed the maximum allowed size
 */
export function validateArraySize(
  arr: unknown[],
  maxSize: number,
  fieldName: string,
): { valid: boolean; error?: string } {
  if (arr.length > maxSize) {
    return { valid: false, error: `${fieldName}: máximo de ${maxSize} itens permitidos` };
  }
  return { valid: true };
}

/**
 * Validates that a referenced ID exists in a given table scoped to the organization
 */
export async function validateReferencedId(
  supabase: any,
  table: string,
  id: string,
  orgId: string,
): Promise<{ exists: boolean; error?: string }> {
  if (!isValidUUID(id)) {
    return { exists: false, error: `${table}: ID inválido (formato UUID esperado)` };
  }

  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (error) {
    return { exists: false, error: `${table}: erro ao verificar referência` };
  }

  if (!data) {
    return { exists: false, error: `${table}: ID não encontrado nesta organização` };
  }

  return { exists: true };
}
