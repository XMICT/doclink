import { Card } from 'fumadocs-ui/components/card';
import * as LucideIcons from 'lucide-react';
import type { ComponentProps } from 'react';
import type { LucideIcon } from 'lucide-react';

type CardProps = ComponentProps<typeof Card>;

export function CardWithIcon({
  icon,
  ...props
}: Omit<CardProps, 'icon'> & { icon?: string | CardProps['icon'] }) {
  let resolvedIcon = icon as CardProps['icon'];

  if (typeof icon === 'string') {
    const Icon = (LucideIcons as Record<string, unknown>)[icon] as LucideIcon | undefined;
    resolvedIcon = Icon ? <Icon /> : undefined;
  }

  return <Card icon={resolvedIcon} {...props} />;
}
