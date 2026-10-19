/** Emphasis only: preserve every character of the authoritative description. */
export function ItemEffectText({ text }: { text: string }) {
  return text
    .split(
      /(\d+(?:\.\d+)?%(?:[～~至]\d+(?:\.\d+)?%)?|[一二三四五六七八九十]+分之[一二三四五六七八九十]+概率|一半概率)/g,
    )
    .map((part, index) =>
      index % 2 ? <strong key={index}>{part}</strong> : part,
    );
}
