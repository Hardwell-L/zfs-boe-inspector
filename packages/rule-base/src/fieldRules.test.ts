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
  function colorSnapshot(field: Record<string, JsonValue>): BoeInspectionSnapshot {
    const snapshot = createSnapshot();
    snapshot.config.template = [{ areaCode: 'header', areaFields: [field] }];
    return snapshot;
  }

  it('区域编码重复独立报告 ERROR，不将跨区域字段重复算作区域内重复', () => {
    const snapshot = colorSnapshot({ fieldCode: 'remark' });
    snapshot.config.template.push({ areaCode: 'header', areaFields: [{ fieldCode: 'remark' }] });
    const results = evaluateFieldRules(snapshot);
    expect(results.find(({ ruleId }) => ruleId === 'AREA_DUPLICATE')).toMatchObject({
      status: 'issue', severity: 'error',
      evidencePaths: ['config.template.0.areaCode', 'config.template.1.areaCode'],
    });
    expect(results.find(({ ruleId }) => ruleId === 'FIELD_DUPLICATE_IN_AREA')?.status).toBe('passed');
  });

  it('同名但不同编码的区域不报重复，空区域仍检查编码', () => {
    const snapshot = createSnapshot();
    snapshot.config.template = [
      { areaCode: 'a', areaName: '明细', areaFields: [] },
      { areaCode: 'b', areaName: '明细', areaFields: [] },
    ];
    expect(evaluateFieldRules(snapshot).find(({ ruleId }) => ruleId === 'AREA_DUPLICATE')?.status).toBe('passed');
    snapshot.config.template.push({ areaCode: 'a', areaFields: [] });
    expect(evaluateFieldRules(snapshot).find(({ ruleId }) => ruleId === 'AREA_DUPLICATE')?.severity).toBe('error');
  });

  it('截图的旧条件键与当前字段不一致时定位实际缺失键，而不是 del', () => {
    const snapshot = colorSnapshot({
      fieldCode: 'remark', fieldType: 'textarea',
      colorSet: [{ color: '#FF0800', spareS76: '核算', del: '', type: 'color', operator: 'in' }],
    });
    expect(evaluateFieldRules(snapshot).find(({ ruleId }) => ruleId === 'FIELD_COLOR_SET_VALUE_MISSING')).toMatchObject({
      status: 'issue', severity: 'error',
      evidencePaths: ['config.template.0.areaFields.0.colorSet.0.remark', 'config.template.0.areaFields.0.fieldCode'],
    });
  });

  it.each(['label', 'text', 'textarea', 'select', 'table-search'])('%s 按宿主分支检查缺失的字符串条件', (fieldType) => {
    const results = evaluateFieldRules(colorSnapshot({
      fieldCode: 'code', labelCode: 'name', fieldType,
      colorSet: [{ type: 'color', color: '#FF0800', operator: 'in' }],
    }));
    const result = results.find(({ ruleId }) => ruleId === 'FIELD_COLOR_SET_VALUE_MISSING');
    expect(result?.severity).toBe('error');
    expect(result?.evidencePaths[0]).toBe(`config.template.0.areaFields.0.colorSet.0.${fieldType === 'table-search' ? 'name' : 'code'}`);
  });

  it.each(['date', 'datetime', 'num', 'amount'])('%s 允许省略范围边界', (fieldType) => {
    const results = evaluateFieldRules(colorSnapshot({
      fieldCode: 'value', fieldType, colorSet: [{ type: 'color', color: '#FF0800' }],
    }));
    expect(results.filter(({ ruleId, status }) => ruleId.startsWith('FIELD_COLOR_SET') && status === 'issue')).toEqual([]);
  });

  it('空字符串条件和缺省 del 有效，table-search 使用 labelCode，支持 JSON 配置', () => {
    const results = evaluateFieldRules(colorSnapshot({
      fieldCode: 'id', labelCode: 'name', fieldType: 'table-search',
      colorSet: JSON.stringify([{ name: '', operator: 'notIn', type: 'color', color: '#FF0800' }]),
    }));
    expect(results.filter(({ ruleId, status }) => ruleId.startsWith('FIELD_COLOR_SET') && status === 'issue')).toEqual([]);
  });

  it('非字符串条件报告格式错误，截断条件跳过判定', () => {
    const evaluate = (condition: JsonValue) => evaluateFieldRules(colorSnapshot({
      fieldCode: 'code', fieldType: 'text', colorSet: [{ code: condition }],
    }));
    expect(evaluate(123).find(({ ruleId }) => ruleId === 'FIELD_COLOR_SET_INVALID')?.severity).toBe('error');
    expect(evaluate({ __kind: 'truncated' }).filter(({ ruleId }) => ruleId.startsWith('FIELD_COLOR_SET'))
      .every(({ status }) => status === 'skipped')).toBe(true);
  });

  it('模板不可用时新增规则跳过判定', () => {
    const snapshot = createSnapshot();
    snapshot.meta.compatibility = { collection: { status: 'unavailable' } } as NonNullable<BoeInspectionSnapshot['meta']['compatibility']>;
    for (const ruleId of ['AREA_DUPLICATE', 'FIELD_COLOR_SET_INVALID', 'FIELD_COLOR_SET_VALUE_MISSING']) {
      expect(evaluateFieldRules(snapshot).find((result) => result.ruleId === ruleId)?.status).toBe('skipped');
    }
  });

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
