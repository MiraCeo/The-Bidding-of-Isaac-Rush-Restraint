'use client';

import { useMemo, useState } from 'react';
import { ArrowDownToLine, Coins, Gauge, Scale, ShieldAlert, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Group = 'A' | 'B';
type Intent = 'bid' | 'disrupt' | 'withdraw';

const rewards = {
  A: { name: '谨慎者的存钱罐', description: '保留余地，强化后续房间的资金规划。', tone: 'amber' },
  B: { name: '冲锋者的筹码', description: '承担风险，争取当前房间的主动权。', tone: 'red' },
} as const;

const actionCopy: Record<Intent, { title: string; description: string }> = {
  bid: { title: '正常竞拍', description: '进入最高价与合作区两条奖励路线。' },
  disrupt: { title: '扰乱市场', description: '放弃奖励资格，以更强权重影响共同市场。' },
  withdraw: { title: '退出房间', description: '不花费、不计分，为之后保存全部资金。' },
};

export function RoomPrototype() {
  const [group, setGroup] = useState<Group>('A');
  const [intent, setIntent] = useState<Intent>('bid');
  const [amount, setAmount] = useState(24);
  const maximum = intent === 'disrupt' ? 50 : 100;
  const effectiveAmount = Math.min(amount, maximum);
  const marketEquivalent = useMemo(
    () => (intent === 'disrupt' ? effectiveAmount * 2.5 : effectiveAmount),
    [effectiveAmount, intent],
  );

  function chooseIntent(nextIntent: Intent) {
    setIntent(nextIntent);
    if (nextIntent === 'disrupt' && amount > 50) setAmount(50);
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-[1480px] flex-col px-4 py-5 sm:px-7 lg:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <p className="eyebrow">THE BIDDING OF ISAAC</p>
            <h1 className="mt-1 text-2xl font-black tracking-[-0.04em] sm:text-3xl">以撒的竞合：冲 · 慎</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="status-chip"><Gauge aria-hidden="true" />第 1 层 · 房间 1/5</div>
            <div className="status-chip status-chip-money"><Coins aria-hidden="true" /><strong>100</strong></div>
          </div>
        </header>

        <section className="mt-6 grid flex-1 gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              {(Object.keys(rewards) as Group[]).map((rewardGroup) => {
                const reward = rewards[rewardGroup];
                const selected = group === rewardGroup && intent !== 'withdraw';
                return (
                  <button
                    key={rewardGroup}
                    type="button"
                    onClick={() => { setGroup(rewardGroup); if (intent === 'withdraw') setIntent('bid'); }}
                    className={`reward-card reward-${reward.tone} ${selected ? 'reward-selected' : ''}`}
                    aria-pressed={selected}
                  >
                    <span className="reward-letter">{rewardGroup}</span>
                    <span>
                      <span className="block text-lg font-extrabold">{reward.name}</span>
                      <span className="mt-1 block text-sm leading-6 text-muted-foreground">{reward.description}</span>
                    </span>
                    {selected && <span className="selected-label">已选择</span>}
                  </button>
                );
              })}
            </div>

            <Card className="market-card">
              <CardHeader className="border-b border-white/10">
                <CardTitle className="flex items-center gap-2 text-lg font-bold"><Scale aria-hidden="true" className="text-primary" />全房间共同市场</CardTitle>
                <CardDescription>A、B 两组共享同一条基准线；下方仅为界面示意，正式公式尚待接入。</CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="market-scale" aria-label="共同市场基准线示意图">
                  <div className="cooperation-zone" />
                  <div className="baseline" style={{ left: '52%' }}><span>共同基准线</span></div>
                  {[12, 23, 31, 38, 45, 58, 66, 74, 81, 89].map((position, index) => (
                    <span key={position} className={`bot-marker ${index % 2 ? 'bot-b' : 'bot-a'}`} style={{ left: `${position}%` }} title={`人机玩家 ${index + 1}`} />
                  ))}
                  {intent !== 'withdraw' && <span className="player-marker" style={{ left: `${Math.min(marketEquivalent, 100)}%` }}>你</span>}
                </div>
                <div className="mt-7 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>低投入</span>
                  <span className="flex items-center gap-2"><i className="legend-dot bg-[var(--group-a)]" /> A 组 <i className="legend-dot bg-[var(--group-b)]" /> B 组 <i className="legend-dot bg-primary" /> 你的市场位置</span>
                  <span>高投入</span>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rule-note"><Sparkles aria-hidden="true" /><span><strong>竞</strong>：以资金争取最高价奖励</span></div>
              <div className="rule-note"><Scale aria-hidden="true" /><span><strong>合</strong>：靠近共同基准线</span></div>
              <div className="rule-note"><ArrowDownToLine aria-hidden="true" /><span><strong>退</strong>：保存资金等待时机</span></div>
            </div>
          </div>

          <aside>
            <Card className="action-panel xl:sticky xl:top-6">
              <CardHeader>
                <p className="eyebrow">秘密行动</p>
                <CardTitle className="text-xl font-black">你准备怎么做？</CardTitle>
                <CardDescription>其余 19 名玩家也会同时提交，确认前不会公开。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-2">
                  {(Object.keys(actionCopy) as Intent[]).map((item) => (
                    <button type="button" key={item} onClick={() => chooseIntent(item)} className={`intent-button ${intent === item ? 'intent-selected' : ''}`} aria-pressed={intent === item}>
                      <span className="font-bold">{actionCopy[item].title}</span>
                      <span>{actionCopy[item].description}</span>
                    </button>
                  ))}
                </div>

                {intent !== 'withdraw' && (
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-end justify-between gap-4"><label htmlFor="bid-amount" className="text-sm font-bold">实际出价</label><output className="font-mono text-2xl font-black text-primary">{effectiveAmount}</output></div>
                    <input id="bid-amount" className="bid-slider mt-4" type="range" min="1" max={maximum} value={effectiveAmount} onChange={(event) => setAmount(Number(event.target.value))} />
                    <div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>1</span><span>{maximum} 上限</span></div>
                  </div>
                )}

                <div className="summary-box">
                  {intent === 'withdraw' ? (
                    <p>本轮不消耗资金、不获取积分，也不影响市场。</p>
                  ) : intent === 'disrupt' ? (
                    <>
                      <p className="flex items-center gap-2 font-bold text-[var(--warning)]"><ShieldAlert aria-hidden="true" />扰乱将放弃全部奖励资格</p>
                      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt>市场等价出价</dt><dd>{marketEquivalent}</dd></div><div><dt>计分等价出价</dt><dd>{effectiveAmount * 1.25}</dd></div></dl>
                    </>
                  ) : (
                    <p>你将以 <strong>{effectiveAmount}</strong> 竞拍奖励 {group}，并同时参与最高价与合作区判定。</p>
                  )}
                </div>

                <Button className="h-12 w-full text-base font-black" size="lg">锁定秘密行动</Button>
                <p className="text-center text-xs text-muted-foreground">原型界面 · 当前不会真正提交结算</p>
              </CardContent>
            </Card>
          </aside>
        </section>
      </div>
    </main>
  );
}
