/**
 * Validação do comprador ANTES de enviar — e o motivo não é ergonomia.
 *
 * O CANAL QUE ISTO FECHA: os três campos do comprador viajam como ARGUMENTO da
 * RPC. Se o documento for inválido, `billing_prefill_link_buyer` levanta 22023
 * e o evento de erro nasce carregando o payload — CPF e e-mail junto. Medido no
 * log do Postgres (issue #1560), e o mesmo vale para o objeto de erro que
 * chegaria ao Sentry.
 *
 * Validar aqui não elimina o canal, mas elimina a OCORRÊNCIA: o valor inválido
 * deixa de ser enviado, então o erro que o carregaria deixa de existir. Achado
 * do Sentinela na volta 2.
 *
 * E NÃO, ISTO NÃO CONTRADIZ "não duplique o gate": as duas validações servem a
 * coisas diferentes. A do banco é INVARIANTE — não pode sair, vale para
 * qualquer escritor, inclusive o checkout público. A daqui é "não envie lixo",
 * e a consequência de ela divergir para MENOS é um round-trip a mais, não um
 * dado errado gravado. Gate duplicado é perigoso quando as duas cópias são a
 * autoridade; aqui só uma é.
 *
 * O documento é validado com DÍGITO VERIFICADOR, não só tamanho. O banco checa
 * 11 ou 14 dígitos porque é o que um CHECK consegue afirmar barato; a tela
 * consegue mais, e o erro que ela evita é o mais comum de todos — o dedo trocado
 * no meio do número, que passa em qualquer contagem de dígitos.
 */

export function onlyDigits(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

/** CPF: dois dígitos verificadores, módulo 11. */
export function isValidCPF(raw: string): boolean {
  const d = onlyDigits(raw);
  if (d.length !== 11) return false;
  // Sequências repetidas passam no módulo 11 e são sempre inválidas na Receita.
  if (/^(\d)\1{10}$/.test(d)) return false;

  for (const [len, pos] of [
    [9, 10],
    [10, 11],
  ] as const) {
    let soma = 0;
    for (let i = 0; i < len; i++) soma += Number(d[i]) * (pos - i);
    const resto = (soma * 10) % 11 % 10;
    if (resto !== Number(d[len])) return false;
  }
  return true;
}

/** CNPJ: dois dígitos verificadores, pesos 5..2 / 6..2. */
export function isValidCNPJ(raw: string): boolean {
  const d = onlyDigits(raw);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  const calc = (len: number): number => {
    let peso = len - 7;
    let soma = 0;
    for (let i = 0; i < len; i++) {
      soma += Number(d[i]) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export function isValidTaxId(raw: string): boolean {
  const d = onlyDigits(raw);
  if (d.length === 11) return isValidCPF(d);
  if (d.length === 14) return isValidCNPJ(d);
  return false;
}

/**
 * O MESMO regex do CHECK da tabela do comprador, de propósito: divergir para
 * MAIS aqui recusaria endereço que o banco aceita, e o operador ficaria sem
 * caminho nenhum.
 */
export function isValidEmail(raw: string): boolean {
  const e = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export interface BuyerInput {
  legalName: string;
  taxId: string;
  email: string;
}

export interface BuyerErrors {
  legalName?: string;
  taxId?: string;
  email?: string;
  /** Preenchimento pela metade: erro do CONJUNTO, não de um campo. */
  incomplete?: string;
}

/**
 * `null` = nada preenchido, que é estado VÁLIDO: pré-preencher é opcional e o
 * banco devolve `noop`. Objeto vazio = preenchido e válido. Com chaves = os
 * erros a exibir.
 */
export function validateBuyer(input: BuyerInput): BuyerErrors | null {
  const legalName = input.legalName.trim();
  const taxId = onlyDigits(input.taxId);
  const email = input.email.trim();

  if (!legalName && !taxId && !email) return null;

  const errors: BuyerErrors = {};

  // A regra do CONJUNTO vem primeiro e é a mesma da porta do banco: a Asaas
  // exige os três para criar cliente, então aceitar dois só adia a falta para o
  // momento da cobrança.
  if (!legalName || !taxId || !email) {
    errors.incomplete = "Nome, documento e e-mail andam juntos — preencha os três ou nenhum.";
  }

  if (taxId && !isValidTaxId(taxId)) {
    // A mensagem NÃO ecoa o valor. Prefixo de CPF em tela de erro é PII em
    // tela de erro, e daqui ela vai para print, para chamado e para log.
    errors.taxId =
      taxId.length === 11 || taxId.length === 14
        ? "Documento inválido — confira os dígitos."
        : "Documento precisa ter 11 dígitos (CPF) ou 14 (CNPJ).";
  }

  if (email && !isValidEmail(email)) {
    errors.email = "E-mail inválido.";
  }

  return errors;
}
