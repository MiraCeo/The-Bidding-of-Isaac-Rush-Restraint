import {
  maximumSurvivalFloors,
  survivalPrototypeRules,
} from '../survival-rules';
import { validateSurvivalStoredScore } from '../survival-floor';
import { proposedSurvivalCutLines } from './survival-elimination-probe';

/** Research input only: preserve unused schedule entries explicitly, never extend the live rules. */
export function survivalEliminationStudyConfig(source?: string) {
  if (source !== undefined && source.split(',').some((value) => !value.trim()))
    throw new Error('Empty cut-line entry.');
  const requestedCutLines =
    source === undefined
      ? [...proposedSurvivalCutLines]
      : source.split(',').map(Number);
  const maximumFloors = maximumSurvivalFloors(survivalPrototypeRules);
  if (requestedCutLines.length < maximumFloors || requestedCutLines.length > 20)
    throw new Error(
      'Provide all seven possible floors, at most twenty research entries.',
    );
  requestedCutLines.forEach((value) => validateSurvivalStoredScore(value, 4));
  return {
    requestedCutLines,
    effectiveCutLines: requestedCutLines.slice(0, maximumFloors),
    unusedCutLines: requestedCutLines.slice(maximumFloors),
    maximumFloors,
    outputSuffix: source === undefined ? '' : `-${requestedCutLines.join('-')}`,
  };
}
