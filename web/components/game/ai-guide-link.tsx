import type { AiGuideTarget } from '@/lib/ui/ai-guide-target';
import { useProgressNavigation } from './progress-navigation';

export function AiGuideLink({
  target,
  className,
  title,
  children,
}: {
  target: AiGuideTarget;
  className: string;
  title: string;
  children: string;
}) {
  const open = useProgressNavigation()?.openAiGuide;
  const props = {
    className,
    title,
    'data-ai-personality':
      target.kind === 'personality' ? target.id : undefined,
    'data-ai-doctrine': target.kind === 'doctrine' ? target.id : undefined,
  };
  return open ? (
    <button
      type="button"
      {...props}
      aria-label={`${children}：查看${target.kind === 'personality' ? '人格' : '流派'}说明`}
      onClick={() => open(target)}
    >
      {children}
    </button>
  ) : (
    <span {...props}>{children}</span>
  );
}
