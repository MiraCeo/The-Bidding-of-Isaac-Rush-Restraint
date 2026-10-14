/** Current transport-independent contract shared by both game modes. */
export const currentFileVersion = 5;
export type FileMode = 'classic' | 'survival';
export type FileKind = 'checkpoint' | 'replay' | 'backup';
export function assertCurrentFileHeader(
  doc: Record<string, unknown>,
  mode?: FileMode,
  kind?: FileKind,
): void {
  if (doc.version !== currentFileVersion)
    throw new Error(
      '仅支持当前v5对局文件；旧v2/v3/v4与未知版本不读取、不自动迁移，原数据保留。',
    );
  if (doc.mode !== 'classic' && doc.mode !== 'survival')
    throw new Error('当前文件必须明确标注经典或生存模式。');
  if (mode && doc.mode !== mode) throw new Error('文件模式与读取入口不一致。');
  if (
    !['checkpoint', 'replay', 'backup'].includes(String(doc.kind)) ||
    (doc.kind === 'replay'
      ? doc.format !== 'the-bidding-of-isaac-replay'
      : doc.format !== 'the-bidding-of-isaac-save')
  )
    throw new Error('文件格式与用途不一致，不能将回放当作续玩存档。');
  if (kind && doc.kind !== kind) throw new Error('文件用途与读取入口不一致。');
}
