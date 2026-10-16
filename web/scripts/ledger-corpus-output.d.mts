export function allocateCorpusRun(
  webRoot: string,
  purpose?: 'corpus' | 'capacity',
): string;
export function assertCorpusRun(
  webRoot: string,
  directory: string,
  expectedPurpose?: 'corpus' | 'capacity',
): string;
export function writeCorpusJson(
  webRoot: string,
  directory: string,
  filename: string,
  value: unknown,
): void;
export function corpusSourceProvenance(webRoot: string): {
  commit: string;
  dirty: boolean;
  files: { path: string; bytes: number; sha256: string }[];
};
