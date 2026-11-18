import type { AppState, Page, Settings } from '../types';

export type PageCommand = 'preview' | 'create-menu' | 'delete-action' | 'add-action' | 'edit-action' | 'move-up' | 'move-down' | 'move-out' | 'export' | 'import' | 'check-update' | 'download-update' | 'install-update' | 'admin';
export interface PageUI {
  selected: string | null;
  search: string;
  adminBusy: boolean;
  dataBusy: boolean;
  updateBusy: boolean;
}
export interface PageProps {
  state: AppState;
  ui: PageUI;
  onPage: (page: Page) => void;
  onSelect: (id: string) => void;
  onSearch: (query: string) => void;
  onPatch: (patch: Partial<Settings>) => void;
  onActivateMenu: (id: string) => void;
  onCommand: (command: PageCommand, id?: string) => void;
}
