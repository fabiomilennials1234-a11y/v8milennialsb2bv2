/**
 * /master/meta-assets — Meta Asset Binding (ADR-0009, #809).
 * Master-only: bind Meta Pages + Ad Accounts to organizations.
 */

import { MetaBindingTab } from "../components/MetaBindingTab";

export default function MasterMetaAssets() {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <MetaBindingTab />
    </div>
  );
}
