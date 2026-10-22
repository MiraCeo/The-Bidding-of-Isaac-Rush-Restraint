import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { achievementCatalog } from './catalog';
import { achievementCollectionNotes } from './collection-notes';
import { achievementNumber } from './numbering';

it('gives every active stage explicit, non-template flavor without repeating goals', () => {
  const notes = achievementCatalog.map((a) => achievementCollectionNotes[a.id]);
  expect(notes).toHaveLength(117);
  expect(new Set(notes).size).toBe(117);
  for (const note of notes) {
    expect(note.length).toBeGreaterThan(3);
    expect(note.length).toBeLessThanOrEqual(60);
    expect(note).not.toMatch(/的这一页，(?:写到了|记下了)|目标值|次经历/);
  }
});

it('keeps retired copy separate and preserves distinctive existing lines', () => {
  expect(achievementCollectionNotes.A02).toBe(
    '你与失败已经熟得不需要自我介绍。',
  );
  expect(achievementCollectionNotes.A04).toBe(
    '跌倒的那一页后面，你又写下了一次收获。',
  );
  expect(achievementCatalog.some((a) => a.id === 'A02' || a.id === 'A04')).toBe(
    false,
  );
  expect(achievementCollectionNotes.C04).toBe('请签收这份本来属于你的空气。');
  expect(achievementCollectionNotes.E01).toBe('战术没有问题，骰子另有想法。');
  expect(achievementCollectionNotes.B02).toBe(
    '钱不是万能的，但这次确实挺好用。',
  );
});

it('does not describe cross-match roles as a single match or equate minimum survival with a narrow cutoff', () => {
  expect(achievementCollectionNotes.E08).toBe(
    '纸上的名字换过一轮，按下开始的还是你。',
  );
  expect(achievementCollectionNotes.C09).toContain('A、B都有空席');
  expect(achievementCollectionNotes.C09).not.toMatch(/两张|2张|所有奖品/);
  expect(achievementCollectionNotes.B12).not.toContain('总有');
  expect(achievementCollectionNotes.F12).toContain('幸存者末尾');
  expect(achievementCollectionNotes.F12).not.toMatch(/只差|1分/);
});

it('ties reviewed humor to the experience without adding strategy, balance or delivery prerequisites', () => {
  expect(achievementCollectionNotes.A09).toContain('拍卖槌');
  expect(achievementCollectionNotes.B16).toContain('你没出价');
  expect(achievementCollectionNotes.C09).not.toMatch(/各空了1席|占得很稳/);
  expect(achievementCollectionNotes.D21).toBe(
    '少付的那部分，听起来比奖品还悦耳。',
  );
  expect(achievementCollectionNotes.F16).toContain('淘汰名单');
  expect(achievementCollectionNotes.A13).not.toContain('空手的那一房');
  expect(achievementCollectionNotes.C12).toContain('落空的那笔报价');
  expect(achievementCollectionNotes.C03).toContain('领奖资格');
  expect(achievementCollectionNotes.C03).not.toContain('奖品塞给');
  expect(achievementCollectionNotes.C14).toContain('只管翻倍');
  expect(achievementCollectionNotes.C14).not.toContain('添上');
  expect(achievementCollectionNotes.C17).toContain('原本该在的位置');
  expect(achievementCollectionNotes.C17).not.toContain('空着的奖品栏');
  expect(achievementCollectionNotes.D11).not.toContain('一点一点');
  expect(achievementCollectionNotes.E07).toContain('独占不独占另说');
  expect(achievementCollectionNotes.E20).not.toContain('没商量成');
  expect(achievementCollectionNotes.E25).not.toContain('先确认');
});

it('adds item and character flavor to the right stable IDs without borrowing another achievement', () => {
  expect(achievementCollectionNotes.C17).toContain('嗝屁猫');
  expect(achievementCollectionNotes.D19).toBe('别急着谢运气，先看看是谁的脚。');
  expect(achievementCollectionNotes.D22).toBe(
    '地下室的商店不讲人情，幸好它偶尔打折。',
  );
  expect(achievementCollectionNotes.E16).toBe(
    '游魂又多了1层屏障。安心还得再等等。',
  );
  expect(achievementCollectionNotes.E19).toContain('兄弟俩');
  expect(achievementCollectionNotes.E20).toContain('雅阁和以扫');
  expect(achievementCollectionNotes.E21).toContain('永恒六面骰');
  expect(achievementCollectionNotes.E22).toContain('眼泪');
});

it('keeps all 117 review rows and main-catalog notes identical to actual stable-ID copy', () => {
  const review = readFileSync(
    new URL('../../../../docs/规划/0.8成就札记修改对照表.md', import.meta.url),
    'utf8',
  );
  const main = readFileSync(
    new URL('../../../../docs/规划/成就总表.md', import.meta.url),
    'utf8',
  ).split(/\n(?=### [A-F]\d+\r?\n)/);
  const rows = review
    .split(/\r?\n/)
    .filter((line) => /^\| [A-F]\d+ \|/.test(line));
  expect(rows).toHaveLength(117);
  expect(rows.filter((line) => line.includes('**重点修订**'))).toHaveLength(5);
  expect(rows.filter((line) => line.includes('**语义收敛**'))).toHaveLength(10);
  expect(rows.filter((line) => line.includes('| 沿用二轮 |'))).toHaveLength(
    102,
  );
  for (const a of achievementCatalog) {
    const number = achievementNumber(a.id);
    const matches = rows.filter((line) => line.startsWith(`| ${number} |`));
    expect(matches).toHaveLength(1);
    const columns = matches[0]!.split('|');
    expect(columns[2]!.trim()).toContain(`${a.name} · `);
    expect(columns[5]!.trim()).toBe(achievementCollectionNotes[a.id]);
    const section = main.find(
      (part) =>
        part.startsWith(`### ${number}\n`) ||
        part.startsWith(`### ${number}\r\n`),
    );
    expect(section).toBeDefined();
    expect(section!.match(/^- \*\*收藏札记\*\*：(.*)$/m)![1]!.trim()).toBe(
      achievementCollectionNotes[a.id],
    );
  }
});

it('keeps the second-round wording independently reviewable after semantic corrections', () => {
  const snapshot = readFileSync(
    new URL(
      '../../../../docs/记录/0.8第二轮成就札记检阅快照_20261020.md',
      import.meta.url,
    ),
    'utf8',
  );
  const rows = snapshot
    .split(/\r?\n/)
    .filter((line) => /^\| [A-F]\d+ \|/.test(line));
  expect(rows).toHaveLength(117);
  expect(rows.filter((line) => line.includes('**主题深化**'))).toHaveLength(49);
  expect(rows.filter((line) => line.includes('| 沿用首轮 |'))).toHaveLength(68);
});

it('keeps the first-round review available with its original 51-change scope', () => {
  const snapshot = readFileSync(
    new URL(
      '../../../../docs/记录/0.8首轮成就札记检阅快照_20261020.md',
      import.meta.url,
    ),
    'utf8',
  );
  const rows = snapshot
    .split(/\r?\n/)
    .filter((line) => /^\| [A-F]\d+ \|/.test(line));
  expect(rows).toHaveLength(117);
  expect(rows.filter((line) => line.includes('**模板重写**'))).toHaveLength(46);
  expect(rows.filter((line) => line.includes('**语义修订**'))).toHaveLength(5);
  expect(rows.filter((line) => line.includes('| 保留 |'))).toHaveLength(66);
});
