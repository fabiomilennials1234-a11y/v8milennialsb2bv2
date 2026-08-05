/**
 * O destino da ligação, na forma que o WhatsApp entende.
 *
 * ─── o defeito que isto conserta ────────────────────────────────────────────
 *
 * `leads.normalized_phone` é uma CHAVE DE BUSCA, não um número discável. A
 * definição está em `_shared/lead-service.ts` (`normalizePhoneForSearch`) e
 * espelhada em `_shared/copilot-v2/phone-normalizer.ts`: ela REMOVE o 55 de
 * propósito, para que `+55 51 98596-0716`, `5551985960716` e `51985960716`
 * virem a mesma chave e casem entre si.
 *
 * O plano de voz lia essa chave e mandava para a VPS como se fosse um número
 * discável. A VPS monta `"+" + dígitos` e pergunta ao WhatsApp:
 *
 *     51985960716  →  +51985960716  →  +51 é o PERU
 *
 * Medido em produção em 2026-08-03: duas tentativas, as duas com
 * `end_reason = 'vps_refused:51985960716: number is not on WhatsApp'`. O
 * WhatsApp respondeu certo — aquele número peruano não existe. O JID real do
 * lead é `555185960716`.
 *
 * O defeito é estrutural, não um lead azarado: quase todo DDD brasileiro de
 * dois dígitos colide com um código de país real (27 África do Sul, 31 Holanda,
 * 33 França, 44 Reino Unido, 48 Polônia, 51 Peru, 54 Argentina, 55 o próprio
 * Brasil, 61 Austrália, 81 Japão, 86 China, 91 Índia…). Ele só não aparecia
 * sempre porque, quando os dígitos NÃO formam um número válido no país do
 * prefixo, o servidor do WhatsApp acaba resolvendo para o contato certo. Com
 * `+51 985960716` — celular peruano perfeitamente válido — não há para onde
 * cair, e a recusa é limpa.
 *
 * ─── por que a regra mora aqui, e não na VPS ────────────────────────────────
 *
 * A VPS fala com o WhatsApp e sabe o FORMATO que ele quer (internacional com
 * `+`), mas não tem como saber o PAÍS: ela não vê lead, nem org, nem locale —
 * recebe dígitos numa claim assinada. Pôr "assuma Brasil" lá dentro seria
 * escrever uma regra de país num serviço que se apresenta como gateway neutro
 * de WhatsApp, e que amanhã atende outro chamador.
 *
 * O CRM é quem sabe. E, mais forte que isso: o CRM é quem SABE QUE
 * `normalized_phone` é chave de busca com o DDI removido de propósito. A
 * informação que falta ao número foi removida aqui; ela tem que ser reposta
 * aqui. Não espalha regra por chamador porque só existe UM produtor de `peer`
 * — o choke de `authorizeCallAndMint` — e é o mesmo lugar que já carimba o
 * `peer_phone` do ledger, o teto por destino e a claim do token.
 *
 * ─── por que não reusar `normalizeBrazilianPhone` ───────────────────────────
 *
 * `_shared/whatsapp-dispatch.ts` já tem uma função com esse nome, usada por
 * todo o caminho de mensagem. Ela decide por prefixo:
 *
 *     if (!phone.startsWith("55")) phone = "55" + phone;
 *
 * Isso quebra o DDD 55 (Santa Maria/RS e região). `55999887766` — DDD 55,
 * celular — já começa com "55", então ela NÃO põe o DDI, e o número sai como
 * se fosse `+55 9998-87766`. Produção tem **726 leads** exatamente nessa forma
 * (11 dígitos, DDD 55, nono dígito presente). Copiar a regra de prefixo para o
 * plano de voz seria importar um defeito medido.
 *
 * A regra abaixo decide por COMPRIMENTO, que é o que distingue as formas sem
 * ambiguidade — o mesmo critério que `normalizePhoneForSearch` já usa na
 * direção inversa (`length >= 12 && startsWith("55")` para remover).
 *
 * ─── o nono dígito NÃO é problema desta função ──────────────────────────────
 *
 * O JID real do WhatsApp costuma ter oito dígitos após o DDD (`555185960716`)
 * enquanto o cadastro tem nove (`51985960716`). Quem resolve essa variante é o
 * `IsOnWhatsApp` no servidor do WhatsApp — é para isso que ele existe
 * (`cmd/server/peerjid.go`). Inventar regra de pôr ou tirar o 9 no cliente foi
 * exatamente o que produziu o defeito da chamada muda meses atrás. Esta função
 * põe o número no formato internacional e para por aí.
 */

/**
 * Formas de número brasileiro, em dígitos:
 *
 *   | dígitos | forma                     | exemplo         |
 *   |---------|---------------------------|-----------------|
 *   | 10      | DDD + 8 (fixo / pré-9)    | 5185960716      |
 *   | 11      | DDD + 9 + 8 (celular)     | 51985960716     |
 *   | 12      | 55 + DDD + 8              | 555185960716    |
 *   | 13      | 55 + DDD + 9 + 8          | 5551985960716   |
 *
 * As duas primeiras são domésticas e precisam do DDI. As duas últimas já estão
 * internacionais e não podem ser tocadas.
 */
const BR_DOMESTIC_LENGTHS = new Set([10, 11]);

/**
 * Repõe o DDI brasileiro quando — e só quando — os dígitos têm a forma de um
 * número doméstico brasileiro.
 *
 * Contrato, em uma frase: **10 ou 11 dígitos ganham `55` na frente; qualquer
 * outra coisa sai como entrou.**
 *
 * O que isso garante, que é a parte que o teste guarda:
 *
 *   - `51985960716`   (11) → `5551985960716`   — o caso medido em produção
 *   - `48996458738`   (11) → `5548996458738`   — o segundo caso medido
 *   - `5551985960716` (13) → `5551985960716`   — já com DDI, INTOCADO
 *   - `555185960716`  (12) → `555185960716`    — o JID real, INTOCADO
 *   - `55999887766`   (11) → `5555999887766`   — DDD 55, ganha o DDI (726 leads)
 *
 * O limite aceito, declarado: um número estrangeiro de 10 ou 11 dígitos
 * guardado SEM o `+` é indistinguível de um brasileiro doméstico e ganharia o
 * `55` errado. Não é hipótese confortável, é medida: em produção, dos 32.807
 * leads com 11 dígitos, nenhum tem forma estrangeira reconhecível — todos os
 * DDDs observados são brasileiros. O ICP do produto são fábricas e
 * distribuidoras B2B no Brasil. Quando um campo de país existir no lead, ele é
 * quem manda aqui; até lá, a alternativa (não repor nada) deixa o defeito de
 * pé para 100% da base.
 */
export function toDialDigits(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  return BR_DOMESTIC_LENGTHS.has(digits.length) ? `55${digits}` : digits;
}
