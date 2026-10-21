import { expect, it } from 'vitest';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  audit117Plan as plan,
  audit117Seed,
  assertAudit117,
  audit117Tasks,
} from '../../../scripts/audit117-plan.mjs';
import { corpusSourceProvenance } from '../../../scripts/ledger-corpus-output.mjs';
import { sha256Hex } from '../../shared/sha256';
import { canonicalJson } from '../../shared/json-facts';
import {
  achievementCatalog,
  achievementCharacters,
  type AchievementId,
} from './catalog';
import { achievementCollectionMetadata } from './collection-metadata';
import { achievementNumber } from './numbering';
import { achievementSeries } from './series';
import { runTempoMatch } from './tempo-study.test-helper';
import { runEdgeMatch, auditFloorCounts } from './audit117-edge.test-helper';
import {
  availableStudyRoles,
  advanceStudyProfile,
  freshStudyProfile,
} from './current-study.test-helper';
import { readPlayerProfile, type PlayerProfile } from '../player-profile';
import { projectAchievementRegistry } from './registry';
import type { CharacterId } from '../../game/item-types';
import type { StudyPolicy } from './difficulty-study.test-helper';
import type { ClassicDifficulty } from '../../game/classic-difficulty';
import type { GrowthContext } from './lifecycle';
import type { TempoScenario } from '../../../scripts/achievement-tempo-plan.mjs';

