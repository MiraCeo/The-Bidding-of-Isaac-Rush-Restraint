export { corpusSourceProvenance } from './ledger-corpus-output.mjs';
export function allocateStudyRun(
  root: string,
  purpose: 'pilot' | 'main' | 'campaign' | 'analysis',
): string;
export function assertStudyRun(
  root: string,
  directory: string,
): {
  kind: string;
  version: number;
  purpose: 'pilot' | 'main' | 'campaign' | 'analysis';
  source: ReturnType<
    typeof import('./ledger-corpus-output.mjs').corpusSourceProvenance
  >;
};
export function writeStudyJson(
  root: string,
  directory: string,
  name: string,
  value: unknown,
): void;
