import type {
  BillTemplateComponentLike,
  TravelComponentLike,
} from './collector';

const TRAVEL_COMPONENT_NAMES = new Set([
  'NEWTRAVELBOE',
  'TRAVELBOE',
  'MULTITRAVELBOE',
  'MULTITRIPTRAVELBOE',
]);

function normalizeComponentName(name?: string): string {
  return String(name ?? '')
    .replace(/[-_]/g, '')
    .toUpperCase();
}

function getComponentName(component: BillTemplateComponentLike): string {
  return normalizeComponentName(
    component.$options?.name ?? component.$?.type?.name,
  );
}

export function findTravelOwner(
  billTemplate: BillTemplateComponentLike,
  maxDepth = 5,
): TravelComponentLike | undefined {
  let current = billTemplate.$parent;
  let depth = 0;

  while (current && depth < maxDepth) {
    if (TRAVEL_COMPONENT_NAMES.has(getComponentName(current))) {
      return current as TravelComponentLike;
    }

    current = current.$parent;
    depth += 1;
  }

  return undefined;
}