interface AuditRow {
  identity: string;
  block: number;
  cell: string;
  index: number;
  seed: number;
  role: CharacterId;
  policy: string;
  mode: 'classic' | 'survival';
  difficulty: ClassicDifficulty;
  aiPolicy: string;
  achieved: string[];
  progress: Partial<Record<AchievementId, number>>;
  availableRolesBefore: CharacterId[];
  floors: ReturnType<typeof auditFloorCounts>;
  traceFingerprint: string;
  root: string;
  humanRooms: number;
}
interface HistoricRow {
  identity: string;
  block: number;
  cell: string;
  index: number;
  seed: number;
  role: CharacterId;
  policy: StudyPolicy;
  achieved: string[];
  availableRolesBefore: CharacterId[];
  scenario: TempoScenario;
  traceFingerprint: string;
  match: { humanRooms: number; root: string };
}
function eligible(
  a: (typeof achievementCatalog)[number],
  r: Pick<AuditRow, 'mode' | 'role' | 'difficulty'>,
) {
  if (a.scope !== 'shared' && a.scope !== r.mode) return false;
  if (a.id === 'E11' && r.role !== 'isaac') return false;
  if (['E12', 'E16'].includes(a.id) && r.role !== 'lost') return false;
  if (['E15', 'E19', 'E20'].includes(a.id) && r.role !== 'jacob_esau')
    return false;
  if (['F02', 'F10'].includes(a.id) && r.difficulty !== 'highest') return false;
  if (a.id === 'F16' && !['hard', 'highest'].includes(r.difficulty))
    return false;
  return true;
}
it.skipIf(process.env.AUDIT117 !== '1')(
  'runs one fixed all117 audit task',
  () => {
    const root = process.cwd(),
      directory = process.env.AUDIT117_DIR!,
      task = process.env.AUDIT117_TASK!,
      marker = assertAudit117(root, directory);
    if (!audit117Tasks().includes(task)) throw Error('Unknown audit task');
    expect(corpusSourceProvenance(root)).toEqual(marker.source);
    const rows: AuditRow[] = [],
      profiles: Record<string, PlayerProfile> = {};
    const write = (name: string, data: unknown) =>
      writeFileSync(resolve(directory, name), JSON.stringify(data) + '\n', {
        flag: 'wx',
      });
    const witness = resolve(directory, `witness-${task}.jsonl`);
    const add = (identity: string, context: GrowthContext) => {
      const fingerprint = sha256Hex(canonicalJson(context));
      if (context.units.at(-1)?.stage !== 'complete')
        throw Error('Incomplete audit context');
      appendFileSync(
        witness,
        JSON.stringify({ identity, context, traceFingerprint: fingerprint }) +
          '\n',
      );
      return fingerprint;
    };
    const runSingle = (
      seed: number,
      role: CharacterId,
      policy: StudyPolicy,
      mode: 'classic' | 'survival',
      difficulty: ClassicDifficulty,
      block: number,
      index: number,
    ) => {
      const aiPolicy =
        mode === 'classic' ? 'classic-population-1' : 'role-aware-1';
      const result = runTempoMatch(seed, role, policy, {
        id: mode + '-' + difficulty,
        mode,
        aiPolicy,
        difficulty,
      });
      const cell = `${mode}/${difficulty}/${policy}/${role}`,
        identity = `${task}/${cell}/${index}`;
      const fingerprint = add(identity, result.context);
      expect(fingerprint).toBe(result.match.traceFingerprint);
      rows.push({
        identity,
        block,
        cell,
        index,
        seed,
        role,
        policy,
        mode,
        difficulty,
        aiPolicy,
        achieved: result.match.achieved,
        progress: result.progress,
        availableRolesBefore: [],
        floors: auditFloorCounts(result.context.units),
        traceFingerprint: fingerprint,
        root: result.context.root,
        humanRooms: result.match.humanRooms,
      });
    };
    if (task === 'pilot' || task.startsWith('matrix-')) {
      writeFileSync(witness, '', { flag: 'wx' });
      const block = task === 'pilot' ? 0 : Number(task.split('-')[1]);
      const seed = audit117Seed(
        block,
        0,
        task === 'pilot' ? 'pilot' : 'matrix',
      );
      for (const role of task === 'pilot'
        ? (['isaac'] as const)
        : achievementCharacters)
        for (const mode of ['classic', 'survival'] as const)
          for (const difficulty of plan.difficulties)
            for (const policy of plan.policies)
              runSingle(seed, role, policy, mode, difficulty, block, 1);
      if (task === 'pilot')
        for (let i = 0; i < 2; i++) {
          const seed = audit117Seed(0, i, 'pilot'),
            result = runEdgeMatch(seed, 'isaac'),
            identity = `pilot/edge/${i}`;
          add(identity, result.context);
          expect(result.floors.lowestFloors).toBe(result.progress.F03 ?? 0);
          write(`pilot-edge-${i}.json`, {
            seed,
            controller: result.controller,
            floors: result.floors,
          });
        }
    } else if (task.startsWith('natural-') || task.startsWith('edge-')) {
      writeFileSync(witness, '', { flag: 'wx' });
      const block = Number(task.split('-')[1]),
        natural = task.startsWith('natural-');
      const prior: Record<string, PlayerProfile> = natural
        ? JSON.parse(
            readFileSync(
              resolve(root, plan.confirmation, `profiles-${block}.json`),
              'utf8',
            ),
          )
        : {};
      const priorMeta = natural
        ? JSON.parse(
            readFileSync(
              resolve(root, plan.confirmation, `block-${block}.json`),
              'utf8',
            ),
          )
        : null;
      for (const policy of natural ? plan.policies : ['edge-public-1']) {
        const cell = 'survival/standard/' + policy;
        profiles[cell] = natural
          ? readPlayerProfile(prior['survival-standard/' + policy])
          : freshStudyProfile();
        if (natural)
          expect(
            sha256Hex(JSON.stringify(prior['survival-standard/' + policy])),
          ).toBe(priorMeta.profileHashes['survival-standard/' + policy]);
        for (let index = natural ? 31 : 1; index <= 50; index++) {
          const profile = profiles[cell]!,
            available = availableStudyRoles(profile),
            role = available[(index - 1) % available.length]!,
            seed = audit117Seed(block, index - 1, 'long');
          const result = natural
            ? runTempoMatch(seed, role, policy as StudyPolicy, {
                id: 'survival-standard',
                mode: 'survival',
                aiPolicy: 'role-aware-1',
                difficulty: 'standard',
              })
            : runEdgeMatch(seed, role);
          const identity = `${task}/${cell}/${index}`,
            fingerprint = add(identity, result.context),
            before = JSON.stringify(profile);
          const advanced = advanceStudyProfile(
            profile,
            result.context,
            index,
            index === (natural ? 31 : 1) || index === 50,
          );
          expect(JSON.stringify(profile)).toBe(before);
          rows.push({
            identity,
            block,
            cell,
            index,
            seed,
            role,
            policy,
            mode: 'survival',
            difficulty: 'standard',
            aiPolicy: 'role-aware-1',
            achieved: advanced.achieved,
            progress: advanced.progress,
            availableRolesBefore: available,
            floors: auditFloorCounts(result.context.units),
            traceFingerprint: fingerprint,
            root: result.context.root,
            humanRooms:
              'humanRooms' in result
                ? result.humanRooms
                : result.match.humanRooms,
          });
          profiles[cell] = advanced.profile;
          if (index % 10 === 0)
            process.stdout.write(`${task} ${policy}: ${index}/50\n`);
        }
      }
      for (const profile of Object.values(profiles))
        expect(readPlayerProfile(JSON.parse(JSON.stringify(profile)))).toEqual(
          profile,
        );
    } else {
      // Inventory reuses all prior achieved records and verified profile projections.
      const historic = (folder: string, scenes?: string[]) => {
        const result: AuditRow[] = [],
          ends: Record<string, Partial<Record<AchievementId, number>>> = {};
        for (let block = 0; block < 6; block++) {
          const meta = JSON.parse(
            readFileSync(resolve(root, folder, `block-${block}.json`), 'utf8'),
          );
          const raw = readFileSync(
            resolve(root, folder, `rows-${block}.json`),
            'utf8',
          );
          expect(sha256Hex(raw)).toBe(meta.rowsSha256);
          const batch = JSON.parse(raw) as HistoricRow[],
            profileRaw: Record<string, PlayerProfile> = JSON.parse(
              readFileSync(
                resolve(root, folder, `profiles-${block}.json`),
                'utf8',
              ),
            );
          for (const [cell, p] of Object.entries(profileRaw)) {
            expect(sha256Hex(JSON.stringify(p))).toBe(meta.profileHashes[cell]);
            ends[block + '/' + cell] = projectAchievementRegistry(
              readPlayerProfile(p),
            )!.progress;
          }
          const witnesses = readFileSync(
            resolve(root, folder, `witness-${block}.jsonl`),
            'utf8',
          );
          expect(sha256Hex(witnesses)).toBe(meta.witnessSha256);
          const wm = new Map(
            (
              witnesses
                .trim()
                .split('\n')
                .map((x) => JSON.parse(x)) as {
                identity: string;
                context: GrowthContext;
                traceFingerprint: string;
              }[]
            ).map((w) => [w.identity, w]),
          );
          for (const r of batch) {
            if (scenes && !scenes.includes(r.scenario.id)) continue;
            const w = wm.get(r.identity)!;
            expect(sha256Hex(canonicalJson(w.context))).toBe(
              r.traceFingerprint,
            );
            result.push({
              identity: r.identity,
              block,
              cell:
                r.scenario.mode === 'survival'
                  ? 'survival/standard/' + r.policy
                  : r.cell,
              index: r.index,
              seed: r.seed,
              role: r.role,
              policy: r.policy,
              mode: r.scenario.mode,
              difficulty: r.scenario.difficulty,
              aiPolicy: r.scenario.aiPolicy,
              achieved: r.achieved,
              progress: {},
              availableRolesBefore: r.availableRolesBefore,
              floors: auditFloorCounts(w.context.units),
              traceFingerprint: r.traceFingerprint,
              root: r.match.root,
              humanRooms: r.match.humanRooms,
            });
          }
        }
        return { rows: result, ends };
      };
      const baseline = historic(plan.baseline),
        confirmation = historic(plan.confirmation);
      const load = (prefix: string) =>
        Array.from(
          { length: prefix === 'matrix' ? 4 : 6 },
          (_, b) =>
            JSON.parse(
              readFileSync(
                resolve(directory, `rows-${prefix}-${b}.json`),
                'utf8',
              ),
            ) as AuditRow[],
        ).flat();
      const matrix = load('matrix'),
        natural = load('natural'),
        edge = load('edge');
      expect(matrix).toHaveLength(480);
      expect(natural).toHaveLength(360);
      expect(edge).toHaveLength(300);
      const natural50 = [
        ...baseline.rows.filter((r) => r.mode === 'survival'),
        ...confirmation.rows.filter((r) => r.mode === 'survival'),
        ...natural,
      ];
      expect(natural50).toHaveLength(900);
      const classics = baseline.rows.filter(
        (r) => r.mode === 'classic' && r.aiPolicy === 'classic-population-1',
      );
      const pathStats = (
        data: AuditRow[],
        a: (typeof achievementCatalog)[number],
      ) => {
        const keys = [...new Set(data.map((r) => r.block + '/' + r.cell))];
        let qualifies = 0,
          hits = 0,
          eligibleMatches = 0;
        const first: number[] = [],
          final: number[] = [];
        for (const k of keys) {
          const path = data
              .filter((r) => r.block + '/' + r.cell === k)
              .sort((a, b) => a.index - b.index),
            allowed = path.filter((r) => eligible(a, r));
          if (!allowed.length) continue;
          qualifies++;
          eligibleMatches += allowed.length;
          const hit = path.find((r) => r.achieved.includes(a.id));
          if (hit) {
            hits++;
            first.push(hit.index);
          }
          const last = path.at(-1)!;
          const p = last.progress[a.id] ?? baseline.ends[k]?.[a.id];
          if (p !== undefined) final.push(p);
        }
        first.sort((a, b) => a - b);
        return {
          paths: qualifies,
          eligibleMatches,
          hits,
          censored: qualifies - hits,
          firstHitAmongReached: first.length
            ? first.length % 2
              ? first[(first.length - 1) / 2]!
              : (first[first.length / 2 - 1]! + first[first.length / 2]!) / 2
            : null,
          finalProgress: final,
        };
      };
      const catalog = achievementCatalog.map((a) => ({
        ...a,
        number: achievementNumber(a.id),
        metadata: achievementCollectionMetadata[a.id],
        series: achievementSeries.find((s) => s.ids.includes(a.id))?.id ?? null,
      }));
      expect(catalog).toHaveLength(117);
      expect(new Set(catalog.map((a) => a.number)).size).toBe(117);
      const entries = catalog.map((a) => {
        const allowed = matrix.filter((r) => eligible(a, r)),
          single =
            a.id === 'E08'
              ? null
              : {
                  hits: allowed.filter((r) => r.achieved.includes(a.id)).length,
                  n: allowed.length,
                };
        const classic20 = pathStats(classics, a),
          survival50 = pathStats(natural50, a),
          edge50 = pathStats(edge, a);
        let status = '暂时保留',
          reason = '当前样本未显示明确调整必要；不等于所有边界已验收';
        if (['D13', 'D14', 'E25', 'E26'].includes(a.id)) {
          status = '建议调整';
          reason = '已有30局节奏候选；银阶及正式次数／旧进度方案待确认';
        } else if (['F13', 'F14'].includes(a.id)) {
          status = '继续观察';
          reason = '按50局自然与公开压线结果另述，不凭零命中直接降门槛';
        } else if (
          (single?.hits ?? 0) +
            classic20.hits +
            survival50.hits +
            edge50.hits ===
          0
        ) {
          status = '证据不足';
          reason = '本次合格样本尚未命中，不能判不可达或平衡通过';
        } else if (
          (a.kind === 'cumulative' &&
            a.target > 1 &&
            classic20.paths + survival50.paths > 0 &&
            classic20.censored + survival50.censored > 0) ||
          ['D03', 'D10', 'D16', 'E07'].includes(a.id)
        ) {
          status = '继续观察';
          reason = '累计／机会型仍有截尾或模式差异，先保留门槛';
        }
        return {
          ...a,
          single,
          classic20,
          survival50,
          edge50,
          status,
          reason,
          byClassicDifficulty: plan.difficulties.map((d) => ({
            difficulty: d,
            ...pathStats(
              classics.filter((r) => r.difficulty === d),
              a,
            ),
          })),
          bySurvivalPolicy: plan.policies.map((p) => ({
            policy: p,
            ...pathStats(
              natural50.filter((r) => r.policy === p),
              a,
            ),
          })),
        };
      });
      const longPaths = [
        ...new Set(natural50.map((r) => r.block + '/' + r.cell)),
      ].map((k) => {
        const path = natural50
          .filter((r) => r.block + '/' + r.cell === k)
          .sort((a, b) => a.index - b.index);
        expect(path).toHaveLength(50);
        const final = path.at(-1)!;
        expect(path.reduce((n, r) => n + r.floors.lowestFloors, 0)).toBe(
          final.progress.F03 ?? 0,
        );
        return {
          key: k,
          policy: final.policy,
          block: final.block,
          floors: path.reduce(
            (o, r) => ({
              humanFloors: o.humanFloors + r.floors.humanFloors,
              passedFloors: o.passedFloors + r.floors.passedFloors,
              lowestFloors: o.lowestFloors + r.floors.lowestFloors,
            }),
            { humanFloors: 0, passedFloors: 0, lowestFloors: 0 },
          ),
          at: [30, 40, 50].map((index) => ({
            index,
            progress:
              path.find((r) => r.index === index)!.progress.F03 ??
              (index === 30
                ? confirmation.ends[
                    k.replace('survival/standard/', 'survival-standard/')
                  ]?.F03
                : undefined),
            achieved: path.find((r) => r.index === index)!.achieved,
          })),
          firstSilver:
            path.find((r) => r.achieved.includes('F13'))?.index ?? null,
          firstGold:
            path.find((r) => r.achieved.includes('F14'))?.index ?? null,
        };
      });
      const edgePaths = [
        ...new Set(edge.map((r) => r.block + '/' + r.cell)),
      ].map((k) => {
        const path = edge.filter((r) => r.block + '/' + r.cell === k);
        const last = path.at(-1)!;
        expect(path).toHaveLength(50);
        expect(path.reduce((n, r) => n + r.floors.lowestFloors, 0)).toBe(
          last.progress.F03 ?? 0,
        );
        return {
          key: k,
          block: last.block,
          floors: path.reduce(
            (o, r) => ({
              humanFloors: o.humanFloors + r.floors.humanFloors,
              passedFloors: o.passedFloors + r.floors.passedFloors,
              lowestFloors: o.lowestFloors + r.floors.lowestFloors,
            }),
            { humanFloors: 0, passedFloors: 0, lowestFloors: 0 },
          ),
          at: [30, 40, 50].map((index) => ({
            index,
            progress: path.find((r) => r.index === index)!.progress.F03,
          })),
          firstSilver:
            path.find((r) => r.achieved.includes('F13'))?.index ?? null,
          firstGold:
            path.find((r) => r.achieved.includes('F14'))?.index ?? null,
        };
      });
      // Full individual matrices and window sizes remain available instead of a pooled human rate.
      write('inventory.json', {
        catalog: entries,
        longPaths,
        edgePaths,
        source: marker.source,
        counts: {
          matrix: matrix.length,
          naturalAdded: natural.length,
          edge: edge.length,
          reused: 2700,
        },
        coverage: {
          matrixObserved: new Set(matrix.flatMap((r) => r.achieved)).size,
          combinedObserved: entries.filter(
            (e) =>
              (e.single?.hits ?? 0) +
                e.classic20.hits +
                e.survival50.hits +
                e.edge50.hits >
              0,
          ).length,
        },
        note: 'Mixed classic difficulties are paired diagnostic paths; 6 long-path seed blocks, not independent human telemetry. Qualified role exposure differs. Pilot excluded.',
      });
    }
    if (task !== 'inventory') {
      write(`rows-${task}.json`, rows);
      write(`profiles-${task}.json`, profiles);
    }
    expect(corpusSourceProvenance(root)).toEqual(marker.source);
  },
  1800000,
);
