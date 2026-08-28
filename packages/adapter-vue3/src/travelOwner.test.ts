import { describe, expect, it } from 'vitest';
import { findTravelOwner } from './travelOwner';

describe('Travel Owner', () => {
  it.each([
    'NEW_TRAVEL_BOE',
    'NEWTRAVELBOE',
    'TRAVEL_BOE',
    'TRAVELBOE',
    'MULTI_TRAVEL_BOE',
    'MULTITRAVELBOE',
    'MULTI_TRIP_TRAVEL_BOE',
    'MULTITRIPTRAVELBOE',
  ])('识别差旅组件名称 %s', (name) => {
    const travel = { $options: { name } };
    const billTemplate = { data: {}, $parent: travel };

    expect(findTravelOwner(billTemplate)).toBe(travel);
  });

  it('允许 billTemplate 与差旅宿主之间存在中间组件', () => {
    const travel = { $: { type: { name: 'NEWTRAVELBOE' } } };
    const billTemplate = {
      data: {},
      $parent: {
        $options: { name: 'IntermediateWrapper' },
        $parent: travel,
      },
    };

    expect(findTravelOwner(billTemplate)).toBe(travel);
  });

  it('普通单据不注册差旅宿主', () => {
    const billTemplate = {
      data: {},
      $parent: { $options: { name: 'EXPENSE_REIMBURSEMENT_BOE' } },
    };

    expect(findTravelOwner(billTemplate)).toBeUndefined();
  });

  it('不扫描超过限定深度的祖先组件', () => {
    const travel = { $options: { name: 'NEW_TRAVEL_BOE' } };
    const billTemplate = {
      data: {},
      $parent: {
        $parent: travel,
      },
    };

    expect(findTravelOwner(billTemplate, 1)).toBeUndefined();
  });
});
