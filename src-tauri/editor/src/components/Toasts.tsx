import { useCallback } from 'react';
import { toast as sonner } from 'sonner';
import { Toaster } from './ui/sonner';

export function useToasts() {
  const toast = useCallback((message: string, error = false, persistent = false) => {
    const options = { duration: persistent ? Infinity : error ? 10000 : 5000 };
    if (error) sonner.error(message, options); else sonner(message, options);
  }, []);
  return { toast };
}
export function Toasts() {
  return <Toaster position="bottom-right" closeButton />;
}