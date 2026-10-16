export function allocateCorpusRun(webRoot: string): string;
export function assertCorpusRun(webRoot: string, directory: string): string;
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
