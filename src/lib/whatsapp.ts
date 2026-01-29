// Format phone number for WhatsApp: 55 + DDD (without 0) + number (add 9 if short)
export function formatPhoneForWhatsApp(phone: string | undefined): string | null {
  if (!phone) return null;
  
  // Remove all non-numeric characters
  let cleaned = phone.replace(/\D/g, '');
  
  // If already starts with 55, remove it to reprocess
  if (cleaned.startsWith('55')) {
    cleaned = cleaned.substring(2);
  }
  
  // Remove leading 0 from DDD if present
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }
  
  // If number is too short (DDD + 8 digits = 10), add 9 after DDD
  // DDD is 2 digits, so if total is 10, we need to add 9
  if (cleaned.length === 10) {
    cleaned = cleaned.substring(0, 2) + '9' + cleaned.substring(2);
  }
  
  // Add country code
  return '55' + cleaned;
}

export function openWhatsApp(phone: string | undefined, e?: React.MouseEvent) {
  if (e) {
    e.stopPropagation();
  }
  
  const formattedPhone = formatPhoneForWhatsApp(phone);
  if (formattedPhone) {
    window.open(`https://wa.me/${formattedPhone}`, '_blank', 'noopener,noreferrer');
  }
}
