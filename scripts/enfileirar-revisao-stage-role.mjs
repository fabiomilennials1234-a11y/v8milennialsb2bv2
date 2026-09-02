/**
 * Enfileira sugestões de won/lost para a revisão do master (ADR-0017 §1).
 *
 * NÃO reimplementa a regra: importa `classifyStageRole` do módulo canônico
 * Deno (`_shared/metrics/stage-role-classifier.ts`, zero imports, puro) e roda
 * sobre as linhas vivas de `pipeline_stages`. Escrever as regex de novo em SQL
 * seria a QUARTA cópia da mesma regra — foi a multiplicação de cópias que
 * produziu "falta = perda" em quatro lugares.
 *
 * Escreve SOMENTE `suggested_stage_role` (won/lost) — nunca `stage_role`.
 * Dinheiro exige confirmação humana; a tela /master/stage-roles é quem aplica.
 * `meeting_booked`/`meeting_held` ficam de fora daqui de propósito: esses
 * auto-aplicam e são domínio da edge function `classify-stage-roles`.
 *
 * Predicado igual ao da edge function: ativa, papel 'open', sem sugestão
 * pendente, nunca revisada. Assim isto e ela nunca disputam a mesma linha.
 *
 * Uso:
 *   node scripts/enfileirar-revisao-stage-role.mjs            # plano (dry-run)
 *   node scripts/enfileirar-revisao-stage-role.mjs --aplicar  # grava
 */
import { execSync } from 'node:child_process';

const PROJECT_REF = 'jsjsmuncfkbsbzqzqhfq';
const aplicar = process.argv.includes('--aplicar');

const { classifyStageRole } = await import(
  '../supabase/functions/_shared/metrics/stage-role-classifier.ts'
);

let token = execSync('security find-generic-password -s "Supabase CLI" -w', { encoding: 'utf8' }).trim();
if (token.startsWith('go-keyring-base64:')) {
  token = Buffer.from(token.slice('go-keyring-base64:'.length), 'base64').toString('utf8').trim();
}

async function sql(query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) },
  );
  if (!res.ok) throw new Error((await res.text()).slice(0, 400));
  return res.json();
}

const candidatas = await sql(`
  SELECT s.id, s.name, s.pipeline_type, s.stage_key,
         s.is_final_positive, s.is_final_negative, o.name AS org
  FROM public.pipeline_stages s
  JOIN public.organizations o ON o.id = s.organization_id
  WHERE s.is_active
    AND s.stage_role = 'open'
    AND s.suggested_stage_role IS NULL
    AND s.stage_role_reviewed_at IS NULL
    -- Etapa sem pipeline_type fica DE FORA. Nao e zelo defensivo: o papel dela
    -- e inalcancavel pela metrica -- metric_stage_role resolve por
    -- ps.pipeline_type = p.slug, entao tipo nulo nunca casa e aprovar a
    -- sugestao nao mudaria numero nenhum. Enfileirar isso encheria a fila do
    -- master de trabalho sem efeito; numa fila parada ha dois meses, e a pior
    -- coisa a acrescentar. Medido em 2026-09-02: 438 etapas ATIVAS com tipo
    -- nulo em prod.
    AND s.pipeline_type IS NOT NULL
  ORDER BY o.name, s.pipeline_type, s.name
`);

const fila = [];
for (const c of candidatas) {
  const sugestao = classifyStageRole({
    name: c.name,
    isFinalPositive: c.is_final_positive ?? false,
    isFinalNegative: c.is_final_negative ?? false,
  });
  // Só dinheiro entra na fila do master — e só o que veio do NOME.
  //
  // 🚨 A fonte `flag` (is_final_positive/negative) fica de fora. O dry-run
  // mostrou o que ela produz: "Proposta Enviada" → won, "negociação" → won,
  // "Não Respondeu" → lost. Proposta enviada não é venda. É exatamente o mesmo
  // sinal fraco que marcou `nao_compareceu` como final_negative e fez falta
  // virar perda; amplificá-lo numa fila de DINHEIRO ensinaria o revisor a
  // clicar no automático, que é o modo de falha que a fila existe para evitar.
  // O nome é o sinal forte: "Perdido", "Desqualificado", "Venda Fechada".
  if (sugestao && sugestao.source === 'deterministic' && (sugestao.role === 'won' || sugestao.role === 'lost')) {
    fila.push({ ...c, role: sugestao.role, source: sugestao.source });
  }
}

console.log(`candidatas lidas: ${candidatas.length}`);
console.log(`entram na fila (won/lost): ${fila.length}\n`);
const porRole = fila.reduce((a, f) => ((a[f.role] = (a[f.role] ?? 0) + 1), a), {});
console.log('por papel sugerido:', porRole);
console.log('orgs alcançadas:', new Set(fila.map((f) => f.org)).size, '\n');
for (const f of fila) {
  // `?? ''` porque foi exatamente um `pipeline_type` nulo que derrubou este
  // loop com `Cannot read properties of null (reading 'padEnd')`. O filtro do
  // SQL já exclui esses, mas relatório não pode ser o que quebra um script de
  // escrita — mesmo falhando ANTES do UPDATE, como falhou.
  console.log(`  ${f.org.slice(0, 22).padEnd(22)} | ${(f.pipeline_type ?? '—').padEnd(12)} | ${f.name.slice(0, 30).padEnd(30)} → ${f.role} (${f.source})`);
}

if (!aplicar) {
  console.log('\n[dry-run] nada gravado. Use --aplicar para enfileirar.');
  process.exit(0);
}

const valores = fila
  .map((f) => `('${f.id}'::uuid, '${f.role}'::public.stage_role, '${f.source}')`)
  .join(',\n    ');

// Repete o predicado no UPDATE: entre a leitura e a escrita alguém pode ter
// revisado a etapa, e sobrescrever uma decisão humana seria o pior desfecho.
const resultado = await sql(`
  WITH plano(id, role, source) AS (VALUES
    ${valores}
  )
  UPDATE public.pipeline_stages s
     SET suggested_stage_role = p.role,
         stage_role_suggested_at = now(),
         stage_role_suggestion_source = p.source
    FROM plano p
   WHERE s.id = p.id
     AND s.is_active
     AND s.stage_role = 'open'
     AND s.suggested_stage_role IS NULL
     AND s.stage_role_reviewed_at IS NULL
  RETURNING s.id;
`);
console.log(`\nenfileiradas: ${resultado.length} de ${fila.length}`);
