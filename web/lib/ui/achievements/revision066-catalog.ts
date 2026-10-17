import {
  revision065Catalog,
  revision065Categories,
  revision065Metadata,
} from './revision065-catalog';
const targets: Record<string, number> = { B18: 10, B19: 50, B24: 10, B25: 50 };
export const revision066Catalog = revision065Catalog.map((a) => ({
  ...a,
  target: targets[a.id] ?? a.target,
  ...(a.id === 'D06'
    ? {
        condition:
          '正常竞拍名义报价等于行动前全部正金额可用资金，且折扣后的实际扣款至少达到本层角色初始资金的50%；退款不撤销已发生的扣款，不要求获奖。',
      }
    : {}),
}));
export const revision066Categories = revision065Categories;
export const revision066Metadata = new Map(revision065Metadata);
revision066Metadata.set('B12', { tier: 'bronze', hidden: true });
revision066Metadata.set('B13', { tier: 'silver', hidden: true });
