import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { it, expect } from 'vitest';
import { characterOrder } from '../characters';
import {
  runSurvivalScoreProbe,
  summarizeScores,
  probePolicies,
  type ProbePolicy,
} from './survival-score-probe';
import { survivalPrototypeRules } from '../survival-rules';

const requested = Number(process.env.SURVIVAL_SCORE_GAMES ?? 0);
interface Bucket {
  policy: ProbePolicy;
  floor: number;
  scope: 'ai' | 'probe';
  view: 'room' | 'kind' | 'floor' | 'character' | 'batch';
  key: string;
  metric: string;
  values: number[];
}
interface FloorWorld {
  policy: ProbePolicy;
  floor: number;
  batch: number;
  ai: number[];
  all: number[];
}

it.skipIf(requested <= 0)(
  'measures seven full-roster floors in independent batches, with no eliminations',
  () => {
    const batchCount = Number(process.env.SURVIVAL_SCORE_BATCHES ?? 3),
      baseSeed = Number(process.env.SURVIVAL_SCORE_SEED ?? 20261013);
    if (
      !Number.isSafeInteger(requested) ||
      requested < 5 ||
      requested > 2000 ||
      !Number.isSafeInteger(batchCount) ||
      batchCount < 2 ||
      batchCount > 10
    )
      throw new Error('Invalid bounded score study size.');
    const buckets = new Map<string, Bucket>();
    const worlds: FloorWorld[] = [];
    const seeds: { batch: number; seed: number; characterId: string }[] = [];
    const seen = new Set<number>();
    let rooms = 0,
      playerRooms = 0,
      playerFloors = 0;
    function add(
      policy: ProbePolicy,
      floor: number,
      scope: Bucket['scope'],
      view: Bucket['view'],
      key: string,
      metric: string,
      value: number,
    ) {
      const id = [policy, floor, scope, view, key, metric].join('/');
      let bucket = buckets.get(id);
      if (!bucket) {
        bucket = { policy, floor, scope, view, key, metric, values: [] };
        buckets.set(id, bucket);
      }
      bucket.values.push(value);
    }
    for (let batch = 0; batch < batchCount; batch++) {
      const started = Date.now();
      for (let i = 0; i < requested; i++) {
        const global = batch * requested + i,
          seed = (baseSeed + Math.imul(global, 0x9e3779b1)) >>> 0,
          characterId = characterOrder[global % 5]!;
        if (seen.has(seed)) throw new Error('Repeated world seed.');
        seen.add(seed);
        seeds.push({ batch: batch + 1, seed, characterId });
        for (const policy of probePolicies)
          runSurvivalScoreProbe(
            { seed, characterId, policy },
            {
              onRoom: ({ room, result }) => {
                rooms++;
                playerRooms += result.players.length;
                for (const player of result.players) {
                  const scope: Bucket['scope'] = player.isHuman
                      ? 'probe'
                      : 'ai',
                    score = result.roomScoreSummaries[player.id]!;
                  for (const metric of [
                    'finalScore',
                    'initialScore',
                    'retroactiveScore',
                  ] as const)
                    add(
                      policy,
                      room.floorIndex + 1,
                      scope,
                      'room',
                      String(room.roomIndex + 1),
                      metric,
                      score[metric],
                    );
                  add(
                    policy,
                    room.floorIndex + 1,
                    scope,
                    'kind',
                    room.kind,
                    'finalScore',
                    score.finalScore,
                  );
                  add(
                    policy,
                    room.floorIndex + 1,
                    scope,
                    'room',
                    String(room.roomIndex + 1),
                    'marketTarget',
                    result.baseline?.target ?? 0,
                  );
                  add(
                    policy,
                    room.floorIndex + 1,
                    scope,
                    'room',
                    String(room.roomIndex + 1),
                    'moneyAfter',
                    player.money,
                  );
                }
                expect(result.players.length).toBe(20);
              },
              onFloor: ({ floorIndex, players, scores }) => {
                playerFloors += players.length;
                for (const player of players) {
                  const scope: Bucket['scope'] = player.isHuman
                    ? 'probe'
                    : 'ai';
                  for (const metric of [
                    'roomScore',
                    'exchangedScore',
                    'inheritedScore',
                    'newScore',
                    'survivalScore',
                    'remainingMoney',
                  ] as const)
                    add(
                      policy,
                      floorIndex + 1,
                      scope,
                      'floor',
                      'all',
                      metric,
                      scores[player.id]![metric],
                    );
                  add(
                    policy,
                    floorIndex + 1,
                    scope,
                    'character',
                    player.characterId!,
                    'survivalScore',
                    scores[player.id]!.survivalScore,
                  );
                  add(
                    policy,
                    floorIndex + 1,
                    scope,
                    'batch',
                    String(batch + 1),
                    'survivalScore',
                    scores[player.id]!.survivalScore,
                  );
                }
                worlds.push({
                  policy,
                  floor: floorIndex + 1,
                  batch: batch + 1,
                  ai: players
                    .filter((player) => !player.isHuman)
                    .map((player) => scores[player.id]!.survivalScore),
                  all: players.map(
                    (player) => scores[player.id]!.survivalScore,
                  ),
                });
              },
            },
          );
      }
      console.log(
        `NO_ELIMINATION_BATCH ${batch + 1}/${batchCount}: ${requested} worlds × ${probePolicies.length} conditions, ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
    }
    const metrics = Array.from(buckets.values(), ({ values, ...identity }) => ({
      ...identity,
      summary: summarizeScores(values),
    }));
    const find = (
      policy: ProbePolicy,
      floor: number,
      view: Bucket['view'],
      key: string,
      metric = 'survivalScore',
      scope: Bucket['scope'] = 'ai',
    ) =>
      metrics.find(
        (row) =>
          row.policy === policy &&
          row.floor === floor &&
          row.scope === scope &&
          row.view === view &&
          row.key === key &&
          row.metric === metric,
      )!.summary;
    const candidates = probePolicies.flatMap((policy) =>
      Array.from({ length: 7 }, (_, i) => {
        const score = find(policy, i + 1, 'floor', 'all');
        return {
          policy,
          floor: i + 1,
          p10: score.p10,
          p15: score.p15,
          p20: score.p20,
          p25: score.p25,
          batchP10: Array.from(
            { length: batchCount },
            (_, batch) => find(policy, i + 1, 'batch', String(batch + 1)).p10,
          ),
          batchP25: Array.from(
            { length: batchCount },
            (_, batch) => find(policy, i + 1, 'batch', String(batch + 1)).p25,
          ),
        };
      }),
    );
    const cuts = [
      ...Array.from({ length: 29 }, (_, i) => 100 + i * 50),
      1750,
      2000,
      2500,
      3000,
      4000,
      5000,
    ];
    function stats(values: number[]) {
      const mean = values.reduce((a, b) => a + b, 0) / values.length,
        variance =
          values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
          (values.length - 1),
        margin = 1.96 * Math.sqrt(variance / values.length);
      return {
        mean,
        ci95: [Math.max(0, mean - margin), Math.min(20, mean + margin)],
      };
    }
    const cutSweep = probePolicies.flatMap((policy) =>
      Array.from({ length: 7 }, (_, i) => {
        const sample = worlds.filter(
          (world) => world.policy === policy && world.floor === i + 1,
        );
        return cuts.map((cutLine) => {
          const below = sample.map(
              (world) => world.all.filter((score) => score < cutLine).length,
            ),
            removed = below.map((count) => Math.max(2, count));
          return {
            policy,
            floor: i + 1,
            cutLine,
            worlds: sample.length,
            below: stats(below),
            virtualEliminations: stats(removed),
            minimumSupplementRate:
              below.filter((count) => count < 2).length / below.length,
            allBelowRate:
              below.filter((count) => count === 20).length / below.length,
            atLeast6BelowRate:
              below.filter((count) => count >= 6).length / below.length,
            aiBelowRate:
              sample.reduce(
                (sum, world) =>
                  sum + world.ai.filter((score) => score < cutLine).length,
                0,
              ) / sample.reduce((sum, world) => sum + world.ai.length, 0),
            batchMeanRemoved: Array.from({ length: batchCount }, (_, batch) => {
              const batchValues = sample
                .filter((world) => world.batch === batch + 1)
                .map((world) =>
                  Math.max(
                    2,
                    world.all.filter((score) => score < cutLine).length,
                  ),
                );
              return stats(batchValues).mean;
            }),
          };
        });
      }).flat(),
    );
    const source = createHash('sha256');
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
          source.update(name + '\0');
          source.update(readFileSync(path));
        }
      }
    }
    fingerprint(resolve('lib/game'));
    const report = {
      kind: 'research-no-elimination-1',
      createdAt: new Date().toISOString(),
      sourceSha256: source.digest('hex'),
      sourceFiles,
      configuration: {
        baseSeed,
        batches: batchCount,
        worldsPerBatch: requested,
        uniqueWorlds: seeds.length,
        conditionGames: seeds.length * 3,
        floors: 7,
        roomsPerFloor: 5,
        players: 20,
        policies: probePolicies,
        rules: survivalPrototypeRules,
        quantile: 'type-7 linear interpolation',
        confidence:
          '95% normal approximation on independent world counts, not individual player-room IID observations',
        aiHorizon:
          'same live 20-active survival upper bound:35-roomIndex; no elimination or fixed-end knowledge',
      },
      counts: { rooms, playerRooms, playerFloors },
      seeds,
      metrics,
      candidates,
      cutSweep,
    };
    expect(rooms).toBe(seeds.length * 3 * 35);
    expect(playerRooms).toBe(rooms * 20);
    expect(playerFloors).toBe(seeds.length * 3 * 7 * 20);
    const suffix = `${baseSeed}-${batchCount}x${requested}`,
      folder = resolve('work', `survival-score-${suffix}`);
    mkdirSync(folder, { recursive: true });
    const jsonPath = resolve(folder, 'report.json');
    writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    const fmt = (value: number | null) =>
      value === null ? '—' : value.toFixed(2);
    const lines = [
      `# 生存不淘汰分数测试 ${suffix}`,
      '',
      `固定${seeds.length}个独立种子世界，${batchCount}轮，每轮${requested}个；3条件共${seeds.length * 3}局，每局7层35房，所有20人始终参与。`,
      '',
      `房间场次${rooms}；玩家房间记录${playerRooms}；玩家层末记录${playerFloors}。源输入SHA256：\`${report.sourceSha256}\`。`,
      '',
      '## 口径',
      '',
      '- 真正关闭淘汰，不是把斩杀线设为0；后者正式规则仍会淘汰2人。独立研究运行器不改变正式客户端或v4协议。',
      '- 固定每层1000基础资金，保留角色、入房经济、库存、普通BOSS池、25件道具、4位存储、10%兑换和20%递归继承。每次房分取含心脏追溯的最终房间分。',
      '- pace_bid：19名现行AI＋1名按剩余房数均摊资金、A/B交替竞拍的脚本；withdraw：19名AI＋1名全观望脚本。脚本槽与AI分开统计。',
      '- all_ai：第20槽改为独立初始化的均衡AI，形成10均衡／5合作／5混乱。3条件使用同种子和角色配对，并非3倍独立世界。',
      '- 表格每行的玩家样本量不是独立样本量；分位数为Type-7线性插值。候选扫描的区间按独立世界的淘汰人数给出正态近似，未将同房玩家视作IID。',
      '- 下列反事实只在未淘汰的全20人层末上计算线下人数／最少补2人，不把后续全20人市场伪装成真实淘汰赛结果；不能据此确定实际结束层或实际存活率。',
      '',
      '## 全AI：每层五个房间的最终房分（20人样本）',
      '',
      '|层|房间序号|玩家记录数|均值|P10|P25|中位数|P75|P90|P99|零分率|',
      '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ];
    for (let floor = 1; floor <= 7; floor++)
      for (let room = 1; room <= 5; room++) {
        const row = find('all_ai', floor, 'room', String(room), 'finalScore');
        lines.push(
          `|${floor}|${room}|${row.n}|${fmt(row.mean)}|${fmt(row.p10)}|${fmt(row.p25)}|${fmt(row.p50)}|${fmt(row.p75)}|${fmt(row.p90)}|${fmt(row.p99)}|${((row.zeroRate ?? 0) * 100).toFixed(1)}%|`,
        );
      }
    lines.push(
      '',
      '## 全AI：按层／房型房分',
      '',
      '|层|房型|记录数|均值|P25|中位数|P75|P90|',
      '|---|---|---:|---:|---:|---:|---:|---:|',
    );
    for (let floor = 1; floor <= 7; floor++)
      for (const kind of ['normal', 'treasure', 'shop', 'hidden', 'boss']) {
        const row = metrics.find(
          (row) =>
            row.policy === 'all_ai' &&
            row.floor === floor &&
            row.view === 'kind' &&
            row.key === kind &&
            row.scope === 'ai',
        )?.summary;
        if (row)
          lines.push(
            `|${floor}|${kind}|${row.n}|${fmt(row.mean)}|${fmt(row.p25)}|${fmt(row.p50)}|${fmt(row.p75)}|${fmt(row.p90)}|`,
          );
      }
    lines.push(
      '',
      '## 全AI：层末分数与兑换／继承',
      '',
      '|层|R均值|兑换均值|继承均值|S均值|S P10|S P15|S P20|S P25|S中位数|S P90|S最大值|',
      '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    );
    for (let floor = 1; floor <= 7; floor++) {
      const score = find('all_ai', floor, 'floor', 'all');
      lines.push(
        `|${floor}|${fmt(find('all_ai', floor, 'floor', 'all', 'roomScore').mean)}|${fmt(find('all_ai', floor, 'floor', 'all', 'exchangedScore').mean)}|${fmt(find('all_ai', floor, 'floor', 'all', 'inheritedScore').mean)}|${fmt(score.mean)}|${fmt(score.p10)}|${fmt(score.p15)}|${fmt(score.p20)}|${fmt(score.p25)}|${fmt(score.p50)}|${fmt(score.p90)}|${fmt(score.max)}|`,
      );
    }
    lines.push(
      '',
      '## 三条件与批次稳定性：AI层末S分位数',
      '',
      '|条件|层|P10|P25|中位数|各批次P10|各批次P25|',
      '|---|---|---:|---:|---:|---|---|',
    );
    for (const row of candidates)
      lines.push(
        `|${row.policy}|${row.floor}|${fmt(row.p10)}|${fmt(row.p25)}|${fmt(find(row.policy, row.floor, 'floor', 'all').p50)}|${row.batchP10.map(fmt).join(' / ')}|${row.batchP25.map(fmt).join(' / ')}|`,
      );
    lines.push(
      '',
      '## 当前250的全20人反事实扫描',
      '',
      '|条件|层|平均线下人数|最少补2后的平均人数|近似95%区间|需要补淘汰比例|至少6人线下比例|团灭比例|',
      '|---|---|---:|---:|---|---:|---:|---:|',
    );
    for (const row of cutSweep.filter((row) => row.cutLine === 250))
      lines.push(
        `|${row.policy}|${row.floor}|${fmt(row.below.mean)}|${fmt(row.virtualEliminations.mean)}|${row.virtualEliminations.ci95.map(fmt).join('—')}|${(row.minimumSupplementRate * 100).toFixed(1)}%|${(row.atLeast6BelowRate * 100).toFixed(1)}%|${(row.allBelowRate * 100).toFixed(1)}%|`,
      );
    lines.push(
      '',
      '## 全AI角色分布（层末S）',
      '',
      '|层|角色|人数记录|P10|P25|中位数|P90|',
      '|---|---|---:|---:|---:|---:|---:|',
    );
    for (let floor = 1; floor <= 7; floor++)
      for (const character of characterOrder) {
        const row = find('all_ai', floor, 'character', character);
        lines.push(
          `|${floor}|${character}|${row.n}|${fmt(row.p10)}|${fmt(row.p25)}|${fmt(row.p50)}|${fmt(row.p90)}|`,
        );
      }
    lines.push(
      '',
      '## 初步范围的解释',
      '',
      '若候选目标是每层大约10%—25%的全20人线下，先用各层S的P10—P25作为统计搜索区间，P15—P20作为中间档；这里是参数搜索目标，不是用户确认的新赛制。最终要用真实淘汰重新验证。',
      '不要用房间均值直接设斩杀线：房型倍率、库存累乘、心脏追溯及极端高分使均值偏斜；层末淘汰必须比较包含兑换和继承的S，而不是单房分数或累计总分。',
      '不淘汰保留低分者、20人市场和全量构筑，真实淘汰会改变参与人数、奖励名额、偷钱邻居、AI公开排名与资产分布，后续层不能直接照搬这些分位数。',
      '',
      '正式入口250未改动；本报告仅研究文件，不导出为续玩存档或比赛事实回放。完整100—5000扫描及所有汇总数据保存在同目录report.json。',
    );
    writeFileSync(resolve(folder, 'report.md'), lines.join('\n') + '\n');
    console.log(`NO_ELIMINATION_REPORT=${jsonPath}`);
    console.log(
      JSON.stringify({
        counts: report.counts,
        candidates: candidates.filter((row) => row.policy === 'all_ai'),
      }),
    );
  },
  900_000,
);
