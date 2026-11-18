import { useRef, useState } from 'react';
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
  const [error, setError] = useState('');
  const close = () => { setError(''); onClose(); };
  return <Dialog open={request !== null} onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent id="editor-dialog">
      {request && <form onSubmit={(event) => {
        event.preventDefault();
        if (request.type === 'delete') { onDelete(request.entry.action.id); close(); return; }
        const name = input.current!.value.trim();
        // Inline error in the dialog's own style instead of the browser's validation bubble.
        if (!name) { setError('Введіть назву меню.'); input.current!.focus(); return; }
        if (onCreate(name)) close();
      }} noValidate className="grid gap-4">
        <DialogHeader>
          <DialogTitle>{request.type === 'create' ? 'Створити меню' : 'Видалити дію?'}</DialogTitle>
          {request.type === 'create' && <DialogDescription>Нове меню з’явиться окремою вкладкою, і його можна вибрати колесом прокрутки.</DialogDescription>}
          {request.type === 'delete' && <DialogDescription>{request.entry.action.name} · буде видалено з меню «{request.entry.menu.name}»{request.entry.action.kind === 'group' ? ` разом із вкладеними діями (${request.entry.action.children.length})` : ''}.</DialogDescription>}
        </DialogHeader>
        {request.type === 'create' && <div className="grid gap-2"><Label htmlFor="menu-name">Назва меню</Label><Input ref={input} id="menu-name" name="name" maxLength={80} required autoFocus placeholder="Нове меню" aria-invalid={!!error || undefined} aria-describedby={error ? 'menu-name-error' : undefined} onInput={() => setError('')} />
          {error && <p id="menu-name-error" role="alert" className="text-sm text-destructive">{error}</p>}</div>}
        <DialogFooter className="mt-1">
          <Button type="button" onClick={close}>Скасувати</Button>
          <Button type="submit" variant={request.type === 'create' ? 'default' : 'destructive'}>{request.type === 'create' ? 'Створити меню' : 'Видалити'}</Button>
        </DialogFooter>
      </form>}
    </DialogContent>
  </Dialog>;
}