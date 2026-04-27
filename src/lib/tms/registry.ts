/**
 * TMS adapter registry. Lookup by provider_id, dispatch to the
 * appropriate adapter implementation.
 */

import type { TmsAdapter } from "./adapter";
import { cargowiseAdapter } from "./cargowise";

const adapters: Record<string, TmsAdapter> = {
  [cargowiseAdapter.providerId]: cargowiseAdapter,
};

/** Look up an adapter by provider id. Throws if unknown. */
export function getAdapter(providerId: string): TmsAdapter {
  const adapter = adapters[providerId];
  if (!adapter) {
    throw new Error(`Unknown TMS provider: ${providerId}`);
  }
  return adapter;
}

/** All registered adapters - used by the dashboard for status overview. */
export function listAdapters(): TmsAdapter[] {
  return Object.values(adapters);
}
