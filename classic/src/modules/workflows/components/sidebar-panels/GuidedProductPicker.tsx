import { useEffect, useState } from 'react';
import { useGuidedProductOptions } from '@/modules/carteira';
import { useDebounce } from '@/shared/hooks/useDebounce';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import type { GuidedProductRuleDraft } from '@/types/workflow';

export function GuidedProductPicker({ actorId, organizationId, condition, onChange }: {
  actorId: string; organizationId: string; condition: GuidedProductRuleDraft;
  onChange: (condition: GuidedProductRuleDraft) => void;
}) {
  const [search, setSearch] = useState('');
  const term = useDebounce(search.trim(), 250);
  const { options, selected } = useGuidedProductOptions(actorId, organizationId, term, condition.productId);
  const selectedId = condition.productId.toLowerCase();
  const selectedProduct = selected.data;
  const unavailable = Boolean(condition.productId && selected.isSuccess && (!selectedProduct || !selectedProduct.is_active));
  const choices = (options.data ?? []).filter(product => !unavailable || product.id.toLowerCase() !== selectedId);
  useEffect(() => {
    if (selected.isSuccess && selectedProduct?.is_active && selectedProduct.id.toLowerCase() === selectedId
      && selectedProduct.name !== condition.productLabel) {
      onChange({ ...condition, productLabel: selectedProduct.name });
    }
  }, [condition, onChange, selected.isSuccess, selectedId, selectedProduct]);
  if (selectedProduct?.is_active) {
    const index = choices.findIndex(product => product.id === selectedProduct.id);
    if (index >= 0) choices[index] = selectedProduct;
    else choices.unshift(selectedProduct);
  }
  return <div className="space-y-2">
    <Label htmlFor={`guided-product-search-${condition.id}`}>Buscar produto</Label>
    <Input id={`guided-product-search-${condition.id}`} value={search} onChange={event => setSearch(event.target.value)}
      placeholder="Buscar pelo nome do produto" />
    <Label htmlFor={`guided-value-${condition.id}`}>Produto</Label>
    <select id={`guided-value-${condition.id}`} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      value={selectedId} aria-invalid={unavailable || !condition.productId} onChange={event => {
        const product = choices.find(item => item.id === event.target.value);
        onChange({ ...condition, productId: product?.id ?? '', productLabel: product?.name });
      }}>
      <option value="">{options.isPending ? 'Carregando produtos…' : 'Selecione um produto'}</option>
      {condition.productId && !choices.some(product => product.id.toLowerCase() === selectedId) && <option disabled value={selectedId}>
        {selected.isError && !selected.isFetching ? 'Produto não verificado' : unavailable ? 'Produto indisponível' : 'Consultando produto selecionado…'}
      </option>}
      {choices.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
    </select>
    {(options.isError || (condition.productId && selected.isError)) && <>
      <p role="alert" className="text-sm text-destructive">Não foi possível carregar produtos. Tente novamente.</p>
      <Button type="button" variant="outline" disabled={options.isFetching || selected.isFetching} onClick={() => {
        void options.refetch();
        if (condition.productId) void selected.refetch();
      }}>Tentar carregar produtos novamente</Button>
    </>}
    {unavailable && <p role="alert" className="text-sm text-destructive">Produto removido, inativo ou sem acesso. Selecione outro produto.</p>}
    {options.isSuccess && options.data.length === 0 && (!condition.productId || (selected.isSuccess && Boolean(selectedProduct?.is_active)))
      && <p className="text-sm text-muted-foreground">Nenhum produto encontrado. Tente outro nome.</p>}
    {options.data?.length === 25 && <p className="text-xs text-muted-foreground">Mostrando até 25 produtos. Refine a busca.</p>}
  </div>;
}
