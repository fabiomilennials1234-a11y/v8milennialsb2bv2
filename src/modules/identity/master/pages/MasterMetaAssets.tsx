/**
 * /master/meta-assets — Meta Asset Binding (ADR-0009, #809).
 * Master-only: bind Meta Pages + Ad Accounts to organizations.
 */

import { MetaBindingTab } from "../components/MetaBindingTab";

export default function MasterMetaAssets() {
  return (
    // Largura de leitura: a lista de organizações fica estreita de propósito.
    <div className="max-w-4xl">
      <MetaBindingTab />
    </div>
  );
}
