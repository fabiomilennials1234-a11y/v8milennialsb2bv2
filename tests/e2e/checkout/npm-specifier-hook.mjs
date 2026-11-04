// O código de edge function importa `npm:stripe@x` (sintaxe do Deno). No Node vira o pacote.
export function resolve(specifier, context, next) {
  if (specifier.startsWith('npm:stripe@')) return next('stripe', context);
  return next(specifier, context);
}
