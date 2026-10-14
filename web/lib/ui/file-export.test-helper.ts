import { act } from 'react';
import { expect, vi } from 'vitest';
import { unpackDataFile } from './compressed-file';
/** Flush each React commit before checking, rather than blocking a commit inside act. */
export async function waitForFileUi(check: () => void): Promise<void> {
  await vi.waitFor(
    async () => {
      await act(async () => {
        await Promise.resolve();
      });
      check();
    },
    { timeout: 5000 },
  );
}
/** Downloads now finish after async lossless compression; inspect the unchanged inner document. */
export async function decodedDownload(
  getBlob: () => Blob | undefined,
): Promise<string> {
  await waitForFileUi(() => {
    expect(document.body.textContent).not.toContain('正在无损压缩文件');
    expect(getBlob()).toBeDefined();
  });
  return (await unpackDataFile(await getBlob()!.text())).source;
}
