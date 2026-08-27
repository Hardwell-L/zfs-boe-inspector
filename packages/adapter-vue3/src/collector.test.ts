import { describe, expect, it } from 'vitest';
import { createBillTemplateCollector, createTravelCollector, mergeContributions } from './collector';

describe('BillTemplate Collector', () => {
  it('动态配置评估只修改字段浅拷贝', () => {
    const field = { fieldCode: 'amount', fieldType: 'number' };
    const component = {
      template: [{ areaCode: 'boeHeader', areaFields: [field] }],
      data: { boeHeader: [{ amount: 10 }] },
      billInfo: { boeTypeCode: 'CL02' },
    };
    const collector = createBillTemplateCollector(component, {
      getDynamicConfig: ({ field: copy, controlName, billData, sourceType }) => {
        expect(billData).toMatchObject({ data: component.data, billInfo: component.billInfo });
        expect(sourceType).toBe('pc');
        Object.assign(copy as object, { [`_${String(controlName)}Flag`]: 'on' });
        return controlName !== 'show';
      },
    });
    const snapshot = mergeContributions('CL02:active', {
      projectCode: 'demo',
      environment: 'test',
      adapterVersion: '0.1.0',
    }, [collector]);
    expect(field).not.toHaveProperty('_showFlag');
    expect(snapshot.config.fieldRuntimeStates?.[0]).toMatchObject({ visible: false, editable: true, required: true, value: 10 });
  });

  it('没有显式 formatter 时不调用 dataFormat', () => {
    let called = false;
    const component = {
      template: [],
      data: {},
      dataFormat() { called = true; },
    };
    const contribution = createBillTemplateCollector(component).collect();
    expect(called).toBe(false);
    expect(contribution.runtime?.formattedDtoStatus).toBe('skipped');
  });

  it('净化并采集区域属性描述', () => {
    const contribution = createBillTemplateCollector({ template: [], data: {} }, {
      areaConfig: {
        line: [{ code: 'areaName', label: '显示名称', classify: 'base', type: 'text', required: true }],
      },
    }).collect();
    expect(contribution.config?.areaDescriptors).toEqual({
      line: [{ code: 'areaName', label: '显示名称', classify: 'base', type: 'text' }],
    });
  });
});

describe('Travel Collector', () => {
  it('采集当前人员与对象形式的标准日期', () => {
    const contribution = createTravelCollector({
      person: { employeeId: 'E01', employeeName: '张三', postId: 'P01', postName: '经理' },
      standardDates: [{ date: '2026-08-01', travelSite: '武汉' }],
    }).collect();
    expect(contribution.travel?.currentPerson).toEqual({
      employeeId: 'E01', employeeName: '张三', postId: 'P01', postName: '经理',
    });
    expect(contribution.travel?.standardDates).toEqual([{ date: '2026-08-01', travelSite: '武汉' }]);
  });
});
