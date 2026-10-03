/**
 * Modo demonstração — build de DESENVOLVIMENTO apenas.
 *
 * Existe para rodar o app inteiro localmente (Docker) sem sessão e sem
 * Supabase, quando o objetivo é revisar UI integrada ao shell do produto:
 * top bar, navegação, layout e rotas reais — não uma página solta.
 *
 * ⚠ SEGURANÇA — por que isto não pode vazar para produção:
 *
 * A guarda é DUPLA e a primeira metade é resolvida em tempo de build.
 * `import.meta.env.DEV` é substituído literalmente por `false` no build de
 * produção (`vite build`), então a expressão inteira vira `false && …` e o
 * Rollup elimina o ramo por dead-code. Não existe variável de ambiente,
 * cabeçalho ou querystring capaz de religar isto numa imagem de produção:
 * seria preciso reconstruir com `--mode development`, que é exatamente o que
 * o `Dockerfile.demo` faz e o `Dockerfile` de produção não faz.
 *
 * A segunda metade (`VITE_DEMO_MODE`) evita que um `npm run dev` comum
 * — que também é DEV — caia em modo demo sem alguém ter pedido.
 *
 * Consumidor único: `ProtectedRoute`. Não adicione outros sem revisão.
 */
export const IS_DEMO_MODE =
  import.meta.env.DEV === true && import.meta.env.VITE_DEMO_MODE === "1";
