import { describe, expect, it } from 'vitest';
import type { BoeInspectionSnapshot, RuleEvaluation, TraceEvent, TraceSession } from '@zfs-boe-inspector/shared-types';
import { fieldAreas, indexedFieldDetail, issueItems, validationRows } from '../../../apps/extension/src/panel/inspectionView';
import { traceEventView, TraceViewCache, traceChanges, mergeTraceUpdate, traceCursor } from '../../../apps/extension/src/panel/traceView';
import { buildAiEvidence, scopeIdentity, scopeLabel } from '../../../apps/extension/src/panel/aiContext';

const snapshot: BoeInspectionSnapshot = {
  schemaVersion: 1, instanceId: 'bill', capturedAt: '2026-09-18T00:00:00Z',
  meta: { projectCode: 'test', environment: 'test', adapterVersion: 'test' },
  config: { template: [
    { areaCode: 'header', areaName: '单据头', areaFields: [{ fieldCode: 'name', fieldName: '名称一', fieldType: 'input' }, { fieldCode: 'name', fieldName: '名称二', fieldType: 'input' }] },
    { areaCode: 'detail', areaName: '明细', areaFields: [{ fieldCode: 'name', fieldName: '明细名称' }] },
  ], fieldDescriptors: { input: [{ code: 'fieldName', label: '名称', classify: 'base' }] } },
  runtime: { rawBillData: { header: [{ name: '当前值' }] } },
};
const evaluation: RuleEvaluation = { ruleId: 'FIELD_DUPLICATE_IN_AREA', category: 'field-config', status: 'issue', severity: 'error', summary: '重复',
  evidencePaths: ['config.template.0.areaFields.0.fieldCode', 'config.template.0.areaFields.1.fieldCode'] };

describe('优化页面数据模型', () => {
  it('重复配置可准确恢复第二项，索引不依赖过滤后的顺序', () => {
    const fields = fieldAreas(snapshot)[0]!.fields;
    expect(fields.map((field) => [field.fieldIndex, field.duplicateOrdinal, field.duplicateCount])).toEqual([[0, 1, 2], [1, 2, 2]]);
    const detail = indexedFieldDetail(snapshot, { areaCode: 'header', fieldCode: 'name', rowIndex: 0, fieldIndex: fields.filter((field) => field.fieldName === '名称二')[0]!.fieldIndex });
    expect(detail?.field).toMatchObject({ fieldName: '名称二' });
    expect(detail?.groups[0]?.items[0]?.value).toBe('名称二');
    expect(detail?.value).toBe('当前值');
    expect(fieldAreas(snapshot)[1]?.fields[0]?.duplicateCount).toBe(1);
    expect(indexedFieldDetail(snapshot, { areaCode: 'header', fieldCode: 'other', rowIndex: 0, fieldIndex: 1 })).toBeUndefined();
  });

  it('重复问题分别提供两个入口，跨区域只保留一个问题身份，无归属保持全局', () => {
    const [item] = issueItems(snapshot, [evaluation]);
    expect(item?.targets.map((target) => target.selection.fieldIndex)).toEqual([0, 1]);
    expect(item?.areaCodes).toEqual(['header']);
    const [cross, global] = issueItems(snapshot, [{ ...evaluation, evidencePaths: [...evaluation.evidencePaths, 'runtime.rawBillData.detail.2.name'] }, { ...evaluation, evidencePaths: ['travel'] }]);
    expect(cross?.areaCodes).toEqual(['header', 'detail']);
    expect(cross?.targets.at(-1)?.selection.rowIndex).toBe(2);
    expect(global?.areaCodes).toEqual([]);
  });

  it('校验规则解析设计器表达式、节点、未知编码和异常配置', () => {
    const model = validationRows(JSON.stringify([{ priority: 1, checkContent: JSON.stringify({ content: '金额 > 0', code: 'expression' }), controlType: '001', controlNodeType: '01^03', remindTitle: JSON.stringify({ content: '请检查金额' }), validityFlag: 'unknown' }, null]));
    expect(model.rows[0]).toMatchObject({ check: '金额 > 0', control: '禁止', nodes: '提交、驳回', state: 'unknown', remind: '请检查金额' });
    expect(model.rows[1]?.error).toBeTruthy();
    expect(validationRows('[').error).toBeTruthy();
    expect(validationRows('[]').rows).toEqual([]);
  });

  it('旧记录只恢复字段身份，不用当前值补造触发值；新增值支持名称和值搜索', () => {
    const event: TraceEvent = { id: 'event-1', at: '2026-09-18T00:00:00.123Z', method: 'triggerComputeMixin', category: '计算触发', status: 'returned', input: ['header.name', 0] };
    expect(traceEventView(event, snapshot).triggers[0]).toMatchObject({ text: '未采集', rowIndex: 0 });
    const view = traceEventView({ ...event, triggers: [{ areaCode: 'header', fieldCode: 'name', rowIndex: 0, source: 'entry-value', value: false }] }, snapshot);
    expect(view.search).toContain('名称二');
    expect(view.triggers[0]?.text).toBe('false');
  });

  it('AI 分析中的两个重复配置身份独立，选中第二项不会带入第一项配置', () => {
    const first = { kind: 'field' as const, areaCode: 'header', fieldCode: 'name', rowIndex: 0, fieldIndex: 0 };
    const second = { ...first, fieldIndex: 1 };
    expect(scopeIdentity(first)).not.toBe(scopeIdentity(second));
    expect(scopeLabel(snapshot, second)).toContain('名称二');
    const evidence = buildAiEvidence(snapshot, [second], []);
    expect(evidence.some((item) => item.path === 'config.template.0.areaFields.1')).toBe(true);
    expect(evidence.some((item) => item.path === 'config.template.0.areaFields.0')).toBe(false);
  });
});


