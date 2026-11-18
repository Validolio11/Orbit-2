import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

export const fieldClass = 'h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20';
export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(fieldClass, 'w-full', className)} {...props} />;
}
