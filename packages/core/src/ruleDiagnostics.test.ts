import { describe, expect, it } from 'vitest';
import type { BoeInspectionSnapshot } from '@zfs-boe-inspector/shared-types';
import {
  buildApplyBoeDiagnostics,
  buildCalculationDiagnostics,
  buildDynamicDiagnostics,
  buildValidationDiagnostics,
} from './ruleDiagnostics';

function snapshot(): BoeInspectionSnapshot {
  return {
    schemaVersion: 1,
    instanceId: 'CL02:1',
    capturedAt: '2026-08-27T00:00:00.000Z',
    meta: { projectCode: 'demo', environment: 'test', adapterVersion: '0.2.1' },
    runtime: {
      rawBillData: {
        boeHeader: [{ amount: 10 }],
        boeHeaderChild: [{ applyBoeId: 'APPLY-1', applyBoeNo: 'SQ001', remainingAvailableAmount: 80 }],
        detail: [{ source: 2, target: 3 }],
      },
    },
    config: {
      template: [
        {
          areaCode: 'boeHeader',
          validateRules: JSON.stringify([{
            remindTitle: '金额必须大于零',
            controlNodeType: '01^02',
            triggerCondition: JSON.stringify({ form: [[{ code: 'boeHeader.amount', operator: 'gt', compareValue: 0 }]] }),
            checkContent: JSON.stringify({ code: '${boeHeader.amount#金额#fieldLiteral}' }),
          }]),
          areaFields: [{ fieldCode: 'amount', fieldName: '金额' }],
        },
        {
          areaCode: 'detail',
          areaName: '明细',
          areaFields: [
            { fieldCode: 'source', fieldName: '来源', computed: '${detail.target}' },
            { fieldCode: 'target', fieldName: '目标', formShow: [{ condition: '{}', flag: true }] },
          ],
        },
      ],
      fieldRuntimeStates: [{ areaCode: 'detail', fieldCode: 'target', rowIndex: 0, visible: true, editable: false, required: true, value: 3 }],
    },
  };
}

