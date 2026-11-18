import { statusLabel } from '../editor-state';
import type { AppState } from '../types';
import { Kbd } from './ui/kbd';

export function StatusCard({ state }: { state: AppState | null }) {
  return <div id="status-card" className="grid gap-1.5 rounded-lg border bg-card p-3 text-xs" aria-live="polite">{state ? <>
    <strong className="flex items-center gap-2 text-xs font-semibold"><span className={`inline-block size-2 flex-none rounded-full ${state.settings.enabled && state.runtime.hookReady ? 'bg-success' : 'bg-muted-foreground/50'}`} />{statusLabel(state.settings, state.runtime)}</strong>
    <span className="text-muted-foreground">Бічна кнопка {state.settings.triggerButton}</span><Kbd className="w-fit">Ctrl + Space</Kbd>
  </> : 'Завантаження…'}</div>;
}
