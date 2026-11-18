import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <kbd className={cn('inline-block rounded-sm border bg-secondary px-2 py-0.5 font-mono text-xs text-muted-foreground', className)} {...props} />;
}
