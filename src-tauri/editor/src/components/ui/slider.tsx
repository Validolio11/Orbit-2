import { Slider as SliderPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

export function Slider({ className, value, defaultValue, 'aria-label': label, ...props }: ComponentProps<typeof SliderPrimitive.Root>) {
  const thumbs = Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [0];
  return (
    <SliderPrimitive.Root value={value} defaultValue={defaultValue} className={cn('relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50', className)} {...props}>
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
        <SliderPrimitive.Range className="absolute h-full bg-brand" />
      </SliderPrimitive.Track>
      {thumbs.map((_, index) => <SliderPrimitive.Thumb key={index} aria-label={label} className="block size-4 shrink-0 rounded-full border border-brand bg-background shadow-sm ring-ring/50 transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50" />)}
    </SliderPrimitive.Root>
  );
}