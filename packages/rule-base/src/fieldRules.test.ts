import { describe, expect, it } from 'vitest';
import type { BoeInspectionSnapshot, JsonValue } from '@zfs-boe-inspector/shared-types';
import { evaluateFieldRules } from './fieldRules';

function createSnapshot(): BoeInspectionSnapshot {
  return {
    schemaVersion: 1,
    instanceId: 'CL02:1',
    capturedAt: '2026-08-27T00:00:00.000Z',
    meta: { projectCode: 'demo', environment: 'test', adapterVersion: '0.1.0' },
    runtime: {
      rawBillData: {
        boeHeader: [{ amount: '', source: 'A' }],
      },
    },
    config: {
      template: [{
        areaCode: 'boeHeader',
        areaFields: [
          {
            fieldCode: 'amount',
            fieldType: 'number',
            require: true,
            currentShow: false,
            currentEdit: false,
            computed: '${boeHeader.missing}',
          },
          {
            fieldCode: 'source',
            fieldType: 'multi-table',
            dataSourceType: 'service',
            trans: '[{"from":"code","to":"amount"},{"from":"name","to":"amount"}]',
          },
        ],
      }],
    },
  };
}

describe('字段规则', () => {
  function warningSnapshot(warning: JsonValue, names?: string[]): BoeInspectionSnapshot {
    const snapshot = createSnapshot();
    snapshot.config.template = [{
      areaCode: 'loan',
      areaName: '挂账区',
      areaFields: [{ fieldCode: 'spareS42', fieldName: '结算方式', warning }],
    }];
    if (names !== undefined) snapshot.config.warningRuleNames = names;
    return snapshot;
  }

  it('结算方式误将字段编码配置为警告规则时报告 ERROR 和配置路径', () => {
    const snapshot = warningSnapshot('spareS42', ['actualAmount', 'stayAmount']);
    const result = evaluateFieldRules(snapshot).find(({ ruleId }) => ruleId === 'FIELD_WARNING_RULE_MISSING');
    expect(result).toMatchObject({
      status: 'issue',
      severity: 'error',
      actual: 'spareS42',
      evidencePaths: ['config.template.0.areaFields.0.warning', 'config.warningRuleNames'],
    });
    expect(result?.summary).toContain('loan.spareS42（结算方式）');
  });

  it.each<[string, JsonValue, string[]]>([
    ['自定义规则', 'spareS42', ['spareS42']],
    ['内置规则', 'stayAmount', ['stayAmount']],
    ['空配置', '', []],
    ['未配置', null, []],
    ['已解析的规则对象', { sources: ['amount'], validateFunc: { __kind: 'function' } }, []],
  ])('%s 不误报规则缺失', (_label, warning, names) => {
    const result = evaluateFieldRules(warningSnapshot(warning, names))
      .find(({ ruleId }) => ruleId === 'FIELD_WARNING_RULE_MISSING');
    expect(result?.status).toBe('passed');
  });

  it('未采集注册表时跳过，已采集的空表仍能确认规则缺失', () => {
    const status = (names?: string[]) => evaluateFieldRules(warningSnapshot('spareS42', names))
      .find(({ ruleId }) => ruleId === 'FIELD_WARNING_RULE_MISSING')?.status;
    expect(status()).toBe('skipped');
    expect(status([])).toBe('issue');
  });

  it('识别必填隐藏、空只读、计算引用和 trans 冲突', () => {
    const results = evaluateFieldRules(createSnapshot());
    const issueIds = results.filter(({ status }) => status === 'issue').map(({ ruleId }) => ruleId);
    expect(issueIds).toContain('FIELD_REQUIRED_HIDDEN');
    expect(issueIds).toContain('FIELD_REQUIRED_READONLY_EMPTY');
    expect(issueIds).toContain('FIELD_COMPUTE_REFERENCE_MISSING');
    expect(issueIds).toContain('FIELD_TRANS_TARGET_CONFLICT');
    expect(issueIds).not.toContain('FIELD_ROW_KEY_MISSING');
  });

  it('无法观察数据源原始响应时标记 skipped', () => {
    const result = evaluateFieldRules(createSnapshot()).find(({ ruleId }) => ruleId === 'FIELD_TRANS_SOURCE_UNVERIFIED');
    expect(result?.status).toBe('skipped');
  });

  it.each(['table', 'multi-table'])('%s 未填 rowKey 时说明 fieldCode 回退，不误报警告', (fieldType) => {
    const snapshot = createSnapshot();
    snapshot.config.template = [{
      areaCode: 'loan',
      areaFields: [{ fieldCode: 'refBoeNo', fieldType, lovKey: 'BOE_LOV' }],
    }];
    const result = evaluateFieldRules(snapshot).find(({ ruleId }) => ruleId === 'FIELD_ROW_KEY_MISSING');
    expect(result?.status).toBe('skipped');
    expect(result?.severity).toBeUndefined();
    expect(result?.summary).toContain('BOE 默认使用 fieldCode（refBoeNo）');
  });

  it.each(['tree', 'asyncTree', 'table-search'])('%s 不套用 table-picker 的 rowKey 检查', (fieldType) => {
    const snapshot = createSnapshot();
    snapshot.config.template = [{
      areaCode: 'loan',
      areaFields: [{ fieldCode: 'refBoeNo', fieldType, dataSourceType: 'service' }],
    }];
    const result = evaluateFieldRules(snapshot).find(({ ruleId }) => ruleId === 'FIELD_ROW_KEY_MISSING');
    expect(result?.status).toBe('passed');
  });

  it('函数提示指出具体属性和验证边界，证据保留字段定位路径', () => {
    const snapshot = createSnapshot();
    snapshot.config.template = [{
      areaCode: 'boeHeader',
      areaFields: [{
        fieldCode: 'bpCount',
        rules: [{ validator: { __kind: 'function', name: 'validator', length: 3 } }],
        warning: { validateFunc: { __kind: 'function', name: 'validateFunc', length: 3 } },
      }],
    }];
    const result = evaluateFieldRules(snapshot).find(({ ruleId }) => ruleId === 'FIELD_FUNCTION_UNINSPECTABLE');
    expect(result).toMatchObject({
      status: 'issue',
      severity: 'info',
      evidencePaths: [
        'config.template.0.areaFields.0.rules.0.validator',
        'config.template.0.areaFields.0.warning.validateFunc',
      ],
    });
    expect(result?.summary).toContain('rules.0.validator、warning.validateFunc');
    expect(result?.reason).toContain('此提示不表示配置有误');
  });

  it('数据源提示说明已观察到的空配置，不断言实际加载失败', () => {
    const result = evaluateFieldRules(createSnapshot()).find(({ ruleId }) => ruleId === 'FIELD_DATASOURCE_INCOMPLETE');
    expect(result?.summary).toContain('数据源类型 service');
    expect(result?.reason).toContain('config、staticConfig、requestUrl、service 均为空');
    expect(result?.reason).toContain('不能仅据此认定数据源失效');
  });

  it.each<Record<string, JsonValue>>([
    { options: [{ label: '是', value: 'Y' }] },
    { ajax: '/select/options' },
    { fastCode: 'YES_NO' },
    { options: [] },
    {},
  ])('select 不因缺少 LOV 配置或选项未加载而误报：%j', (config) => {
    const snapshot = createSnapshot();
    snapshot.config.template = [{
      areaCode: 'boeHeader',
      areaFields: [{ fieldCode: 'paperAccessories', fieldType: 'select', dataSourceType: '002', ...config }],
    }];
    const result = evaluateFieldRules(snapshot).find(({ ruleId }) => ruleId === 'FIELD_DATASOURCE_INCOMPLETE');
    expect(result?.status).toBe('passed');
  });

  it.each([
    ['BOE_LOV', 'passed'],
    ['', 'issue'],
    ['   ', 'issue'],
    [null, 'issue'],
  ])('数据源配置缺失检查识别 lovKey=%s', (lovKey, status) => {
    const snapshot = createSnapshot();
    snapshot.config.template = [{
      areaCode: 'boeHeader',
      areaFields: [{ fieldCode: 'qcFlag', dataSourceType: 'service', lovKey }],
    }];
    const result = evaluateFieldRules(snapshot).find(({ ruleId }) => ruleId === 'FIELD_DATASOURCE_INCOMPLETE');
    expect(result?.status).toBe(status);
  });
});
