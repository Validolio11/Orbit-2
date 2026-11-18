import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { errorMessage, getState, invoke, openWheelPreview, windowCommand } from './api';
import { activeMenu, addAction, flattenActions, moveAction, moveOut, removeAction, updateAction } from './editor-state';
import { useAppState } from './useAppState';
import type { AppEvent, Page, Settings } from './types';
import type { PageProps } from './components/types';
import { Button } from './components/Facet';
import { TitleBar } from './components/TitleBar';
import { NavCapsule } from './components/NavCapsule';
import { StatusCard } from './components/StatusCard';
import { Toasts, useToasts } from './components/Toasts';
import { EditorDialog, type DialogRequest } from './components/EditorDialog';
import { ActionDialog, type ActionDialogRequest } from './components/ActionDialog';
import { MenusPage } from './components/MenusPage';
import { ActionsPage } from './components/ActionsPage';
import { ControlsPage } from './components/ControlsPage';
import { SettingsPage } from './components/SettingsPage';

export default function App() {
  const [page, setPage] = useState<Page>('menus'), [selected, setSelected] = useState<string | null>(null), [search, setSearch] = useState('');
  const [busy, setBusy] = useState({ adminBusy: false, dataBusy: false, updateBusy: false });
  const busyRef = useRef(busy); busyRef.current = busy;
  const [dialog, setDialog] = useState<DialogRequest | null>(null), [actionDialog, setActionDialog] = useState<ActionDialogRequest | null>(null);
  const workspace = useRef<HTMLElement>(null), focusPage = useRef(false);
  const { toast } = useToasts();
  const onPage = useCallback((next: Page) => { focusPage.current = true; setSelected(null); setPage(next); }, []);
  const onEvent = useCallback((event: AppEvent) => {
    switch (event.type) {
      case 'toast': toast(event.message, event.error); break;
      case 'notice': toast(`${event.title}\n${event.body}`, true, true); break;
      case 'actionError': toast(event.error, true); break;
      case 'navigate': onPage('menus'); if (event.add) setActionDialog({ mode: 'add' }); break;
    }
  }, [toast, onPage]);
  const { snapshot, error, store, retry } = useAppState(onEvent);
  const patch = (next: Partial<Settings>) => { void store.patch(next); };
  const run = async (action: () => Promise<unknown>) => { try { await action(); } catch (failure) { toast(errorMessage(failure), true); } };
  useLayoutEffect(() => {
    if (focusPage.current) {
      focusPage.current = false;
      workspace.current!.scrollTop = 0; workspace.current!.focus({ preventScroll: true });
    }
  });
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const settings = snapshot?.settings;
      document.documentElement.dataset.theme = settings?.theme === 'light' || (settings?.theme === 'system' && media.matches) ? 'light' : 'dark';
      document.documentElement.dataset.reducedMotion = String(Boolean(settings?.reducedMotion));
    };
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [snapshot?.settings.theme, snapshot?.settings.reducedMotion]);
  const setBusyFlag = (key: keyof typeof busy, value: boolean) => {
    busyRef.current = { ...busyRef.current, [key]: value };
    setBusy(busyRef.current);
  };
  const onCommand: PageProps['onCommand'] = (command, id) => {
    if (!snapshot) return;
    if (command === 'preview') { void run(openWheelPreview); return; }
    if (command === 'create-menu') { if (snapshot.settings.menus.length < 20) setDialog({ type: 'create' }); return; }
    if (command === 'delete-action') {
      const entry = flattenActions(snapshot.settings).find(({ action }) => action.id === id);
      if (entry) setDialog({ type: 'delete', entry });
      return;
    }
    if (command === 'add-action') {
      if ((activeMenu(snapshot.settings)?.items.length ?? 0) >= 12) toast('У меню може бути до 12 дій.', true); else setActionDialog({ mode: 'add' });
      return;
    }
    if (command === 'edit-action') {
      const entry = flattenActions(snapshot.settings).find(({ action }) => action.id === id);
      if (entry) setActionDialog({ mode: 'edit', entry });
      return;
    }
    if (command === 'move-up' || command === 'move-down' || command === 'move-out') {
      const menus = command === 'move-out' ? moveOut(snapshot.settings, id!) : moveAction(snapshot.settings, id!, command === 'move-up' ? -1 : 1);
      if (menus) patch({ menus }); else if (command === 'move-out') toast('На рівні вище немає місця.', true);
      return;
    }
    if (command === 'admin') {
      if (busyRef.current.adminBusy) return;
      const enabled = !snapshot.runtime.admin.enabled;
      setBusyFlag('adminBusy', true);
      void run(async () => { try { await invoke('set_admin', { enabled }); store.receive(await getState()); } finally { setBusyFlag('adminBusy', false); } });
      return;
    }
    if (command === 'export' || command === 'import') {
      if (busyRef.current.dataBusy) return;
      if (store.busy) { toast('Дочекайтеся збереження змін.'); return; }
      setBusyFlag('dataBusy', true);
      void run(async () => {
        try {
          const result = await invoke(command === 'export' ? 'export_settings' : 'import_settings');
          if (result) { store.receive(await getState()); toast(command === 'export' ? 'Налаштування експортовано' : 'Налаштування імпортовано'); }
        } finally { setBusyFlag('dataBusy', false); }
      });
      return;
    }
    if (busyRef.current.updateBusy) return;
    const native = { 'check-update': 'check_update', 'download-update': 'download_update', 'install-update': 'install_update' } as const;
    setBusyFlag('updateBusy', true);
    void run(async () => { try { await invoke(native[command]); store.receive(await getState()); } finally { setBusyFlag('updateBusy', false); } });
  };
  const props: PageProps | null = snapshot ? {
    state: snapshot, ui: { selected, search, ...busy }, onPage, onSelect: setSelected, onSearch: setSearch,
    onPatch: patch, onActivateMenu: (id) => { setSelected(null); patch({ activeMenuId: id }); }, onCommand,
  } : null;
  const pages = { menus: MenusPage, library: ActionsPage, controls: ControlsPage, settings: SettingsPage }, Content = pages[page];
  return <>
    <TitleBar onCommand={(action) => { void run(() => windowCommand(action)); }} />
    <div className="grid h-[calc(100%-48px)] grid-cols-[12rem_minmax(0,1fr)] max-[1150px]:grid-cols-[11rem_minmax(0,1fr)]"><aside className="flex flex-col gap-6 pt-6 pr-3 pb-4 pl-4 max-[1150px]:pl-3"><NavCapsule page={page} onPage={onPage} />
      <div className="mt-auto"><StatusCard state={snapshot} /></div>
    </aside><main ref={workspace} id="workspace" className="min-w-0 overflow-y-auto px-8 pt-8 pb-7 outline-none max-[1150px]:px-6 max-[1150px]:pt-7 [scrollbar-color:var(--input)_transparent]" tabIndex={-1} aria-labelledby="page-title">
      {error ? <div className="pt-9"><h1 id="page-title" className="text-3xl font-semibold tracking-tight">Не вдалося завантажити Orbit</h1><p className="my-3 text-destructive">{error}</p><Button data-action="retry" onClick={() => { void retry(); }}>Спробувати ще раз</Button></div>
        : props ? <Content {...props} /> : <div className="pt-9"><h1 id="page-title" className="text-3xl font-semibold tracking-tight">Завантаження Orbit…</h1><p className="my-3 text-muted-foreground">Читаємо збережені меню та налаштування.</p></div>}
    </main></div>
    <Toasts />
    <ActionDialog request={actionDialog} onClose={() => setActionDialog(null)} onSubmit={(fields, existing) => {
      const settings = store.view()?.settings, menu = activeMenu(settings);
      if (!settings || !menu) return false;
      const menus = existing ? updateAction(settings, existing.id, fields) : addAction(settings, menu.id, { id: crypto.randomUUID(), icon: '', children: [], ...fields });
      if (!menus) { toast('У меню може бути до 12 дій.', true); return false; }
      patch({ menus }); return true;
    }} />
    <EditorDialog request={dialog} onClose={() => setDialog(null)} onCreate={(name) => {
      const settings = store.view()?.settings;
      if (!settings) return false;
      if (settings.menus.length >= 20) { toast('Можна створити до 20 меню.', true); return false; }
      const menu = { id: crypto.randomUUID(), name, icon: 'orbit', items: [] };
      patch({ menus: [...settings.menus, menu], activeMenuId: menu.id }); return true;
    }} onDelete={(id) => { const settings = store.view()?.settings; if (settings) { setSelected(null); patch({ menus: removeAction(settings, id) }); } }} />
  </>;
}
