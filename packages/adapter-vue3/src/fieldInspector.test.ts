import { describe, expect, it } from 'vitest';
import type { BoeInspectionSnapshot } from '@zfs-boe-inspector/shared-types';
import { getAreaDetail, getFieldDetail, parseFieldDomId } from './fieldInspector';

describe('字段检查器', () => {
  it('重复编码按原始配置索引分别读取，不接受失效索引或不匹配编码', () => {
    const snapshot: BoeInspectionSnapshot = {
      schemaVersion: 1, instanceId: 'bill', capturedAt: '2026-09-18T00:00:00Z',
      meta: { projectCode: 'test', environment: 'test', adapterVersion: 'test' },
      config: { template: [{ areaCode: 'detail', areaFields: [
        { fieldCode: 'amount', fieldName: '第一项', fieldType: 'input' },
        { fieldCode: 'amount', fieldName: '第二项', fieldType: 'number' },
      ] }] }, runtime: { rawBillData: { detail: [{ amount: 0 }] } },
    };
    const selection = { areaCode: 'detail', fieldCode: 'amount', rowIndex: 0 };
    expect(getFieldDetail(snapshot, { ...selection, fieldIndex: 1 })?.field).toMatchObject({ fieldName: '第二项' });
    expect(getFieldDetail(snapshot, { ...selection, fieldIndex: 1 })?.value).toBe(0);
    expect(getFieldDetail(snapshot, selection)?.selection.fieldIndex).toBe(0);
    expect(getFieldDetail(snapshot, { ...selection, fieldIndex: 2 })).toBeUndefined();
    expect(getFieldDetail(snapshot, { ...selection, fieldIndex: -1 })).toBeUndefined();
    expect(getFieldDetail(snapshot, { ...selection, fieldIndex: 1, fieldCode: 'other' })).toBeUndefined();
  });

  it('从 BOE DOM id 解析区域、行号与字段', () => {
    expect(parseFieldDomId('boeHeader.0.amount')).toEqual({
      areaCode: 'boeHeader',
      fieldCode: 'amount',
      rowIndex: 0,
      domId: 'boeHeader.0.amount',
    });
  });

  it('table-search 可通过 labelCode 定位真实字段并分组属性', () => {
    const snapshot: BoeInspectionSnapshot = {
      schemaVersion: 1,
      instanceId: 'CL02:1',
      capturedAt: '2026-08-27T00:00:00.000Z',
      meta: { projectCode: 'demo', environment: 'test', adapterVersion: '0.1.0' },
      runtime: { rawBillData: { boeHeader: [{ supplierCode: 'S01' }] } },
      config: {
        template: [{ areaCode: 'boeHeader', areaFields: [{ fieldCode: 'supplierCode', labelCode: 'supplierName', fieldType: 'table-search', fieldName: '供应商' }] }],
        fieldDescriptors: {
          'table-search': [
            { code: 'fieldName', label: '字段名称', classify: 'base' },
            { code: 'labelCode', label: '显示字段', classify: 'data' },
          ],
        },
      },
    };
    const detail = getFieldDetail(snapshot, { areaCode: 'boeHeader', fieldCode: 'supplierName', rowIndex: 0 });
    expect(detail?.selection.fieldCode).toBe('supplierCode');
    expect(detail?.groups.map(({ key }) => key)).toEqual(['base', 'data']);
    expect(detail?.value).toBe('S01');
  });

  it('普通业务区域使用 line 描述展示区域配置', () => {
    const snapshot: BoeInspectionSnapshot = {
      schemaVersion: 1,
      instanceId: 'CL02:1',
      capturedAt: '2026-08-27T00:00:00.000Z',
      meta: { projectCode: 'demo', environment: 'test', adapterVersion: '0.1.0' },
      runtime: { rawBillData: {} },
      config: {
        template: [{ areaCode: 'travelDetail', areaName: '行程明细', areaType: 'table', isAdd: true, areaFields: [] }],
        areaDescriptors: {
          line: [
            { code: 'areaName', label: '显示名称', classify: 'base' },
            { code: 'isAdd', label: '新增行', classify: 'base' },
            { code: 'fillInDescription', label: '区域说明', classify: 'advance' },
          ],
        },
      },
    };
    const detail = getAreaDetail(snapshot, 'travelDetail');
    expect(detail?.groups.map(({ key }) => key)).toEqual(['base', 'advance']);
    expect(detail?.groups[0]?.items).toMatchObject([
      { code: 'areaName', value: '行程明细' },
      { code: 'isAdd', value: true },
    ]);
  });
});
