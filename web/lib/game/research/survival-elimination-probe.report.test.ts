import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { it, expect } from 'vitest';
import { characterOrder } from '../characters';
import { runSurvivalEliminationProbe } from './survival-elimination-probe';
import {
  probePolicies,
  summarizeScores,
  type ProbePolicy,
} from './survival-score-probe';
import { survivalEntryCutLines } from '../../ui/survival-client';
import { survivalEliminationStudyConfig } from './survival-elimination-study-config';
import { isSurvivalDifficulty } from '../survival-difficulty';

const requested = Number(process.env.SURVIVAL_ELIM_GAMES ?? 0);
type Curve = 'proposed' | 'fixed250';
interface World {
  curve: Curve;
  policy: ProbePolicy;
  batch: number;
  seed: number;
  characterId: string;
  floors: number;
  survivors: number;
  allEliminated: boolean;
  probeSurvived: boolean;
  probeRank: number;
  probeEliminationFloor: number | null;
  championCharacter: string | null;
}
interface FloorBucket {
  curve: Curve;
  policy: ProbePolicy;
  floor: number;
  worlds: number;
  active: number[];
  survivors: number[];
  below: number[];
  supplement: number[];
  allBelow: number;
  ties: number;
  aiCount: number;
  aiBelow: number;
  aiRemoved: number;
  aiS: number[];
  R: number[];
  exchange: number[];
  inherit: number[];
  money: number[];
  bossEmpty: number;
  bossZero: number;
  bossWithdrawFunds: number;
  bossWithdrawFundsBelow: number;
  bossEnoughThenRemoved: number;
  bossBelowThenSurvived: number;
}
interface RoomBucket {
  curve: Curve;
  policy: ProbePolicy;
  floor: number;
  room: number;
  n: number;
  zero: number;
  empty: number;
  withdraw: number;
  withdrawFunds: number;
  quotes: number;
  clamped: number;
  doubleActions: number;
  cost: number[];
  moneyBefore: number[];
  score: number[];
  strategies: Record<string, number>;
}
interface Cohort {
  curve: Curve;
  policy: ProbePolicy;
  kind: 'character' | 'doctrine';
  id: string;
  starts: number;
  survived: number;
  champions: number;
  eliminatedFloor: Record<string, number>;
}

