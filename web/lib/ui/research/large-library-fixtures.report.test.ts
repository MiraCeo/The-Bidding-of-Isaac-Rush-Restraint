import { expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { generateLargeLibraryCorpus } from './large-library-fixtures';
it.skipIf(process.env.GENERATE_LARGE_LIBRARY_CORPUS !== '1')(
  'retains 100 synthetic played records and a reproducible corpus manifest',
  async () => {
    const corpus = await generateLargeLibraryCorpus(),
      directory = resolve('work/large-library-performance');
    await mkdir(directory, { recursive: true });
    const source = JSON.stringify(corpus),
      sha256 = createHash('sha256').update(source).digest('hex');
    expect(corpus.prepared).toHaveLength(100);
    await writeFile(resolve(directory, 'corpus.json'), source);
    await writeFile(
      resolve(directory, 'corpus-manifest.json'),
      JSON.stringify(
        {
          schema: 1,
          sha256,
          fileBytes: Buffer.byteLength(source),
          classic: corpus.prepared.filter((p) => p.entry.mode === 'classic')
            .length,
          survival: corpus.prepared.filter((p) => p.entry.mode === 'survival')
            .length,
          storedBytes: corpus.prepared.reduce((n, p) => n + p.entry.bytes, 0),
          rawBytes: corpus.prepared.reduce((n, p) => n + p.entry.rawBytes, 0),
          roomDistribution: corpus.prepared.reduce<Record<number, number>>(
            (acc, p) => {
              acc[p.entry.rooms] = (acc[p.entry.rooms] ?? 0) + 1;
              return acc;
            },
            {},
          ),
          markerProofAmounts: corpus.markerProof.amounts.length,
          generatedFromPlayedStates: true,
          renamedCopies: false,
          metadataTimes: 'fixed synthetic timestamps; not real user save times',
        },
        null,
        2,
      ),
    );
  },
  180000,
);
