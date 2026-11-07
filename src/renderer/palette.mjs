import {icon} from './icons.mjs';
import {escapeHTML as e} from './wheel.mjs';

// Ctrl+K: one search box over every action, page and command, operated entirely from the keyboard.
// entries: [{id, title, subtitle, iconHTML, section, run(alt)}]
let current=null;
export const paletteOpen=()=>!!current;
export function closePalette(){current?.close();}

function score(entry,query){
  if(!query)return 1;
  const title=entry.title.toLowerCase(),rest=(entry.subtitle||'').toLowerCase()+' '+(entry.keywords||'').toLowerCase();
  if(title.startsWith(query))return 4;
  if(title.split(/[\s/—-]+/).some(word=>word.startsWith(query)))return 3;
  if(title.includes(query))return 2;
  return rest.includes(query)?1:0;
}

export function openPalette(entries,{placeholder='Знайти дію або команду…',onClose}={}){
  closePalette();
  const previousFocus=document.activeElement;
  const host=document.createElement('div');
  host.className='palette-backdrop';
  host.innerHTML=`<section class="palette" role="dialog" aria-modal="true" aria-label="Командна палітра"><div class="palette-search">${icon('search',17)}<input id="palette-input" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" placeholder="${e(placeholder)}" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div><div class="palette-list" id="palette-list" role="listbox"></div><footer class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> вибір</span><span><kbd>Enter</kbd> виконати</span><span><kbd>Shift Enter</kbd> редагувати дію</span></footer></section>`;
  document.body.append(host);
  const input=host.querySelector('input'),list=host.querySelector('.palette-list');
  let visible=[],active=0;
  const order=new Map();entries.forEach(entry=>{if(!order.has(entry.section))order.set(entry.section,order.size);});
  function draw(){
    const query=input.value.trim().toLowerCase();
    // Sections keep their order; within a section the best matches come first.
    visible=entries.map(entry=>({entry,score:score(entry,query),section:order.get(entry.section)})).filter(row=>row.score>0).sort((a,b)=>a.section-b.section||b.score-a.score).slice(0,60).map(row=>row.entry);
    active=Math.min(active,Math.max(0,visible.length-1));
    let section='';
    list.innerHTML=visible.length?visible.map((entry,index)=>{
      const heading=entry.section!==section?`<div class="palette-section">${e(section=entry.section)}</div>`:'';
      return `${heading}<div class="palette-item ${index===active?'active':''}" role="option" id="palette-${index}" aria-selected="${index===active}" data-index="${index}"><span class="palette-icon">${entry.iconHTML||''}</span><span class="palette-copy"><strong>${e(entry.title)}</strong>${entry.subtitle?`<small>${e(entry.subtitle)}</small>`:''}</span>${entry.hint?`<span class="palette-hint">${e(entry.hint)}</span>`:''}</div>`;
    }).join(''):`<div class="palette-empty">Нічого не знайдено</div>`;
    input.setAttribute('aria-activedescendant',visible.length?`palette-${active}`:'');
    list.querySelector('.palette-item.active')?.scrollIntoView({block:'nearest'});
    window.orbitHydrateIcons?.(list);
  }
  function move(delta){if(!visible.length)return;active=(active+delta+visible.length)%visible.length;draw();}
  function run(index,alt=false){const entry=visible[index];if(!entry)return;close();entry.run(alt);}
  function close(){if(!current)return;current=null;host.remove();onClose?.();if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});}
  input.addEventListener('input',()=>{active=0;draw();});
  host.addEventListener('keydown',event=>{
    if(event.key==='ArrowDown'){event.preventDefault();move(1);}
    else if(event.key==='ArrowUp'){event.preventDefault();move(-1);}
    else if(event.key==='Enter'){event.preventDefault();run(active,event.shiftKey);}
    else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
    else if(event.key==='Tab'){event.preventDefault();}
  });
  host.addEventListener('mousemove',event=>{const item=event.target.closest('.palette-item');if(item&&Number(item.dataset.index)!==active){active=Number(item.dataset.index);list.querySelectorAll('.palette-item').forEach(node=>{const on=Number(node.dataset.index)===active;node.classList.toggle('active',on);node.setAttribute('aria-selected',String(on));});}});
  host.addEventListener('click',event=>{const item=event.target.closest('.palette-item');if(item)run(Number(item.dataset.index),event.shiftKey);else if(event.target===host)close();});
  current={close};
  draw();input.focus();
  return close;
}
