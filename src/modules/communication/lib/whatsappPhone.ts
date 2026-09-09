/** DDDs que existem no Brasil (Anatel). Fora dessa lista não há como discar. */
const BR_AREA_CODES = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/**
 * Normaliza para 55 + DDD + número (8 dígitos para fixos, 9 para celulares).
 * Retorna `null` quando o telefone não pode ser um número brasileiro.
 *
 * Por que validar em vez de só concatenar: o código antigo fazia
 * `return '55' + cleaned` incondicionalmente, então qualquer lixo de 11 dígitos
 * virava um número "válido" que só falhava lá na ponta, com a Uazapi
 * respondendo 500 "the number ... is not on WhatsApp" — que chegava no
 * operador como "Edge Function returned a non-2xx status code". Havia 159 leads
 * em 24 orgs nessa condição (levantamento 2026-07-29). Melhor recusar aqui, com
 * mensagem que aponta pro cadastro, do que fingir que dá e falhar opaco.
 *
 * Nota sobre o "55" do início: ele só é tratado como código de país quando o
 * comprimento total obriga (12 ou 13 dígitos). Um número local de 11 dígitos
 * começando com 55 é DDD 55 (Santa Maria/RS) — o código antigo decepava esses
 * dois dígitos e rejeitava o resto por ficar curto, quebrando 40 leads em 13
 * orgs que nunca conseguiram receber mensagem.
 */
export function formatPhoneForWhatsApp(phone: string | undefined): string | null {
  if (!phone) return null;

  let cleaned = phone.replace(/\D/g, '');

  // "55" na frente só é DDI se o tamanho não couber num número local.
  // 12 = 55 + DDD + 8 dígitos; 13 = 55 + DDD + 9 dígitos.
  if (cleaned.startsWith('55') && (cleaned.length === 12 || cleaned.length === 13)) {
    cleaned = cleaned.substring(2);
  }

  // DDD às vezes vem discado como "011"
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }

  // WhatsApp Business também usa fixos. Inserir 9 em um fixo muda o destino.
  if (cleaned.length === 10 && /^[2-5]/.test(cleaned.substring(2))) {
    return BR_AREA_CODES.has(Number(cleaned.substring(0, 2))) ? '55' + cleaned : null;
  }

  // Celular no formato antigo (DDD + 8 dígitos): recebe o nono dígito.
  if (cleaned.length === 10) {
    cleaned = cleaned.substring(0, 2) + '9' + cleaned.substring(2);
  }

  // A partir daqui só passa o que tem cara de celular BR de verdade.
  if (cleaned.length !== 11) return null;
  if (!BR_AREA_CODES.has(Number(cleaned.substring(0, 2)))) return null;
  // Celular no Brasil começa com 9 desde a migração do nono dígito (2016).
  if (cleaned[2] !== '9') return null;

  return '55' + cleaned;
}

