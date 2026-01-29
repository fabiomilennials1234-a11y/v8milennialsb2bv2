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
  // Remove common formatting characters
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');
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
  const validOrigins = ["calendly", "whatsapp", "meta_ads", "remarketing", "base_clientes", "parceiro", "indicacao", "quiz", "site", "organico", "outro", "cal", "ambos"];
  if (data.origin && !validOrigins.includes(data.origin)) {
    errors.push(`Origin inválido. Deve ser um dos: ${validOrigins.join(", ")}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
