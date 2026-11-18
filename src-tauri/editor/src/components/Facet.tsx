import type { HTMLAttributes, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { Settings } from '../types';
import { cn } from '../lib/utils';
import { Icon } from './icons';
import { Button as UiButton, type ButtonProps as UiButtonProps } from './ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Label } from './ui/label';
import { Select as UiSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Slider as UiSlider } from './ui/slider';
import { Switch } from './ui/switch';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
export { Icon } from './icons';

type ButtonProps = UiButtonProps & { glyph?: string };
export function Button({ children, glyph, title, ...props }: ButtonProps) {
  return <UiButton title={title ?? (typeof children === 'string' ? children : undefined)} {...props}>{glyph && <Icon name={glyph} />}{children}</UiButton>;
}
export function Header({ title, note, children }: { title: string; note: string; children?: ReactNode }) {
  return <header className="mb-6 flex items-center justify-between gap-5 max-[1150px]:items-start"><div><h1 id="page-title" className="text-3xl leading-tight font-semibold tracking-tight">{title}</h1><p className="mt-2 text-sm text-muted-foreground">{note}</p></div><div className="flex flex-wrap items-center gap-2 max-[1150px]:max-w-72 max-[1150px]:justify-end">{children}</div></header>;
}
/** A shadcn Card whose rows run edge to edge: no card padding or gap, rows carry their own `px-6` and hairlines. */
export function Panel({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const labelled = props['aria-label'] !== undefined || props['aria-labelledby'] !== undefined;
  return <Card role={labelled ? 'region' : undefined} className={cn('min-w-0 gap-0 overflow-hidden py-0', className)} {...props}>{children}</Card>;
}
export function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return <Panel className="mb-5"><CardHeader className="pt-6 pb-4"><CardTitle role="heading" aria-level={2}>{title}</CardTitle><CardDescription className="text-xs">{note}</CardDescription></CardHeader>{children}</Panel>;
}
export function SettingRow({ id, label, note, children }: { id: string; label: string; note: string; children: ReactNode }) {
  return <div className="flex items-center justify-between gap-6 border-t px-6 py-4 max-[900px]:flex-wrap"><div className="min-w-0 flex-1"><Label id={`label-${id}`} htmlFor={id} className="text-sm">{label}</Label><p id={`note-${id}`} className="mt-1 max-w-xl text-xs text-muted-foreground">{note}</p></div><div className="flex max-w-1/2 flex-none items-center max-[900px]:max-w-full">{children}</div></div>;
}
export function Toggle({ id, label, checked, disabled = false, onChange }: { id: string; label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <Switch id={id} data-focus={id} data-toggle={id} aria-label={label} aria-describedby={`note-${id}`} checked={checked} disabled={disabled} onCheckedChange={onChange} />;
}
export function Select<T extends string | number>({ id, value, options, onChange }: { id: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void }) {
  return <UiSelect value={String(value)} onValueChange={(next) => { const option = options.find(([key]) => String(key) === next); if (option) onChange(option[0]); }}>
    <SelectTrigger id={id} data-focus={id} data-setting={id} aria-describedby={`note-${id}`} className="w-52 max-w-full"><SelectValue /></SelectTrigger>
    <SelectContent>{options.map(([key, label]) => <SelectItem key={key} value={String(key)}>{label}</SelectItem>)}</SelectContent>
  </UiSelect>;
}
export function Segmented<T extends string>({ label, value, options, onChange, prefix = '' }: { label: string; value: T; options: readonly { value: T; label: string; glyph?: string }[]; onChange: (value: T) => void; prefix?: string }) {
  return <ToggleGroup type="single" aria-label={label} value={value} onValueChange={(next) => { if (next) onChange(next as T); }}>{options.map((option) =>
    <ToggleGroupItem key={option.value} value={option.value} className="flex-1" data-focus={`${prefix}-${option.value}`} data-theme={option.value} aria-label={option.label} title={option.label}>{option.glyph && <Icon name={option.glyph} />}<span>{option.label}</span></ToggleGroupItem>)}</ToggleGroup>;
}
export function ThemeControl({ theme, prefix = 'theme', onChange }: { theme: Settings['theme']; prefix?: string; onChange: (theme: Settings['theme']) => void }) {
  return <Segmented label="Тема" value={theme} prefix={prefix} onChange={onChange} options={[{ value: 'light', label: 'Світла', glyph: 'sun' }, { value: 'dark', label: 'Темна', glyph: 'moon' }, { value: 'system', label: 'Системна', glyph: 'system' }]} />;
}
export function Slider({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <div className="mb-2 flex items-center gap-4"><UiSlider id={id} data-focus={id} aria-label={label} aria-describedby={`note-${id}`} className="w-48" min={60} max={150} step={5} value={[draft]} onValueChange={([next]) => setDraft(next)} onValueCommit={([next]) => onChange(next)} /><output id="size-value" htmlFor={id} className="w-10 font-mono text-xs">{draft}%</output></div>;
}
export function HexIcon({ kind, glyph }: { kind: string; glyph: string }) {
  return <span className={`action-icon kind-hexagon kind-${kind}`}><Icon name={glyph} /></span>;
}