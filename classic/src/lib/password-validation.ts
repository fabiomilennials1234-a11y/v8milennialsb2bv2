/**
 * Shared password validation — single source of truth for frontend + backend.
 * Minimum 12 chars, uppercase, lowercase, digit, special character.
 */

const SPECIAL_CHARS = /[!@#$%^&*()_+\-=\[\]{}|;:',.<>?]/;

export interface PasswordValidationResult {
  valid: boolean;
  message: string;
}

export function validatePassword(password: string): PasswordValidationResult {
  if (password.length < 12) {
    return { valid: false, message: 'A senha deve ter no mínimo 12 caracteres, incluindo maiúscula, minúscula, número e caractere especial.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'A senha deve ter no mínimo 12 caracteres, incluindo maiúscula, minúscula, número e caractere especial.' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'A senha deve ter no mínimo 12 caracteres, incluindo maiúscula, minúscula, número e caractere especial.' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'A senha deve ter no mínimo 12 caracteres, incluindo maiúscula, minúscula, número e caractere especial.' };
  }
  if (!SPECIAL_CHARS.test(password)) {
    return { valid: false, message: 'A senha deve ter no mínimo 12 caracteres, incluindo maiúscula, minúscula, número e caractere especial.' };
  }
  return { valid: true, message: '' };
}
