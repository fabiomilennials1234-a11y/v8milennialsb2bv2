# 2026-08-23 — A marca de verdade na lateral

Pedido do CTO, sem issue. Aprovado a partir de uma demo interativa das três
variantes de transição — venceu a **cortina**.

## Mudança

- **`SidebarBrand.tsx`** (novo, em `src/modules/platform/components/layout/`):
  hexágono + logotipo da marca no lugar do quadrado laranja com "T" e da
  palavra "Torque" em texto.
- Consumido pela lateral (`Sidebar.tsx`, com `collapsed`) e pelo drawer mobile
  (`SidebarMobileDrawer.tsx`, sempre expandido).
- Assets novos: `src/assets/torque-mark.png` (hexágono, 219×192) e
  `src/assets/torque-wordmark.png` (logotipo de nome branco, 937×160).
- `.sidebar-brand-wordmark` em `index.css` — a animação.

## Os assets

Recortados dos PNGs oficiais da marca (`TORQUE_Logo_Icone.png`,
`TORQUE_Logo_Claro_Horizontal.png`). O logotipo foi separado do hexágono na
coluna vazia entre os dois — no original, x=372→414 não tem um pixel opaco.
Nada foi redesenhado nem vetorizado à mão: é a arte oficial, fatiada e
reamostrada.

Uma arte só de logotipo, de propósito: a lateral é escura nos **dois** temas
(`--sidebar-background` é `36 20% 18%` no claro e `36 12% 7%` no escuro), então
o nome branco serve os dois. Não existe variante escura porque não existe fundo
claro para ela.

## A animação

Recolher/expandir a lateral leva o logotipo junto:

| Peça | Valor |
|---|---|
| Colapso do nome | `grid-template-columns: 1fr → 0fr` |
| Curva | `cubic-bezier(.32,.72,0,1)`, 200 ms — a mesma da largura da `aside` |
| Nome entrando | opacidade 150 ms, **90 ms de atraso** |
| Nome saindo | opacidade 110 ms, sem atraso |
| Movimento reduzido | `transition: none` |

Duas decisões que valem registro:

- **`1fr → 0fr` em vez de `max-width`.** A animação mede a largura real da arte.
  Trocar o PNG amanhã não obriga a recalibrar nenhum número no CSS.
- **Durações assimétricas.** Abrindo, o nome só entra depois que existe espaço
  pra ele; fechando, sai antes de ser espremido. Simétrico parece emperrado.

O hexágono tem 26×26 — a caixa exata do "T" que ele substitui e da coluna de
ícones do menu. Recolher não desloca nada na horizontal.

## Acessibilidade

O nome acessível do link vem do `alt="Torque"` do hexágono; o logotipo é
`aria-hidden`. O `NavLink` **não** leva `aria-label="Torque — Central de
Comando"`: por nome, esse rótulo colide com o item de menu "Comando" — a
primeira tentativa quebrou o teste que procura o link "Comando" e passou a
achar dois.

## Verificação

`Sidebar.test.tsx` ganhou um caso: hexágono presente nos dois estados,
`data-collapsed` do logotipo acompanhando a lateral. 11/11 verdes no arquivo.
