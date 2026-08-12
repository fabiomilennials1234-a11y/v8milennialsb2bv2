/**
 * codeNodes — o que os nós de código (JSON / JavaScript / HTTPS) precisam
 * responder no browser, antes de o workflow ser salvo.
 *
 * Puro de propósito: sem React e sem Supabase, para o editor e os testes
 * exercitarem exatamente a mesma função.
 *
 * Cada nó tem **uma única fonte**: o campo `code`, escrito à mão. O que está
 * escrito é o que roda — não há segunda fonte para reconciliar, nem no editor
 * nem no executor.
 *
 * A validação aqui é **advisory**: a RLS de `workflows` deixa qualquer membro
 * da org escrever `definition` direto pelo PostgREST, sem passar pelo editor.
 * Ela existe para o erro aparecer no save, e não no cliente do cliente.
 */

import {
  CODE_SOURCE_MAX_BYTES,
  CODE_WORKFLOW_MAX_BYTES,
  NODE_LABELS,
  type WorkflowNode,
  type WorkflowNodeType,
} from "@/types/workflow";

const CODE_NODE_TYPES: readonly string[] = ["code_json", "code_javascript", "code_https"];

/**
 * Host fictício do exemplo semeado. Mora aqui, e não no editor, porque o texto
 * semeado e o guard que o recusa precisam ser a MESMA verdade: se um mudar sem
 * o outro, ou o guard para de proteger, ou passa a reprovar um endereço válido.
 */
export const HTTPS_EXAMPLE_HOST = "api.exemplo.com";

/**
 * O que o nó HTTPS traz escrito ao ser criado. É a documentação do formato: a
 * requisição inteira num JSON só, e uma caixa vazia não diria quais chaves ele
 * espera. Como é válido o bastante para salvar, `validateCodeNodes` recusa
 * enquanto o host de exemplo continuar ali — senão o nó "ensinar" vira um nó
 * que dispara contra um domínio que não existe.
 */
export const HTTPS_CODE_EXAMPLE = `{
  "method": "POST",
  "url": "https://${HTTPS_EXAMPLE_HOST}/pedidos",
  "headers": {
    "Content-Type": "application/json",
    "Authorization": "Bearer SUA_CHAVE_AQUI"
  },
  "body": {
    "lead": "{{nome}}",
    "telefone": "{{telefone}}"
  },
  "timeoutMs": 10000
}`;

/** Os tipos cujo `code` é um JSON e portanto dá para conferir a forma no save. */
const JSON_SHAPED_TYPES: readonly string[] = ["code_json", "code_https"];

/**
 * Bytes UTF-8 do código do nó.
 *
 * `String.length` conta unidades UTF-16: um fonte de 40.000 caracteres
 * acentuados tem 80.000 bytes e passaria por um teto medido em `length`.
 */
export function codeNodeBytes(data: Record<string, unknown>): number {
  const code = typeof data.code === "string" ? data.code : "";
  return new TextEncoder().encode(code).length;
}

/** `{{a b}}` não é interpolável, e o executor reserva o prefixo `_`. */
const OUTPUT_VARIABLE = /^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/;

export function isValidOutputVariable(name: string): boolean {
  // `_retry_counts`, `_wait_resolved`, `_last_error`, `_replied_at`,
  // `_reply_channel` e `_wait_started_at` são estado da própria execução:
  // gravar por cima delas corromperia o controle do workflow.
  return OUTPUT_VARIABLE.test(name) && !name.startsWith("_");
}

/** O valor que cada `{{…}}` vira no JSON de teste. */
const VAR_STUB = "__var__";

/**
 * Troca cada `{{variavel}}` por um valor de teste, para o `JSON.parse` de
 * validação enxergar a FORMA do template em vez do texto cru.
 *
 * A troca é sensível a aspas porque as duas posições existem em template real:
 * `{"nome": "{{nome}}"}` já está dentro de uma string (vira `__var__`, sem
 * aspas novas) e `{"total": {{total}}}` não está (precisa das aspas). Trocar
 * sempre por `"__var__"` reprovaria o primeiro caso, que é o mais comum.
 */
function stubVariables(code: string): string {
  let out = "";
  let inString = false;
  let i = 0;

  while (i < code.length) {
    const ch = code[i];

    if (inString && ch === "\\") {
      out += code.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "{" && code[i + 1] === "{") {
      const fim = code.indexOf("}}", i + 2);
      if (fim !== -1) {
        out += inString ? VAR_STUB : `"${VAR_STUB}"`;
        i = fim + 2;
        continue;
      }
    }

    out += ch;
    i += 1;
  }

  return out;
}

/** `undefined` quando o fonte não parseia como JSON depois do stub das variáveis. */
function parseComoJson(source: string): unknown {
  try {
    return JSON.parse(stubVariables(source));
  } catch {
    return undefined;
  }
}

