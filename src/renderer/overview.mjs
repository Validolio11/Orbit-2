import {icon,itemIcon} from './icons.mjs';
import {escapeHTML as e} from './wheel.mjs';

// The Overview page: real local launch counts only, never sample numbers.
const pad=value=>String(value).padStart(2,'0');
export const dayKey=date=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
const plural=(count,one,few,many)=>count%10===1&&count%100!==11?one:[2,3,4].includes(count%10)&&![12,13,14].includes(count%100)?few:many;
const weekday=date=>['Нд','Пн','Вт','Ср','Чт','Пт','Сб'][date.getDay()];

function relative(iso){
  if(!iso)return '';
  const minutes=Math.round((Date.now()-Date.parse(iso))/60000);
  if(minutes<1)return 'щойно';if(minutes<60)return `${minutes} хв тому`;
  const hours=Math.round(minutes/60);if(hours<24)return `${hours} год тому`;
  const days=Math.round(hours/24);return days===1?'учора':`${days} ${plural(days,'день','дні','днів')} тому`;
}

export function overviewPage({state,usage,runtime,entries,kinds}){
  const days=usage?.days||{},actions=usage?.actions||{},today=new Date();
  const series=Array.from({length:14},(_,index)=>{const date=new Date(today);date.setDate(today.getDate()-13+index);return {date,count:days[dayKey(date)]||0};});
  const week=series.slice(-7).reduce((sum,day)=>sum+day.count,0),todayCount=series.at(-1).count;
  const total=Object.values(actions).reduce((sum,entry)=>sum+entry.count,0);
  const known=new Map(entries.filter(({item})=>item.kind!=='group').map(entry=>[entry.item.id,entry]));
  const ranked=Object.entries(actions).filter(([id])=>known.has(id)).sort((a,b)=>b[1].count-a[1].count).slice(0,6);
  const recent=Object.entries(actions).filter(([id,entry])=>known.has(id)&&entry.last).sort((a,b)=>b[1].last.localeCompare(a[1].last)).slice(0,5);
  const max=Math.max(1,...series.map(day=>day.count));
  const actionCount=entries.filter(({item})=>item.kind!=='group').length;
  const stat=(label,value,hint,ic)=>`<div class="stat-card"><div class="stat-top"><span>${label}</span>${icon(ic,15)}</div><strong>${value}</strong><small>${hint}</small></div>`;
  const row=([id,entry],index,mode)=>{const {item,menu,path}=known.get(id);return `<div class="overview-row">${mode==='top'?`<span class="overview-rank">${index+1}</span>`:''}<span class="action-icon">${itemIcon(item,18)}</span><div class="action-copy"><div class="action-name">${e(item.name)}</div><div class="action-desc">${e([menu.name,...path].join(' / '))} · ${kinds[item.kind]}</div></div><span class="overview-count">${mode==='top'?`${entry.count}×`:e(relative(entry.last))}</span><button class="icon-btn" data-run-id="${e(id)}" aria-label="Запустити ${e(item.name)}" title="Запустити">${icon('play',13)}</button></div>`;};
  const empty=`<div class="empty-state compact">${icon('chart',24)}<strong>Ще немає запусків</strong><p>Відкрийте колесо й запустіть будь-яку дію — тут з’явиться ваша статистика. Дані зберігаються лише на цьому комп’ютері.</p></div>`;
  return `<div class="page-header"><div><h1>Огляд</h1><p>Як ви користуєтеся колесом: найпопулярніші дії та активність за два тижні.</p></div><div class="header-actions"><button class="btn" data-command="palette">${icon('command',14)}Пошук дій<kbd>Ctrl K</kbd></button><button class="btn primary" data-command="preview">${icon('play',14)}Викликати колесо</button></div></div>
  <div class="stat-grid">${stat('Сьогодні',todayCount,plural(todayCount,'запуск','запуски','запусків'),'zap')}${stat('За 7 днів',week,`у середньому ${Math.round(week/7*10)/10} на день`,'chart')}${stat('Усього запусків',total,'з моменту встановлення','history')}${stat('Дій у меню',actionCount,`${state.menus.length} ${plural(state.menus.length,'меню','меню','меню')}`,'wheel')}</div>
  <div class="overview-grid">
    <section class="panel"><div class="panel-head"><h2>Активність</h2><span class="micro-label">14 днів</span></div><div class="activity-chart" role="img" aria-label="Запуски за останні 14 днів">${series.map(day=>`<div class="activity-day ${dayKey(day.date)===dayKey(today)?'today':''}" title="${day.date.toLocaleDateString('uk-UA')}: ${day.count}"><span class="activity-value">${day.count||''}</span><span class="activity-bar" style="--h:${day.count/max*100}%"></span><span class="activity-label">${weekday(day.date)}</span></div>`).join('')}</div></section>
    <section class="panel"><div class="panel-head"><h2>Найчастіше</h2><span class="micro-label">TOP ${ranked.length||''}</span></div><div class="overview-list">${ranked.length?ranked.map((entry,index)=>row(entry,index,'top')).join(''):empty}</div></section>
    <section class="panel"><div class="panel-head"><h2>Нещодавно</h2></div><div class="overview-list">${recent.length?recent.map((entry,index)=>row(entry,index,'recent')).join(''):`<div class="empty-state compact"><p>Останні запуски з’являться тут.</p></div>`}</div></section>
    <section class="panel tips-panel"><div class="panel-head"><h2>Поради</h2></div><ul class="tips">
      <li>${icon('command',15)}<span><kbd>Ctrl K</kbd> у вікні Orbit 2 — швидкий пошук і запуск будь-якої дії.</span></li>
      <li>${icon('keys',15)}<span>У відкритому колесі цифри <kbd>1</kbd>–<kbd>9</kbd> запускають дію за номером, а коліщатко миші гортає сектори.</span></li>
      <li>${icon('link',15)}<span>Прив’яжіть меню до програми — і над нею колесо одразу покаже потрібні дії.</span></li>
      <li>${icon('text',15)}<span>Дія «Текст» вставляє заготовлену фразу, «Клавіші» — натискає будь-яку комбінацію.</span></li>
      <li>${icon('mouse',15)}<span>Праве клацання в колесі повертає на рівень вище${runtime.shortcutRegistered?`, а <kbd>${e(String(state.hotkey).replace('Control','Ctrl'))}</kbd> відкриває його з клавіатури`:''}.</span></li>
    </ul></section>
  </div>`;
}
