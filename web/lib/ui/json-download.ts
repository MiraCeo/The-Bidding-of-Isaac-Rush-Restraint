/** Request a browser download; no network, backend or writes to the program HTML. */
import { packDataFile, type FileCodecOptions } from './compressed-file';
export async function downloadPortableJsonFile(
  source: string,
  filename: string,
  options: FileCodecOptions = {},
) {
  const packed = await packDataFile(source, options);
  if (options.signal?.aborted)
    throw new DOMException('导出已取消。', 'AbortError');
  downloadJsonFile(packed.source, filename);
  return packed;
}
export function downloadJsonFile(source: string, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([source], { type: 'application/json;charset=utf-8' }),
  );
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    link.remove();
  }
}
