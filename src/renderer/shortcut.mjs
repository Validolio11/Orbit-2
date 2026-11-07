// Turns a pressed key combination into the text form that src/shortcuts.cjs sends to Windows.
const CODE_NAMES={Enter:'Enter',NumpadEnter:'Enter',Escape:'Esc',Tab:'Tab',Space:'Space',Backspace:'Backspace',Delete:'Delete',Insert:'Insert',Home:'Home',End:'End',
  PageUp:'PageUp',PageDown:'PageDown',ArrowUp:'Up',ArrowDown:'Down',ArrowLeft:'Left',ArrowRight:'Right',PrintScreen:'PrintScreen',Pause:'Pause',ContextMenu:'Menu',
  Minus:'-',Equal:'=',BracketLeft:'[',BracketRight:']',Semicolon:';',Quote:"'",Comma:',',Period:'.',Slash:'/',Backslash:'\\',Backquote:'`',
  NumpadMultiply:'Num*',NumpadAdd:'Num+',NumpadSubtract:'Num-',NumpadDecimal:'Num.',NumpadDivide:'Num/',
  AudioVolumeMute:'VolumeMute',AudioVolumeDown:'VolumeDown',AudioVolumeUp:'VolumeUp',MediaTrackNext:'MediaNext',MediaTrackPrevious:'MediaPrev',MediaStop:'MediaStop',MediaPlayPause:'MediaPlay'};
const MODIFIER_CODES=new Set(['ControlLeft','ControlRight','ShiftLeft','ShiftRight','AltLeft','AltRight','MetaLeft','MetaRight']);

export function keyName(code){
  if(/^Key[A-Z]$/.test(code))return code.slice(3);
  if(/^Digit\d$/.test(code))return code.slice(5);
  if(/^Numpad\d$/.test(code))return 'Num'+code.slice(6);
  if(/^F([1-9]|1\d|2[0-4])$/.test(code))return code;
  return CODE_NAMES[code]||null;
}

// Returns {text, complete}: complete is false while only modifiers are held.
export function shortcutFromEvent(event){
  const parts=[];
  if(event.ctrlKey)parts.push('Ctrl');if(event.shiftKey)parts.push('Shift');if(event.altKey)parts.push('Alt');if(event.metaKey)parts.push('Win');
  if(MODIFIER_CODES.has(event.code))return {text:parts.join('+'),complete:false};
  const name=keyName(event.code);
  if(!name)return null;
  return {text:[...parts,name].join('+'),complete:true};
}

// "Ctrl+Num+" -> ['Ctrl','Num+']: an empty piece means the "+" belonged to the key before it.
export function shortcutParts(text){
  const parts=[];
  for(const piece of String(text||'').split('+')){if(!piece&&parts.length)parts[parts.length-1]+='+';else parts.push(piece);}
  return parts.filter(Boolean);
}

export const SHORTCUT_PRESETS=[
  ['Копіювати','Ctrl+C','copy'],['Вставити','Ctrl+V','clipboard'],['Вирізати','Ctrl+X','copy'],['Скасувати','Ctrl+Z','undo'],['Повторити','Ctrl+Y','redo'],
  ['Виділити все','Ctrl+A','select'],['Зберегти','Ctrl+S','save'],['Знайти','Ctrl+F','search'],['Нова вкладка','Ctrl+T','plus'],['Закрити вкладку','Ctrl+W','close'],
  ['Відновити вкладку','Ctrl+Shift+T','history'],['Оновити','F5','refresh'],['Перемкнути вікно','Alt+Tab','windows'],['Друк','Ctrl+P','printer'],
];
