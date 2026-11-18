import { useEffect, useRef, useState } from 'react';
import { errorMessage, getState, invoke, listen } from './api';
import { createSettingsStore } from './editor-state';
import type { AppEvent, AppState } from './types';

/** Subscribe before reading; serialize retained events and settings exactly as the native editor did. */
export function useAppState(onEvent: (event: AppEvent) => void) {
  const callback = useRef(onEvent);
  callback.current = onEvent;
  const active = useRef(false);
  const [snapshot, setSnapshot] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const retryRef = useRef<() => Promise<void>>(async () => {});
  const [store] = useState(() => createSettingsStore({
    save: (settings) => invoke('save_settings', { settings }), refresh: getState,
    changed: (next) => { if (active.current) setSnapshot(next); },
    failed: (failure) => { if (active.current) callback.current({ type: 'toast', message: errorMessage(failure), error: true }); },
  }));
  useEffect(() => {
    active.current = true;
    let disposed = false, initializing = false, noticesShown = false;
    let eventQueue = Promise.resolve();
    const subscriptions = new Map<string, Promise<void>>(), unlisteners: (() => void)[] = [];
    const report = (failure: unknown) => {
      if (!disposed) callback.current({ type: 'toast', message: errorMessage(failure), error: true });
    };
    async function subscribe<E extends Parameters<typeof listen>[0]>(name: E, handler: Parameters<typeof listen<E>>[1]) {
      if (!subscriptions.has(name)) {
        const pending = listen(name, handler).then((unlisten) => {
          if (disposed) unlisten(); else unlisteners.push(unlisten);
        }).catch((failure) => { subscriptions.delete(name); throw failure; });
        subscriptions.set(name, pending);
      }
      await subscriptions.get(name);
    }
    function drainEvents() {
      eventQueue = eventQueue.then(async () => {
        const events = await invoke('take_events');
        if (!disposed) for (const event of events) callback.current(event);
      }).catch(report);
      return eventQueue;
    }
    async function initialize() {
      if (disposed || initializing) return;
      initializing = true; setError(null);
      try {
        await subscribe('state:changed', (next) => { if (!disposed) store.receive(next); });
        if (disposed) return;
        await subscribe('update:changed', () => {
          void getState().then((next) => { if (!disposed) store.receive(next); }).catch(report);
        });
        if (disposed) return;
        await subscribe('app:event', () => { void drainEvents(); });
        if (disposed) return;
        const next = await getState();
        if (disposed) return;
        store.receive(next);
        if (!noticesShown) {
          noticesShown = true;
          for (const notice of store.view()?.notices || []) callback.current(notice);
        }
        await drainEvents();
      } catch (failure) {
        if (!disposed) { setError(errorMessage(failure)); report(failure); }
      } finally { initializing = false; }
    }
    retryRef.current = initialize;
    const dispose = () => {
      disposed = true; active.current = false;
      for (const unlisten of unlisteners.splice(0)) unlisten();
    };
    window.addEventListener('pagehide', dispose, { once: true });
    void initialize();
    return () => { dispose(); window.removeEventListener('pagehide', dispose); };
  }, [store]);
  return { snapshot, error, store, retry: () => retryRef.current() };
}