it.skipIf(requested <= 0)(
  'tests proposed curve under real eliminations while leaving AI and live entry untouched',
  () => {
    const aiVersion =
      process.env.SURVIVAL_ELIM_AI === 'survival' ? 'survival' : 'legacy';
    const entryBefore = [...survivalEntryCutLines];
    const aiDifficulty = process.env.SURVIVAL_ELIM_DIFFICULTY;
    if (aiDifficulty !== undefined && !isSurvivalDifficulty(aiDifficulty))
      throw new Error('Unknown research difficulty.');
    const batches = Number(process.env.SURVIVAL_ELIM_BATCHES ?? 3),
      baseSeed = Number(process.env.SURVIVAL_ELIM_SEED ?? 20261013);
    if (
      !Number.isSafeInteger(requested) ||
      requested < 5 ||
      requested > 2000 ||
      !Number.isSafeInteger(batches) ||
      batches < 2 ||
      batches > 10
    )
      throw new Error('Invalid elimination-study size.');
    const study = survivalEliminationStudyConfig(
      process.env.SURVIVAL_ELIM_CUTS,
    );
    const curves: { id: Curve; cuts: readonly number[] }[] = [
      { id: 'proposed', cuts: study.effectiveCutLines },
      { id: 'fixed250', cuts: Array(7).fill(250) },
    ];
    const worlds: World[] = [],
      floors = new Map<string, FloorBucket>(),
      rooms = new Map<string, RoomBucket>(),
      cohorts = new Map<string, Cohort>();
    let roomCount = 0,
      playerRoomCount = 0,
      aiRoomCount = 0;
    function floorBucket(curve: Curve, policy: ProbePolicy, floor: number) {
      const key = [curve, policy, floor].join('/');
      let b = floors.get(key);
      if (!b) {
        b = {
          curve,
          policy,
          floor,
          worlds: 0,
          active: [],
          survivors: [],
          below: [],
          supplement: [],
          allBelow: 0,
          ties: 0,
          aiCount: 0,
          aiBelow: 0,
          aiRemoved: 0,
          aiS: [],
          R: [],
          exchange: [],
          inherit: [],
          money: [],
          bossEmpty: 0,
          bossZero: 0,
          bossWithdrawFunds: 0,
          bossWithdrawFundsBelow: 0,
          bossEnoughThenRemoved: 0,
          bossBelowThenSurvived: 0,
        };
        floors.set(key, b);
      }
      return b;
    }
    function roomBucket(
      curve: Curve,
      policy: ProbePolicy,
      floor: number,
      room: number,
    ) {
      const key = [curve, policy, floor, room].join('/');
      let b = rooms.get(key);
      if (!b) {
        b = {
          curve,
          policy,
          floor,
          room,
          n: 0,
          zero: 0,
          empty: 0,
          withdraw: 0,
          withdrawFunds: 0,
          quotes: 0,
          clamped: 0,
          doubleActions: 0,
          cost: [],
          moneyBefore: [],
          score: [],
          strategies: {},
        };
        rooms.set(key, b);
      }
      return b;
    }
    function cohort(
      curve: Curve,
      policy: ProbePolicy,
      kind: Cohort['kind'],
      id: string,
    ) {
      const key = [curve, policy, kind, id].join('/');
      let b = cohorts.get(key);
      if (!b) {
        b = {
          curve,
          policy,
          kind,
          id,
          starts: 0,
          survived: 0,
          champions: 0,
          eliminatedFloor: {},
        };
        cohorts.set(key, b);
      }
      return b;
    }
    const seeds: { batch: number; seed: number; characterId: string }[] = [];
    for (let batch = 0; batch < batches; batch++) {
      const started = Date.now();
      for (let i = 0; i < requested; i++) {
        const index = batch * requested + i,
          seed = (baseSeed + Math.imul(index, 0x9e3779b1)) >>> 0,
          characterId = characterOrder[index % 5]!;
        seeds.push({ batch: batch + 1, seed, characterId });
        for (const curve of curves)
          for (const policy of probePolicies) {
            const boss = new Map<
              string,
              {
                money: number;
                zero: boolean;
                withdrawFunds: boolean;
                enough: boolean;
              }
            >();
            const game = runSurvivalEliminationProbe(
              {
                seed,
                characterId,
                policy,
                cutLines: curve.cuts,
                aiVersion,
                ...(aiDifficulty !== undefined ? { aiDifficulty } : {}),
              },
              {
                onRoom: (before, after, decisions) => {
                  roomCount++;
                  playerRoomCount += before.activePlayerIds.length;
                  const record = after.roomRecords.at(-1)!;
                  const b = roomBucket(
                    curve.id,
                    policy,
                    before.floorIndex + 1,
                    before.roomIndex + 1,
                  );
                  for (const decision of decisions) {
                    const id = decision.turn.playerId,
                      player = before.players.find(
                        (player) => player.id === id,
                      )!;
                    const score = record.roomScoreSummaries[id]!.finalScore;
                    aiRoomCount++;
                    b.n++;
                    b.zero += Number(score === 0);
                    b.empty += Number(player.money === 0);
                    b.withdraw += Number(decision.strategy === 'withdraw');
                    b.withdrawFunds += Number(
                      decision.strategy === 'withdraw' && player.money > 0,
                    );
                    b.quotes += Number(decision.quoteAnalysis !== null);
                    b.clamped += Number(
                      decision.quoteAnalysis?.wasClamped === true,
                    );
                    b.doubleActions += Number(
                      decision.turn.actions.length === 2,
                    );
                    b.strategies[decision.strategy] =
                      (b.strategies[decision.strategy] ?? 0) + 1;
                    b.cost.push(
                      record.resolvedActions
                        .filter((action) => action.playerId === id)
                        .reduce((sum, action) => sum + action.actualCost, 0),
                    );
                    b.moneyBefore.push(player.money);
                    b.score.push(score);
                    if (before.roomIndex === 4) {
                      const projected =
                        (before.currentFloorRoomScores[id] ?? []).reduce(
                          (sum, value) => sum + value,
                          0,
                        ) +
                        0.1 * player.money +
                        0.2 * (before.previousSurvivalScores[id] ?? 0);
                      boss.set(id, {
                        money: player.money,
                        zero: score === 0,
                        withdrawFunds:
                          decision.strategy === 'withdraw' && player.money > 0,
                        enough: projected >= curve.cuts[before.floorIndex]!,
                      });
                    }
                  }
                },
                onFloor: (_before, after) => {
                  const record = after.floorRecords.at(-1)!,
                    b = floorBucket(curve.id, policy, record.floorIndex + 1);
                  b.worlds++;
                  b.active.push(record.activePlayerIds.length);
                  b.survivors.push(record.plan.survivorIds.length);
                  b.below.push(
                    record.plan.eliminations.filter(
                      (entry) => entry.reason === 'below_cut_line',
                    ).length,
                  );
                  b.supplement.push(
                    record.plan.eliminations.filter(
                      (entry) => entry.reason === 'lowest_score',
                    ).length,
                  );
                  b.allBelow += Number(
                    record.resolution.reason === 'all_below',
                  );
                  b.ties += Number(record.resolution.reason === 'random_tie');
                  for (const id of record.activePlayerIds) {
                    if (policy !== 'all_ai' && id === 'human') continue;
                    const score = record.scores[id]!,
                      entry = boss.get(id)!;
                    const removed = record.plan.eliminations.some(
                      (item) => item.playerId === id,
                    );
                    b.aiCount++;
                    b.aiBelow += Number(score.survivalScore < record.cutLine);
                    b.aiRemoved += Number(removed);
                    b.aiS.push(score.survivalScore);
                    b.R.push(score.roomScore);
                    b.exchange.push(score.exchangedScore);
                    b.inherit.push(score.inheritedScore);
                    b.money.push(score.remainingMoney);
                    b.bossEmpty += Number(entry.money === 0);
                    b.bossZero += Number(entry.zero);
                    b.bossWithdrawFunds += Number(entry.withdrawFunds);
                    b.bossWithdrawFundsBelow += Number(
                      entry.withdrawFunds &&
                        score.survivalScore < record.cutLine,
                    );
                    b.bossEnoughThenRemoved += Number(entry.enough && removed);
                    b.bossBelowThenSurvived += Number(
                      !entry.enough && !removed,
                    );
                  }
                  boss.clear();
                },
              },
            );
            expect(game.finalRanking).toHaveLength(20);
            expect(game.activePlayerIds.length).toBeLessThanOrEqual(6);
            expect(
              game.floorRecords.every(
                (record) => record.plan.eliminations.length >= 2,
              ),
            ).toBe(true);
            const probe = game.finalRanking.find(
              (entry) => entry.playerId === 'human',
            )!;
            worlds.push({
              curve: curve.id,
              policy,
              batch: batch + 1,
              seed,
              characterId,
              floors: game.floorRecords.length,
              survivors: game.activePlayerIds.length,
              allEliminated: game.completionReason === 'all_eliminated',
              probeSurvived: probe.status === 'survived',
              probeRank: probe.rank,
              probeEliminationFloor:
                probe.eliminationFloorIndex === null
                  ? null
                  : probe.eliminationFloorIndex + 1,
              championCharacter: game.championId
                ? game.players.find((player) => player.id === game.championId)!
                    .characterId
                : null,
            });
            for (const player of game.players) {
              if (policy !== 'all_ai' && player.id === 'human') continue;
              const role = cohort(
                  curve.id,
                  policy,
                  'character',
                  player.characterId!,
                ),
                doctrine = cohort(
                  curve.id,
                  policy,
                  'doctrine',
                  player.id === 'human'
                    ? 'balanced'
                    : game.aiProfiles[player.id]!.doctrine,
                );
              for (const b of [role, doctrine]) {
                b.starts++;
                b.survived += Number(game.activePlayerIds.includes(player.id));
                b.champions += Number(player.id === game.championId);
                const floor = game.eliminated[player.id]?.floorIndex;
                if (floor !== undefined)
                  b.eliminatedFloor[String(floor + 1)] =
                    (b.eliminatedFloor[String(floor + 1)] ?? 0) + 1;
              }
            }
          }
      }
      console.log(
        `REAL_ELIMINATION_BATCH ${batch + 1}/${batches}: ${requested} worlds × 2 curves × 3 policies, ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
    }
    const mean = (values: readonly number[]) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    const summaries = curves.flatMap((curve) =>
      probePolicies.map((policy) => {
        const sample = worlds.filter(
          (world) => world.curve === curve.id && world.policy === policy,
        );
        return {
          curve: curve.id,
          policy,
          n: sample.length,
          meanFloors: mean(sample.map((world) => world.floors)),
          floors: summarizeScores(sample.map((world) => world.floors)),
          finishCounts: Object.fromEntries(
            Array.from({ length: 7 }, (_, i) => [
              String(i + 1),
              sample.filter((world) => world.floors === i + 1).length,
            ]),
          ),
          meanSurvivors: mean(sample.map((world) => world.survivors)),
          allEliminated: sample.filter((world) => world.allEliminated).length,
          probeSurvived: sample.filter((world) => world.probeSurvived).length,
          probeMeanRank: mean(sample.map((world) => world.probeRank)),
          batchMeanFloors: Array.from({ length: batches }, (_, i) =>
            mean(
              sample
                .filter((world) => world.batch === i + 1)
                .map((world) => world.floors),
            ),
          ),
          batchAllEliminated: Array.from(
            { length: batches },
            (_, i) =>
              sample.filter(
                (world) => world.batch === i + 1 && world.allEliminated,
              ).length,
          ),
        };
      }),
    );
    const floorSummary = Array.from(floors.values(), (b) => ({
      curve: b.curve,
      policy: b.policy,
      floor: b.floor,
      cutLine: curves.find((curve) => curve.id === b.curve)!.cuts[b.floor - 1],
      worlds: b.worlds,
      meanActive: mean(b.active),
      meanSurvivors: mean(b.survivors),
      meanBelow: mean(b.below),
      meanSupplement: mean(b.supplement),
      supplementWorldRate:
        b.supplement.filter((value) => value > 0).length / b.worlds,
      allBelow: b.allBelow,
      ties: b.ties,
      aiCount: b.aiCount,
      aiBelowRate: b.aiBelow / b.aiCount,
      aiRemovedRate: b.aiRemoved / b.aiCount,
      S: summarizeScores(b.aiS),
      R: summarizeScores(b.R),
      exchange: summarizeScores(b.exchange),
      inherit: summarizeScores(b.inherit),
      money: summarizeScores(b.money),
      bossEmptyRate: b.bossEmpty / b.aiCount,
      bossZeroRate: b.bossZero / b.aiCount,
      bossWithdrawFundsRate: b.bossWithdrawFunds / b.aiCount,
      bossWithdrawFundsBelowRate: b.bossWithdrawFundsBelow / b.aiCount,
      bossEnoughThenRemovedRate: b.bossEnoughThenRemoved / b.aiCount,
      bossBelowThenSurvivedRate: b.bossBelowThenSurvived / b.aiCount,
    }));
    const roomSummary = Array.from(rooms.values(), (b) => ({
      curve: b.curve,
      policy: b.policy,
      floor: b.floor,
      room: b.room,
      n: b.n,
      zeroRate: b.zero / b.n,
      emptyBeforeRate: b.empty / b.n,
      withdrawRate: b.withdraw / b.n,
      withdrawFundsRate: b.withdrawFunds / b.n,
      clampedRate: b.quotes ? b.clamped / b.quotes : 0,
      doubleActionRate: b.doubleActions / b.n,
      strategies: b.strategies,
      cost: summarizeScores(b.cost),
      moneyBefore: summarizeScores(b.moneyBefore),
      score: summarizeScores(b.score),
    }));
    const cohortSummary = Array.from(cohorts.values(), (b) => ({
      ...b,
      survivalRate: b.survived / b.starts,
      championRate: b.champions / b.starts,
    }));
    function paired(values: number[]) {
      const average = mean(values),
        variance =
          values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
          (values.length - 1),
        margin = 1.96 * Math.sqrt(variance / values.length);
      return {
        n: values.length,
        mean: average,
        ci95: [average - margin, average + margin],
      };
    }
    const pairedComparisons = probePolicies.map((policy) => {
      const current = worlds.filter(
        (world) => world.curve === 'proposed' && world.policy === policy,
      );
      const baseline = new Map(
        worlds
          .filter(
            (world) => world.curve === 'fixed250' && world.policy === policy,
          )
          .map((world) => [world.seed, world]),
      );
      return {
        policy,
        meanFloorDifference: paired(
          current.map(
            (world) => world.floors - baseline.get(world.seed)!.floors,
          ),
        ),
        probeSurvivalDifference: paired(
          current.map(
            (world) =>
              Number(world.probeSurvived) -
              Number(baseline.get(world.seed)!.probeSurvived),
          ),
        ),
        allEliminationDifference: paired(
          current.map(
            (world) =>
              Number(world.allEliminated) -
              Number(baseline.get(world.seed)!.allEliminated),
          ),
        ),
      };
    });
    const sourceHash = createHash('sha256');
    const sourceFiles: string[] = [];
    function fingerprint(folder: string) {
      for (const entry of readdirSync(folder, { withFileTypes: true }).sort(
        (a, b) => a.name.localeCompare(b.name),
      )) {
        const path = resolve(folder, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'fixtures') fingerprint(path);
        } else if (
          entry.name.endsWith('.ts') &&
          !entry.name.includes('.test.')
        ) {
          const name = relative(process.cwd(), path).replaceAll('\\', '/');
          sourceFiles.push(name);
          sourceHash.update(name + '\0');
          sourceHash.update(readFileSync(path));
        }
      }
    }
    fingerprint(resolve('lib/game'));
    expect(new Set(seeds.map((world) => world.seed)).size).toBe(
      requested * batches,
    );
    expect(worlds).toHaveLength(requested * batches * 6);
    expect(survivalEntryCutLines).toEqual(entryBefore);
    const report = {
      kind: 'research-real-elimination-1',
      createdAt: new Date().toISOString(),
      sourceSha256: sourceHash.digest('hex'),
      sourceFiles,
      config: {
        baseSeed,
        batches,
        worldsPerBatch: requested,
        uniqueWorlds: seeds.length,
        conditionGames: worlds.length,
        curves,
        requestedCutLines: study.requestedCutLines,
        unusedCutLines: study.unusedCutLines,
        maximumFloors: study.maximumFloors,
        policies: probePolicies,
        ai: aiVersion,
        ...(aiDifficulty !== undefined ? { aiDifficulty } : {}),
        allAiPopulation: '10 balanced / 5 cooperative / 5 chaotic',
        confidence:
          'paired 95% normal approximation by world; floor statistics conditional on reaching floor; no player-IID inference',
      },
      counts: {
        rooms: roomCount,
        playerRooms: playerRoomCount,
        aiRooms: aiRoomCount,
      },
      seeds,
      summaries,
      floors: floorSummary,
      rooms: roomSummary,
      cohorts: cohortSummary,
      pairedComparisons,
      worlds,
    };
    const dir = resolve(
      'work',
      `survival-elimination-${baseSeed}-${batches}x${requested}${study.outputSuffix}${aiVersion === 'survival' ? '-survival-ai2' : ''}${aiDifficulty !== undefined ? '-' + aiDifficulty : ''}`,
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'report.json'), JSON.stringify(report, null, 2));
    const fmt = (value: number | null) =>
        value === null ? '—' : value.toFixed(2),
      pct = (value: number) => `${(value * 100).toFixed(1)}%`;
    const lines = [
      `# 生存真实淘汰候选线研究 ${baseSeed}-${batches}x${requested}`,
      '',
      `请求曲线${study.requestedCutLines.join('／')}，实际可能执行前${study.maximumFloors}层${study.effectiveCutLines.join('／')}，与固定250配对；${batches}批、${seeds.length}个独立种子世界，3策略共${worlds.length}条件局。AI策略：${aiVersion}。研究不修改入口。`,
      study.unusedCutLines.length
        ? `未使用的尾部斩杀线：${study.unusedCutLines.join('／')}。20人、每层至少淘汰2人、剩余≤6结算的规则上界为7层，不为研究延长赛制。`
        : '完整请求曲线均在规则允许的层范围内。',
      '',
      '## 统计边界',
      '',
      '- 正式状态机执行真实淘汰、冻结、继承、累计新增分、种子决胜、≤6结束和团灭无冠军；不按第6层强制结束。',
      '- 两脚本条件保持19AI人口9／5／5；全AI条件将测试槽按v29同一独立流初始化为均衡AI，人口10／5／5。所有决策生成于提交前，保持原AI算法与共享随机流。',
      '- 多条件共用同世界，不能按总条件局数当成独立样本。层末和房间数据只统计真正到达该层的参与者，后层存在筛选，不能与v29全20人分布直接解释成因果。',
      '- 补淘汰指实际lowest_score原因，含末位同分抽签；团灭按实际all_eliminated计数，不把总榜第一名误当冠军。',
      '- BOSS前是否够线仅为前四房分＋当前现金10%＋上层S20%的静态记账快照，未预测本房或市场反应，不能证明改变行动就能存活。',
      '',
      '## 整局结果',
      '',
      '|曲线|策略|局数|平均结束层|中位层|第7层结束|平均最终人数|团灭|测试槽存活|测试槽平均名次|各批平均结束层|',
      '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|',
    ];
    for (const row of summaries)
      lines.push(
        `|${row.curve}|${row.policy}|${row.n}|${fmt(row.meanFloors)}|${fmt(row.floors.p50)}|${row.finishCounts['7']}|${fmt(row.meanSurvivors)}|${row.allEliminated}/${row.n}|${row.probeSurvived}/${row.n}|${fmt(row.probeMeanRank)}|${row.batchMeanFloors.map(fmt).join(' / ')}|`,
      );
    lines.push(
      '',
      '## 候选全AI：实际层末',
      '',
      '|层|斩杀线|到达局数|平均入层人数|平均线下淘汰|平均补淘汰|需补淘汰局比例|平均层末人数|S P10|S P25|S中位数|团灭局|',
      '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    );
    for (const row of floorSummary.filter(
      (row) => row.curve === 'proposed' && row.policy === 'all_ai',
    ))
      lines.push(
        `|${row.floor}|${row.cutLine}|${row.worlds}|${fmt(row.meanActive)}|${fmt(row.meanBelow)}|${fmt(row.meanSupplement)}|${pct(row.supplementWorldRate)}|${fmt(row.meanSurvivors)}|${fmt(row.S.p10)}|${fmt(row.S.p25)}|${fmt(row.S.p50)}|${row.allBelow}|`,
      );
    lines.push(
      '',
      '## 候选全AI：AI资金与BOSS行为',
      '',
      '|层|AI层末记录|BOSS前零资金|BOSS零分|有钱观望BOSS|有钱观望且层末线下|BOSS前快照够线但仍淘汰|BOSS前快照线下最终存活|房分均值|兑换均值|继承均值|',
      '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    );
    for (const row of floorSummary.filter(
      (row) => row.curve === 'proposed' && row.policy === 'all_ai',
    ))
      lines.push(
        `|${row.floor}|${row.aiCount}|${pct(row.bossEmptyRate)}|${pct(row.bossZeroRate)}|${pct(row.bossWithdrawFundsRate)}|${pct(row.bossWithdrawFundsBelowRate)}|${pct(row.bossEnoughThenRemovedRate)}|${pct(row.bossBelowThenSurvivedRate)}|${fmt(row.R.mean)}|${fmt(row.exchange.mean)}|${fmt(row.inherit.mean)}|`,
      );
    lines.push(
      '',
      '## 候选全AI：逐房诊断',
      '',
      '|层|房|AI记录|房分均值|房分中位|零分|入房零资金|观望|有钱观望|名义报价限幅|双行动|平均实际支出|',
      '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    );
    for (const row of roomSummary.filter(
      (row) => row.curve === 'proposed' && row.policy === 'all_ai',
    ))
      lines.push(
        `|${row.floor}|${row.room}|${row.n}|${fmt(row.score.mean)}|${fmt(row.score.p50)}|${pct(row.zeroRate)}|${pct(row.emptyBeforeRate)}|${pct(row.withdrawRate)}|${pct(row.withdrawFundsRate)}|${pct(row.clampedRate)}|${pct(row.doubleActionRate)}|${fmt(row.cost.mean)}|`,
      );
    lines.push(
      '',
      '## AI角色与主义：按开局人口为分母',
      '',
      '|曲线|策略|类别|身份|开局人次|最终存活率|冠军人次|',
      '|---|---|---|---|---:|---:|---:|',
    );
    for (const row of cohortSummary)
      lines.push(
        `|${row.curve}|${row.policy}|${row.kind}|${row.id}|${row.starts}|${pct(row.survivalRate)}|${row.champions}|`,
      );
    lines.push(
      '',
      '## 候选减固定250：配对世界差值',
      '',
      '|策略|平均结束层差|近似95%区间|测试槽存活率差|近似95%区间|团灭率差|',
      '|---|---:|---|---:|---|---:|',
    );
    for (const row of pairedComparisons)
      lines.push(
        `|${row.policy}|${fmt(row.meanFloorDifference.mean)}|${row.meanFloorDifference.ci95.map(fmt).join('—')}|${pct(row.probeSurvivalDifference.mean)}|${row.probeSurvivalDifference.ci95.map(pct).join('—')}|${pct(row.allEliminationDifference.mean)}|`,
      );
    lines.push(
      '',
      `房间场次${roomCount}，实际参与玩家房间记录${playerRoomCount}，AI房间记录${aiRoomCount}。研究输入SHA256：\`${report.sourceSha256}\`。`,
      '',
      '这里只记录结果与诊断，不自动改斩杀线、AI权重、预算、角色或正式HTML。全部世界、逐房／层末分布、控制组与批次保存在同目录report.json。',
    );
    writeFileSync(resolve(dir, 'report.md'), lines.join('\n') + '\n');
    console.log(`REAL_ELIMINATION_REPORT=${resolve(dir, 'report.json')}`);
    console.log(JSON.stringify({ summaries, pairedComparisons }));
  },
  900_000,
);