describe('记录展示缓存与增量合并', () => {
  const event: TraceEvent = { id: 'event-1', at: '2026-09-18T00:00:00Z', method: 'triggerComputeMixin', category: '计算触发', status: 'returned', input: ['header.name', 0] };
  const session: TraceSession = { id: 'trace-1', instanceId: 'bill', active: true, startedAt: event.at, events: [event], coverage: [], limitations: [], startSnapshot: snapshot };

  it('旧事件仅从明确匹配的进入时行恢复值，不使用目标行或当前快照', () => {
    const withBefore = { ...event, areaCode: 'header', rowIndex: 0, before: { name: 0 } };
    expect(traceEventView(withBefore, snapshot).triggers[0]).toMatchObject({ text: '0', source: 'event-before' });
    expect(traceEventView({ ...withBefore, areaCode: 'detail' }, snapshot).triggers[0]?.reasonText).toContain('重新录制');
    expect(traceEventView({ ...event, triggers: [{ areaCode: 'header', fieldCode: 'name', source: 'unavailable', reason: 'field-missing' }] }, snapshot).triggers[0]?.reasonText).toContain('不存在该字段');
  });

  it('缓存已有摘要，搜索和构建摘要不读取前后差异；切换会话清空缓存', () => {
    let beforeReads = 0;
    const entry = { ...event, triggers: [], get before() { beforeReads += 1; return { value: 1 }; }, after: { value: 2 } };
    const cache = new TraceViewCache();
    const first = cache.read({ ...session, events: [entry] });
    const next = cache.read({ ...session, events: [entry, { ...event, id: 'event-2' }] });
    expect(next[0]).toBe(first[0]);
    next.filter((item) => item.search.includes('计算'));
    expect(beforeReads).toBe(0);
    expect(traceChanges(entry)).toEqual([{ field: 'value', before: '1', after: '2' }]);
    expect(beforeReads).toBe(1);
    expect(cache.read({ ...session, id: 'trace-2' })[0]).not.toBe(first[0]);
    expect(cache.read(undefined)).toEqual([]);
  });

  it('增量合并不重复事件和开始快照，保留停止时证据，拒绝错位游标', () => {
    const update = { ...session, reset: false, eventOffset: 1, events: [{ ...event, id: 'event-2' }] };
    const next = mergeTraceUpdate(session, update)!;
    expect(next.events.map((item) => item.id)).toEqual(['event-1', 'event-2']);
    expect(next.startSnapshot).toBe(snapshot);
    expect(traceCursor(next)).toEqual({ sessionId: 'trace-1', offset: 2, ended: false });
    expect(() => mergeTraceUpdate(next, update)).toThrow('游标');
    const stopped = mergeTraceUpdate(next, { ...update, eventOffset: 2, events: [], active: false, endSnapshot: snapshot })!;
    expect(stopped.endSnapshot).toBe(snapshot);
    expect(stopped.events).toBe(next.events);
    expect(mergeTraceUpdate(stopped, undefined)).toBeUndefined();
  });
});