/**
 * A `url` do nó HTTPS, do jeito que dá para julgar no save.
 *
 * `ok` = não há nada a reclamar. Uma URL que COMEÇA por variável
 * (`{{base}}/pedidos` → `__var__/pedidos`) é aceita aqui de propósito: o valor
 * só existe em runtime, e reprovar no save bloquearia um template legítimo. O
 * `https://` obrigatório é reimposto no executor, que enxerga o valor real.
 */
function urlDoHttpsEstaOk(parsed: unknown): boolean {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;

  const url = (parsed as Record<string, unknown>).url;
  if (typeof url !== "string") return false;

  const limpa = url.trim();
  return limpa.startsWith("https://") || limpa.startsWith(VAR_STUB);
}

const kb = (bytes: number) => Math.ceil(bytes / 1024);
const KB_POR_NO = CODE_SOURCE_MAX_BYTES / 1024;
const KB_POR_AUTOMACAO = CODE_WORKFLOW_MAX_BYTES / 1024;

function isCodeNode(node: WorkflowNode): boolean {
  return CODE_NODE_TYPES.includes(String(node.type));
}

function nodeLabel(node: WorkflowNode, data: Record<string, unknown>): string {
  const label = String(data.label ?? "").trim();
  return label || NODE_LABELS[node.type as WorkflowNodeType] || "Código";
}

/**
 * Validação pré-save dos nós de código. `[]` quando está tudo certo.
 *
 * É o primeiro precedente de validação por-nó no editor: hoje o `handleSave` só
 * confere nome não-vazio e existência de trigger. Os erros são bloqueantes de
 * propósito — um nó de código mal configurado não avisa em runtime, ele produz
 * um webhook com body quebrado que o operador descobre no cliente.
 */
export function validateCodeNodes(nodes: WorkflowNode[]): string[] {
  const erros: string[] = [];
  const gravacoes = new Map<string, number>();
  let somaBytes = 0;

  for (const node of nodes) {
    if (!isCodeNode(node)) continue;

    const data = node.data as unknown as Record<string, unknown>;
    const nome = nodeLabel(node, data);

    const outVar = String(data.outputVariable ?? "").trim();
    if (!outVar) {
      erros.push(`O nó «${nome}» não tem variável de saída — o resultado seria descartado.`);
    } else if (!isValidOutputVariable(outVar)) {
      erros.push(
        `«${nome}»: nome de variável inválido. Use letras, números e _ (sem espaços) e não comece com _.`,
      );
    } else {
      gravacoes.set(outVar, (gravacoes.get(outVar) ?? 0) + 1);
    }

    const code = typeof data.code === "string" ? data.code : "";
    if (code.trim() === "") {
      erros.push(`«${nome}» está sem código.`);
      continue;
    }

    const bytes = new TextEncoder().encode(code).length;
    somaBytes += bytes;
    if (bytes > CODE_SOURCE_MAX_BYTES) {
      erros.push(`«${nome}» tem ${kb(bytes)} KB; o limite por nó é ${KB_POR_NO} KB.`);
    }

    if (!JSON_SHAPED_TYPES.includes(String(node.type))) continue;

    const parsed = parseComoJson(code);
    if (parsed === undefined) {
      erros.push(`«${nome}»: o JSON está malformado.`);
      continue;
    }

    // O nó HTTPS descreve a requisição inteira num JSON só. Sem `url`, ou com
    // uma `url` em texto claro, não há o que disparar — e é melhor dizer isso
    // no save do que deixar a automação morrer no primeiro lead.
    if (node.type === "code_https" && !urlDoHttpsEstaOk(parsed)) {
      erros.push(`«${nome}»: a requisição precisa de uma \`url\` começando com https://.`);
    }

    // O exemplo semeado é JSON válido e tem `url` em https://, então passa por
    // tudo acima e sairia daqui pronto para disparar contra um domínio que não
    // existe — matando a automação no primeiro lead, já que o padrão de erro é
    // "parar". Recusar aqui é o que separa "exemplo que ensina" de armadilha.
    //
    // Só o host é checado. O `{{token}}` do exemplo também sairia literal, mas
    // não dá para provar aqui que ninguém o preenche: `webhook_call` e as ações
    // de IA também gravam em `outputVariable`, e varrer só os nós de código
    // reprovaria um `{{token}}` legítimo vindo de um deles.
    if (node.type === "code_https" && code.includes(HTTPS_EXAMPLE_HOST)) {
      erros.push(
        `«${nome}»: troque ${HTTPS_EXAMPLE_HOST} pelo endereço real — esse é só o exemplo que vem preenchido.`,
      );
    }
  }

  if (somaBytes > CODE_WORKFLOW_MAX_BYTES) {
    erros.push(
      `Os nós de código somam ${kb(somaBytes)} KB; o limite por automação é ${KB_POR_AUTOMACAO} KB.`,
    );
  }

  // Erro, e não aviso: duas gravações na mesma chave é o bug que ninguém vê —
  // o valor certo é sobrescrito e o workflow segue verde.
  for (const [variavel, vezes] of gravacoes) {
    if (vezes > 1) {
      erros.push(`Mais de um nó grava na variável «${variavel}» — o último vence.`);
    }
  }

  return erros;
}
