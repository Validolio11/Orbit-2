import type { CSSProperties } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

// The shadcn Sonner wrapper: colours come from the same tokens as every other component.
export function Toaster(props: ToasterProps) {
  return <Sonner className="toaster group" style={{ '--normal-bg': 'var(--popover)', '--normal-text': 'var(--foreground)', '--normal-border': 'var(--border)' } as CSSProperties} {...props} />;
}