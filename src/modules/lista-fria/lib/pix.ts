/**
 * PIX "copia e cola" (BR Code estático, padrão EMV do Banco Central) para a compra de créditos (ADR-0045).
 *
 * Gerado no navegador, sem serviço de terceiro: o código leva a chave, o valor do pacote e uma referência
 * (`txid`) que o cliente copia para o Chamado de "Já paguei". Nada aqui é segredo: a chave PIX existe para
 * ser divulgada.
 *
 * Limite honesto: o QR estático NÃO confirma pagamento. Não há webhook nem banco consultado; o time confere
 * o dinheiro na conta e libera os créditos à mão.
 */

export interface RecebedorPix {
  /** Chave PIX como cadastrada (aleatória, e-mail, telefone com +55, CPF ou CNPJ). */
  chave: string;
  /** Nome do recebedor (aparece para o pagador confirmar). Até 25 caracteres. */
  nome: string;
  /** Cidade do recebedor. Até 15 caracteres. */
  cidade: string;
}

/**
 * Conta que recebe. `null` = ainda não configurada: a tela avisa e oferece o Chamado em vez de mostrar um QR
 * que mande o dinheiro para o lugar errado.
 */
export const RECEBEDOR_PIX: RecebedorPix | null = null;

/** CRC-16/CCITT-FALSE (poly 0x1021, início 0xFFFF), em 4 dígitos hexadecimais maiúsculos. */
export function crc16(texto: string): string {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Campo EMV: id (2) + tamanho (2 dígitos) + valor. */
const campo = (id: string, valor: string): string => {
  if (valor.length > 99) throw new Error(`campo ${id} do PIX passa de 99 caracteres`);
  return `${id}${String(valor.length).padStart(2, "0")}${valor}`;
};

/** O BR Code é ASCII: tira acento e o que não for letra, número ou espaço, e corta no limite. */
export function textoParaPix(texto: string, max: number): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, max);
}

/** Referência de até 25 letras e números: o cliente a leva no Chamado e o time acha o PIX no extrato. */
export function novaReferencia(agora: number = Date.now(), aleatorio: () => number = Math.random): string {
  const sufixo = Math.floor(aleatorio() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `LF${agora.toString(36)}${sufixo}`.toUpperCase().slice(0, 25);
}

export const referenciaValida = (ref: string): boolean => /^[A-Za-z0-9]{1,25}$/.test(ref);

/** "7125" centavos -> "71.25" (formato do campo 54), sem ponto flutuante. */
export const valorParaPix = (centavos: number): string =>
  `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, "0")}`;

export function payloadPix(p: { recebedor: RecebedorPix; valorCentavos: number; referencia: string }): string {
  const { recebedor, valorCentavos, referencia } = p;
  const chave = recebedor.chave.trim();
  if (chave.length < 1 || chave.length > 77) throw new Error("chave PIX inválida");
  if (!Number.isInteger(valorCentavos) || valorCentavos < 1 || valorCentavos > 99_999_999) throw new Error("valor do PIX inválido");
  if (!referenciaValida(referencia)) throw new Error("referência do PIX inválida");
  const nome = textoParaPix(recebedor.nome, 25);
  const cidade = textoParaPix(recebedor.cidade, 15);
  if (!nome || !cidade) throw new Error("nome e cidade do recebedor são obrigatórios");

  const semCrc =
    campo("00", "01") +
    campo("01", "11") +
    campo("26", campo("00", "br.gov.bcb.pix") + campo("01", chave)) +
    campo("52", "0000") +
    campo("53", "986") +
    campo("54", valorParaPix(valorCentavos)) +
    campo("58", "BR") +
    campo("59", nome) +
    campo("60", cidade) +
    campo("62", campo("05", referencia)) +
    "6304";
  return semCrc + crc16(semCrc);
}
