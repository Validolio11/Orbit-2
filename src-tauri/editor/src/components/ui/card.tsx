import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn('min-w-0 overflow-hidden rounded-xl border bg-card text-card-foreground', className)} {...props} />;
}
export function CardHeader({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <header className={cn('flex min-h-14 items-center justify-between gap-3 px-6 py-4', className)} {...props} />;
}
export function CardFooter({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <p className={cn('border-t px-6 py-4 text-xs text-muted-foreground', className)} {...props} />;
}
