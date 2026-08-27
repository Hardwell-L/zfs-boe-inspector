import { describe, expect, it } from 'vitest';
import { buildTravelView } from './travelView';

describe('buildTravelView', () => {
  it('展开当前人员的标准结果并过滤行程', () => {
    const view = buildTravelView({
      currentPerson: { employeeId: 'E01', employeeName: '张三', postName: '经理' },
      calendarData: [
        { expenseDate: '2026-08-01', travelSite: '武汉', employeeId: 'E01', employeeName: '张三' },
        { expenseDate: '2026-08-01', travelSite: '武汉', employeeId: 'E02', employeeName: '李四' },
      ],
      standardRequests: [{ boeDate: '2026-08-01', schemeCode: 'S01' }],
      standardResults: {
        '武汉_2026-08-01': [
          { operationSubTypeName: '住宿费', standardAmount: 500, currencyCode: 'CNY', controlType: '强控' },
          { operationSubTypeName: '伙食补助', standardAmount: '100' },
        ],
      },
    });
    expect(view.person).toMatchObject({ employeeId: 'E01', employeeName: '张三' });
    expect(view.calendar).toHaveLength(1);
    expect(view.standards).toHaveLength(2);
    expect(view.standards[0]).toMatchObject({ place: '武汉', date: '2026-08-01', standardName: '住宿费', amount: 500 });
    expect(view.requests[0]?.matched).toBe(true);
    expect(view.metrics).toMatchObject({ travelDays: 1, standardCount: 2, matchedRequestCount: 1 });
    expect(view.businessSummary.prerequisites.every(({ satisfied }) => satisfied)).toBe(true);
    expect(view.calendar[0]?.matchStatus).toBe('matched');
  });

  it('无当前人员或无标准时返回稳定空视图', () => {
    expect(buildTravelView()).toMatchObject({
      standards: [], calendar: [], requests: [], metrics: { travelDays: 0, standardCount: 0 },
    });
  });
});