describe('规则诊断纯解析器', () => {
  it('解析校验规则依赖和当前值，但不执行公式', () => {
    const model = buildValidationDiagnostics(snapshot());
    expect(model.entries).toHaveLength(1);
    expect(model.entries[0]).toMatchObject({ state: 'unverified', dependencies: ['boeHeader.amount'] });
    expect(model.entries[0]?.currentValues).toEqual({ 'boeHeader.amount': 10 });
  });

  it('提取业务化校验标题，不直接展示序列化配置对象', () => {
    const value = snapshot();
    (value.config.template[0] as Record<string, any>).validateRules = JSON.stringify([{
      remindTitle: JSON.stringify({ content: '"金额不能为空"', code: '"金额不能为空"' }),
      checkContent: JSON.stringify({ ast: { type: 'fieldLiteral', value: 'boeHeader.amount' } }),
    }]);
    expect(buildValidationDiagnostics(value).entries[0]).toMatchObject({
      summary: '金额不能为空',
      dependencies: ['boeHeader.amount'],
    });
  });

  it('识别非法校验 JSON', () => {
    const value = snapshot();
    (value.config.template[0] as Record<string, unknown>).validateRules = '[invalid';
    expect(buildValidationDiagnostics(value).entries[0]).toMatchObject({ id: 'VALIDATION_CONFIG_INVALID', state: 'issue' });
  });

  it('识别计算缺失引用和循环依赖', () => {
    const value = snapshot();
    const detail = value.config.template[1] as Record<string, any>;
    detail.areaFields[1].computed = '${detail.source} + ${detail.missing}';
    const model = buildCalculationDiagnostics(value);
    expect(model.entries.some(({ id }) => id === 'CALCULATION_DEPENDENCY_CYCLE')).toBe(true);
    expect(model.entries.some(({ detail: reason }) => reason.includes('detail.missing'))).toBe(true);
  });

  it('不把数字公式和下拉常量元数据当成字段依赖', () => {
    const value = snapshot();
    const detail = value.config.template[1] as Record<string, any>;
    detail.areaFields.push({
      fieldCode: 'constant',
      calculate: [{ formula: { code: '0', ast: { type: 'NumberLiteral', value: 0 } } }],
    });
    detail.areaFields.push({
      fieldCode: 'vendorId',
      calculate: [{ formula: { ast: { type: 'StringLiteral', fieldCode: 'vendorId', value: 'vendor-1' } } }],
    });
    const model = buildCalculationDiagnostics(value);
    const constants = model.entries.filter(({ fieldCode }) => ['constant', 'vendorId'].includes(fieldCode ?? ''));
    expect(constants.every(({ state, dependencies }) => state === 'unverified' && dependencies?.length === 0)).toBe(true);
  });

  it('结合现有运行态解释动态规则并识别损坏配置', () => {
    const value = snapshot();
    const observed = buildDynamicDiagnostics(value).entries[0];
    expect(observed).toMatchObject({ state: 'ok', areaCode: 'detail', fieldCode: 'target' });
    (value.config.template[1] as Record<string, any>).areaFields[1].formShow = '[invalid';
    expect(buildDynamicDiagnostics(value).entries[0]).toMatchObject({ id: 'DYNAMIC_CONFIG_BROKEN', state: 'issue' });
  });

  it('忽略动态配置占位 code，并解析 condition 中的真实依赖', () => {
    const value = snapshot();
    const detail = value.config.template[1] as Record<string, any>;
    detail.areaFields[1].formShow = [{
      code: 'undefined.undefined',
      condition: JSON.stringify({ form: [[{ code: 'boeHeader.amount' }]] }),
      flag: 2,
    }];
    const entry = buildDynamicDiagnostics(value).entries.find(({ fieldCode }) => fieldCode === 'target');
    expect(entry).toMatchObject({ state: 'ok', dependencies: ['boeHeader.amount'] });
  });

  it('兼容新旧 dataTrans，并在无快照时降级为未验证', () => {
    const value = snapshot();
    const fields = (value.config.template[1] as Record<string, any>).areaFields;
    fields.push({
      fieldCode: 'applyNew',
      fieldName: '新关联申请',
      applyBoeConfig: { dataTrans: [{ assignArea: 'detail', isAdd: false, assignData: [{ fromAreaCode: 'applyDetail', fromFieldCode: 'source', toAreaCode: 'detail', toFieldCode: 'target' }] }] },
    });
    fields.push({
      fieldCode: 'applyOld',
      fieldName: '旧关联申请',
      applyBoeConfig: { dataTrans: [{ fromAreaCode: 'applyDetail', fromFieldCode: 'source', toAreaCode: 'detail', toFieldCode: 'target' }] },
    });
    const model = buildApplyBoeDiagnostics(value);
    expect(model.entries.filter(({ id }) => id === 'APPLY_BOE_MAPPING_UNVERIFIED')).toHaveLength(2);
    expect(model.entries.some(({ id }) => id === 'APPLY_BOE_TARGET_DUPLICATE')).toBe(false);
  });

  it('只在同一个关联申请入口内部识别重复目标映射', () => {
    const value = snapshot();
    const fields = (value.config.template[1] as Record<string, any>).areaFields;
    fields.push({
      fieldCode: 'apply',
      applyBoeConfig: {
        dataTrans: [{
          assignArea: 'detail',
          assignData: [
            { fromAreaCode: 'applyDetail', fromFieldCode: 'source', toAreaCode: 'detail', toFieldCode: 'target' },
            { fromAreaCode: 'applyDetail', fromFieldCode: 'other', toAreaCode: 'detail', toFieldCode: 'target' },
          ],
        }],
      },
    });
    expect(buildApplyBoeDiagnostics(value).entries.some(({ id }) => id === 'APPLY_BOE_TARGET_DUPLICATE')).toBe(true);
  });

  it('根据三段快照定位转换阶段和后续覆盖不一致', () => {
    const value = snapshot();
    const fields = (value.config.template[1] as Record<string, any>).areaFields;
    fields.push({
      fieldCode: 'apply',
      applyBoeConfig: { dataTrans: [{ fromAreaCode: 'applyDetail', fromFieldCode: 'source', toAreaCode: 'detail', toFieldCode: 'target' }] },
    });
    value.applyBoe = {
      lastApplyBoeData: [{ applyDetail: [{ source: 2 }] }],
      lastTransData: { detail: [{ target: 4 }] },
    };
    const model = buildApplyBoeDiagnostics(value);
    expect(model.entries.some(({ id, detail }) => id === 'APPLY_BOE_MAPPING_INCONSISTENT' && detail.includes('不一致'))).toBe(true);
  });

  it('空关联申请快照保持未验证，不误报通过或失败', () => {
    const value = snapshot();
    const fields = (value.config.template[1] as Record<string, any>).areaFields;
    fields.push({
      fieldCode: 'apply',
      applyBoeConfig: { dataTrans: [{ fromAreaCode: 'applyDetail', fromFieldCode: 'source', toAreaCode: 'detail', toFieldCode: 'target' }] },
    });
    value.applyBoe = { lastApplyBoeData: [], lastTransData: {} };
    const mapping = buildApplyBoeDiagnostics(value).entries.find(({ fieldCode }) => fieldCode === 'target');
    expect(mapping).toMatchObject({ id: 'APPLY_BOE_MAPPING_UNVERIFIED', state: 'unverified' });
  });
});
