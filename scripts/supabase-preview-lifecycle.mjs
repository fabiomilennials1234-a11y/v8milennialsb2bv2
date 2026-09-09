const FORBIDDEN = new Set(['jsjsmuncfkbsbzqzqhfq', 'bcfadphgsibjzivtbjvc']);

/** A criação e o teste têm um único dono; falha do teste também passa pelo cleanup. */
export async function withSupabasePreview({ name, list, create, remove, test, allowConcurrent = false, onEvent = () => {} }) {
  if (!/^qa-studio-[a-z0-9-]+$/.test(name)) throw new Error('Nome de preview inválido');
  const before = await list();
  if (before.some((branch) => branch.name === name)) throw new Error('Nome já pertence a outra execução');
  if (!allowConcurrent && before.some((branch) => !branch.is_default)) throw new Error('Já existe preview; segunda exige autorização explícita do CTO');
  let branch;
  let testError;
  let result;
  try {
    branch = await create(name);
    if (branch.name !== name || branch.is_default || FORBIDDEN.has(branch.project_ref) || !/^[a-z]{20}$/.test(branch.project_ref ?? '') || !branch.id) {
      throw new Error('Criação retornou alvo inseguro; não executar SQL nem excluir esse alvo');
    }
    onEvent({ phase: 'created', ref: branch.project_ref, id: branch.id });
    result = await test(branch.project_ref);
  } catch (error) {
    testError = error;
  } finally {
    // Se o POST criou a branch mas a resposta se perdeu, recuperar SOMENTE o
    // nome exclusivo desta execução, inexistente no inventário inicial.
    if (!branch) {
      try { branch = (await list()).find((item) => item.name === name && !before.some((old) => old.id === item.id)); }
      catch (error) { throw new AggregateError([testError, error].filter(Boolean), 'Não foi possível confirmar se a criação deixou uma preview. Conferir Supabase antes de encerrar a tarefa.'); }
    }
    if (branch && branch.name === name && !branch.is_default && !FORBIDDEN.has(branch.project_ref) && /^[a-z]{20}$/.test(branch.project_ref ?? '') && branch.id) {
      try {
        await remove(branch.id);
        if ((await list()).some((item) => item.id === branch.id || item.project_ref === branch.project_ref)) {
          throw new Error('A branch ainda aparece no inventário após DELETE');
        }
        onEvent({ phase: 'deleted-and-verified', ref: branch.project_ref });
      } catch (error) {
        throw new AggregateError([testError, error].filter(Boolean), 'Cleanup não confirmado: ' + branch.project_ref + '. Custo pode continuar; tarefa NÃO concluída.');
      }
    }
  }
  if (testError) throw testError;
  return result;
}
