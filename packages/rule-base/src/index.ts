export { evaluateFieldRules } from './fieldRules';
export { evaluateTravelRules } from './travelRules';

import { evaluateFieldRules } from './fieldRules';
import { evaluateTravelRules } from './travelRules';

export const baseRuleEvaluators = [evaluateFieldRules, evaluateTravelRules];
