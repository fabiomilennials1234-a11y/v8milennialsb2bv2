import { describe, it, expect } from 'vitest';
import { compare } from '../../supabase/functions/_shared/workflow-condition-evaluator';

/**
 * Cantini Alimentos — bloco 03, nó `condition-2` ("Cidade é atendida?").
 *
 * Reproduz a condição EXATA que está no PROD (aplicada 06/08/2026):
 *   field    = custom.Cidade que está localizado o estabelecimento:
 *   operator = in_list
 *   value    = a lista abaixo
 *
 * O campo é preenchido À MÃO pelo vendedor — o motor não lê o texto da resposta
 * do lead. Por isso a lista precisa tolerar as formas que uma pessoa digita.
 * Os casos "digitado de verdade" abaixo saíram de `lead_custom_field_values`
 * no PROD, não são inventados.
 */

// Cópia literal do que está gravado no nó condition-2.
const CIDADES_ATENDIDAS = [
  'Porto Alegre', 'POA', 'P. Alegre', 'P.Alegre', 'PortoAlegre',
  'Porto Alegre/RS', 'Porto Alegre - RS', 'Porto Alegre RS',
  'Viamão', 'Viamao', 'Viamão/RS', 'Viamao/RS',
  'Gravataí', 'Gravatai', 'Gravataí/RS', 'Gravatai/RS',
  'Canoas', 'Canoas/RS',
  'Cachoeirinha', 'Cachoeirinha/RS',
  'Alvorada', 'Alvorada/RS',
  'Novo Hamburgo', 'NovoHamburgo', 'N. Hamburgo', 'NH', 'Novo Hamburgo/RS',
  'São Leopoldo', 'Sao Leopoldo', 'S. Leopoldo', 'São Leopoldo/RS', 'Sao Leopoldo/RS',
  'Esteio', 'Esteio/RS',
].join(', ');

const atendida = (digitado: string) => compare(digitado, 'in_list', CIDADES_ATENDIDAS);

describe('Cantini — condition-2 "Cidade é atendida?"', () => {
  describe('valores REAIS já digitados no PROD → devem ser atendidos', () => {
    // 5 leads
    it('"Porto Alegre" (forma oficial)', () => expect(atendida('Porto Alegre')).toBe(true));
    // a abreviação que o vendedor usou — só passa por causa da variação "POA"
    it('"Poa" (abreviação, capitalização diferente)', () => expect(atendida('Poa')).toBe(true));
    // digitado sem acento — só passa por causa da variação "Gravatai"
    it('"Gravatai" (sem acento)', () => expect(atendida('Gravatai')).toBe(true));
    it('"canoas" (tudo minúsculo)', () => expect(atendida('canoas')).toBe(true));
    it('"Canoas" (capitalizado)', () => expect(atendida('Canoas')).toBe(true));
    it('"Viamão" (com acento)', () => expect(atendida('Viamão')).toBe(true));
  });

  describe('valores REAIS de fora da área → devem ser recusados', () => {
    it('"Vacaria"', () => expect(atendida('Vacaria')).toBe(false));
    it('"Guaíba"', () => expect(atendida('Guaíba')).toBe(false));
    it('"Candelaria"', () => expect(atendida('Candelaria')).toBe(false));
    it('"Eldorado do sul"', () => expect(atendida('Eldorado do sul')).toBe(false));
    it('"Batcelos" (typo do vendedor)', () => expect(atendida('Batcelos')).toBe(false));
  });

  describe('as demais cidades da lista', () => {
    for (const cidade of ['Cachoeirinha', 'Alvorada', 'Novo Hamburgo', 'São Leopoldo', 'Esteio']) {
      it(`"${cidade}"`, () => expect(atendida(cidade)).toBe(true));
    }
    it('sem acento: "Sao Leopoldo"', () => expect(atendida('Sao Leopoldo')).toBe(true));
    it('com sufixo: "Canoas/RS"', () => expect(atendida('Canoas/RS')).toBe(true));
  });

  describe('⚠️ o buraco conhecido — campo NÃO preenchido', () => {
    /**
     * `getCustomFieldValue` devolve "" quando não há valor gravado. O `in_list`
     * então dá false, e a condição cai na MESMA saída de "cidade fora da área".
     * É a falha silenciosa: hoje esse ramo vai para um `end`, então o lead morre
     * sem ninguém saber. O teste existe para travar esse comportamento por
     * escrito — não porque ele esteja certo.
     */
    it('campo vazio → false (indistinguível de "não atendemos")', () => {
      expect(atendida('')).toBe(false);
    });
  });

  describe('⚠️ limites que a lista NÃO cobre (falham por design do operador)', () => {
    // `in_list` compara o valor INTEIRO, sem normalizar acento nem espaço.
    it('espaço extra no meio: "São  Leopoldo" → false', () => {
      expect(atendida('São  Leopoldo')).toBe(false);
    });
    it('cidade + estado por extenso: "Canoas - Rio Grande do Sul" → false', () => {
      expect(atendida('Canoas - Rio Grande do Sul')).toBe(false);
    });
    it('duas cidades no mesmo campo: "Canoas e Esteio" → false', () => {
      expect(atendida('Canoas e Esteio')).toBe(false);
    });
  });

  describe('⚠️ espaço em volta do valor digitado QUEBRA a comparação', () => {
    /**
     * `in_list` faz `.trim()` nos itens da LISTA, mas o valor do campo entra como
     * `String(fieldValue).toLowerCase()` — SEM trim (workflow-condition-evaluator.ts,
     * `const strField = fieldValue == null ? "" : String(fieldValue)`). Só
     * `is_empty`/`is_not_empty` aparam o valor do campo.
     *
     * Consequência: um espaço sobrando — o que sobra fácil de copiar e colar —
     * derruba a condição em silêncio, e o lead cai no mesmo ramo de "não
     * atendemos". No PROD já existem 26 valores de campo customizado com espaço
     * nas pontas (de 57.641). É raro, mas é real.
     */
    it('"  Canoas  " → false (o campo NÃO é aparado)', () => {
      expect(atendida('  Canoas  ')).toBe(false);
    });
    it('"Canoas " com um único espaço no fim → false', () => {
      expect(atendida('Canoas ')).toBe(false);
    });
    it('sem o espaço, o mesmo valor passa', () => {
      expect(atendida('Canoas')).toBe(true);
    });
  });
});
