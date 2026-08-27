import type {
  AreaDetail,
  BoeInspectionSnapshot,
  FieldDetail,
  FieldPropertyDescriptor,
  FieldSelection,
  JsonValue,
} from '@zfs-boe-inspector/shared-types';

const GROUP_LABELS: Record<string, string> = {
  base: '基本',
  advance: '高级',
  data: '数据源',
};

function record(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : undefined;
}

function propertyGroups(
  source: Record<string, any>,
  descriptors: FieldPropertyDescriptor[],
) {
  const byGroup = new Map<string, Array<FieldPropertyDescriptor & { value?: JsonValue }>>();
  for (const descriptor of descriptors) {
    const item: FieldPropertyDescriptor & { value?: JsonValue } = { ...descriptor };
    const descriptorValue = source[descriptor.code] as JsonValue | undefined;
    if (descriptorValue !== undefined) item.value = descriptorValue;
    const items = byGroup.get(descriptor.classify) ?? [];
    items.push(item);
    byGroup.set(descriptor.classify, items);
  }
  return [...byGroup.entries()].map(([key, items]) => ({
    key,
    label: GROUP_LABELS[key] ?? key,
    items,
  }));
}

export function getAreaDetail(
  snapshot: BoeInspectionSnapshot,
  areaCode: string,
): AreaDetail | undefined {
  const areaIndex = snapshot.config.template.findIndex((value) => record(value)?.areaCode === areaCode);
  if (areaIndex < 0) return undefined;
  const area = record(snapshot.config.template[areaIndex]);
  if (!area) return undefined;
  const descriptors = snapshot.config.areaDescriptors?.[areaCode]
    ?? snapshot.config.areaDescriptors?.line
    ?? [];
  return {
    areaCode,
    area: snapshot.config.template[areaIndex] as JsonValue,
    groups: propertyGroups(area, descriptors),
  };
}

export function parseFieldDomId(domId: string): FieldSelection | undefined {
  const parts = domId.split('.');
  if (parts.length < 3) return undefined;
  const fieldCode = parts.pop() ?? '';
  const rowIndexText = parts.pop() ?? '';
  const areaCode = parts.join('.');
  if (!areaCode || !fieldCode || !/^\d+$/.test(rowIndexText)) return undefined;
  return { areaCode, fieldCode, rowIndex: Number(rowIndexText), domId };
}

export function getFieldDetail(
  snapshot: BoeInspectionSnapshot,
  selection: FieldSelection,
): FieldDetail | undefined {
  const areaIndex = snapshot.config.template.findIndex((value) => record(value)?.areaCode === selection.areaCode);
  if (areaIndex < 0) return undefined;
  const area = record(snapshot.config.template[areaIndex]);
  const fields = Array.isArray(area?.areaFields) ? area.areaFields : [];
  const field = fields.find((value: unknown) => {
    const item = record(value);
    return item?.fieldCode === selection.fieldCode || item?.labelCode === selection.fieldCode;
  });
  const fieldRecord = record(field);
  if (!area || !fieldRecord) return undefined;
  const resolvedSelection: FieldSelection = {
    ...selection,
    fieldCode: String(fieldRecord.fieldCode ?? selection.fieldCode),
  };
  const row = record((record(snapshot.runtime.rawBillData)?.[selection.areaCode] as unknown[])?.[selection.rowIndex]);
  const value = row?.[resolvedSelection.fieldCode] as JsonValue | undefined;
  const runtimeState = snapshot.config.fieldRuntimeStates?.find((state) => (
    state.areaCode === resolvedSelection.areaCode
      && state.fieldCode === resolvedSelection.fieldCode
      && state.rowIndex === resolvedSelection.rowIndex
  ));
  const descriptors = snapshot.config.fieldDescriptors?.[String(fieldRecord.fieldType)] ?? [];
  return {
    selection: resolvedSelection,
    field: field as JsonValue,
    area: snapshot.config.template[areaIndex] as JsonValue,
    groups: propertyGroups(fieldRecord, descriptors),
    ...(value !== undefined ? { value } : {}),
    ...(runtimeState ? { runtimeState } : {}),
  };
}
