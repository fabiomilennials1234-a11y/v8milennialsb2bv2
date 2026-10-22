/**
 * CPF, CNPJ e telefone do inadimplente.
 *
 * O banco guarda só dígitos e confere apenas o tamanho (11 ou 14). Os dígitos
 * verificadores são conferidos aqui, na tela, onde dá para avisar antes de
 * salvar — um CNPJ digitado errado vira um inadimplente duplicado depois.
 */

export function soDigitos(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\D/g, "");
}

function cpfValido(d: string): boolean {
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (base: string, pesoInicial: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return dv(d.slice(0, 9), 10) === Number(d[9]) && dv(d.slice(0, 10), 11) === Number(d[10]);
}

function cnpjValido(d: string): boolean {
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((acc, peso, i) => acc + Number(base[i]) * peso, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13]);
}

/** Vazio é válido (o documento é opcional); preenchido precisa fechar os dígitos. */
export function documentoValido(valor: string | null | undefined): boolean {
  const d = soDigitos(valor);
  if (d.length === 0) return true;
  if (d.length === 11) return cpfValido(d);
  if (d.length === 14) return cnpjValido(d);
  return false;
}

export function formatarDocumento(valor: string | null | undefined): string {
  const d = soDigitos(valor);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return valor ?? "";
}

/**
 * Telefone para o banco: só dígitos com DDI. Número brasileiro digitado sem o
 * 55 (10 ou 11 dígitos, com DDD) ganha o 55. Vazio → null.
 */
export function normalizarTelefone(valor: string | null | undefined): string | null {
  const d = soDigitos(valor);
  if (!d) return null;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

export function telefoneValido(valor: string | null | undefined): boolean {
  const d = normalizarTelefone(valor);
  return d === null || (d.length >= 10 && d.length <= 15);
}

/** `5548999990000` → `(48) 99999-0000`; fora do Brasil, `+DDI …`. */
export function formatarTelefone(valor: string | null | undefined): string {
  const d = soDigitos(valor);
  if (!d) return "";
  const br = d.startsWith("55") && (d.length === 12 || d.length === 13) ? d.slice(2) : d.length <= 11 ? d : null;
  if (br && br.length === 11) return br.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (br && br.length === 10) return br.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return `+${d}`;
}
