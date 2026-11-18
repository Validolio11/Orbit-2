import { useRef } from 'react';
import type { ActionEntry } from '../types';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';

export type DialogRequest = { type: 'create' } | { type: 'delete'; entry: ActionEntry };
export function EditorDialog({ request, onClose, onCreate, onDelete }: {
  request: DialogRequest | null; onClose: () => void;
  onCreate: (name: string) => boolean; onDelete: (id: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <Dialog open={request !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent id="editor-dialog" aria-describedby={undefined}>
      {request && <form onSubmit={(event) => {
        event.preventDefault();
        if (request.type === 'delete') { onDelete(request.entry.action.id); onClose(); return; }
        const name = input.current!.value.trim();
        if (!name) { input.current!.setCustomValidity('Введіть назву меню.'); input.current!.reportValidity(); return; }
        if (onCreate(name)) onClose();
      }}>
        <DialogHeader>
          <DialogTitle id="dialog-title">{request.type === 'create' ? 'Створити меню' : 'Видалити дію?'}</DialogTitle>
          {request.type === 'delete' && <DialogDescription>{request.entry.action.name} · буде видалено з меню «{request.entry.menu.name}»{request.entry.action.kind === 'group' ? ` разом із вкладеними діями (${request.entry.action.children.length})` : ''}.</DialogDescription>}
        </DialogHeader>
        {request.type === 'create' && <div className="mt-4 grid gap-2"><Label htmlFor="menu-name">Назва меню</Label><Input ref={input} id="menu-name" name="name" maxLength={80} required autoFocus placeholder="Нове меню" onInput={() => input.current!.setCustomValidity('')} /></div>}
        <DialogFooter className="mt-5">
          <Button type="button" onClick={onClose}>Скасувати</Button>
          <Button type="submit" variant={request.type === 'create' ? 'default' : 'destructive'}>{request.type === 'create' ? 'Створити меню' : 'Видалити'}</Button>
        </DialogFooter>
      </form>}
    </DialogContent>
  </Dialog>;
}