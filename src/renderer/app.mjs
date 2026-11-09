import {icon,itemIcon,rememberAppIcon,hydrateAppIcons,systemIcons} from './icons.mjs';
import {folderPickerFields,mountFolderPicker,folderName} from './folder-picker.mjs';
import {scriptPickerFields,mountScriptPicker,scriptName} from './script-picker.mjs';
import {groupPickerFields,mountGroupPicker} from './group-picker.mjs';
import {escapeHTML as e,renderWheel,sectorAt,setWheelCenter,armSector} from './wheel.mjs';
import {shortcutFromEvent,shortcutParts,SHORTCUT_PRESETS} from './shortcut.mjs';
import {overviewPage} from './overview.mjs';
import {openPalette,paletteOpen} from './palette.mjs';
import {appPickerFields,mountAppPicker} from './app-picker.mjs';
import {updatesSettings,refreshUpdates} from './updates.mjs';
import {bindActionDrag} from './action-drag.mjs';
import {bindWheelEditorDrag} from './wheel-editor-drag.mjs';
import {moveActionToGroup,moveActionToRoot,reorderAction,moveActionToParent} from './action-move.mjs';

const api=window.orbit;
const overlay=new URLSearchParams(location.search).has('overlay');
const root=document.querySelector('#app');
const kinds={app:'Застосунок',folder:'Папка',script:'Скрипт',system:'Windows',keys:'Клавіші',text:'Текст',group:'Група'};
const ACCENTS=[['blue','Синій'],['violet','Фіолетовий'],['green','Зелений'],['amber','Бурштиновий'],['rose','Рожевий'],['mono','Монохром']];
const HOTKEYS=[['Control+Space','Ctrl + Space'],['Control+Shift+Space','Ctrl + Shift + Space'],['Control+Alt+Space','Ctrl + Alt + Space'],['Alt+Shift+Space','Alt + Shift + Space'],['Control+`','Ctrl + `'],['','Вимкнено']];
const PAGES={menus:['wheel','Мої меню'],overview:['chart','Огляд'],library:['grid','Усі дії'],controls:['mouse','Керування'],settings:['settings','Налаштування']};
const systemNames={
  explorer:'Провідник','task-manager':'Диспетчер завдань',settings:'Параметри Windows','control-panel':'Панель керування','recycle-bin':'Кошик',
  search:'Пошук Windows',run:'Виконати','task-view':'Усі вікна',desktop:'Показати робочий стіл',lock:'Заблокувати комп’ютер',
  screenshot:'Знімок екрана',clipboard:'Буфер обміну',emoji:'Емодзі',dictation:'Голосове введення',notifications:'Сповіщення',
  mute:'Вимкнути / увімкнути звук','volume-down':'Зменшити гучність','volume-up':'Збільшити гучність','sound-settings':'Налаштування звуку',bluetooth:'Bluetooth',
  'media-prev':'Попередній трек','media-play':'Відтворення / пауза','media-next':'Наступний трек',calculator:'Калькулятор',notepad:'Блокнот',
  'close-window':'Закрити вікно','minimize-window':'Згорнути вікно','maximize-window':'Розгорнути вікно','desktop-prev':'Попередній робочий стіл','desktop-next':'Наступний робочий стіл',
};
const activationNames={release:'Відпускання кнопки',hover:'Наведення курсора',click:'Клацання мишею'};
const groupOpenNames={hover:'Наведення курсора',click:'Клацання мишею'};
let state,runtime={hookReady:false,hookError:null,shortcutRegistered:false},adminBusy=false;
let wheelForeground=null;
let updateStatus={phase:'idle',currentVersion:''};
let page='menus',selectedId='',groupPath=[],search='',toastTimer,modalPreviousFocus,modalCleanup;
let usage=null,libraryKind='all',librarySort='menu',overlayMenuId=null,wheelContext=false;
const usageCount=id=>usage?.actions?.[id]?.count||0;
const hotkeyLabel=()=>HOTKEYS.find(([value])=>value===(state.hotkey??'Control+Space'))?.[1]||'Ctrl + Space';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let wheelStack=[],wheelSelected=-1,wheelTrigger='preview',wheelTimer,groupTimer,wheelBusy=false,wheelOpen=false,mousePoint=null,transitionOrigin=null;
const uuid=()=>crypto.randomUUID();
const actionsWord=count=>count%10===1&&count%100!==11?'дію':[2,3,4].includes(count%10)&&![12,13,14].includes(count%100)?'дії':'дій';
// The overlay may show a menu linked to the program in front instead of the active one.
const currentMenu=()=>state.menus.find(m=>m.id===(overlay&&overlayMenuId||state.activeMenuId))||state.menus[0];
// validateAction allows four nested levels; a group's children must fit below the level it is created on.
const MAX_GROUP_DEPTH=4;
function groupHeight(item){return item.kind==='group'?1+Math.max(0,...item.children.map(groupHeight)):0;}
function trimGroupPath(){let items=currentMenu().items;const next=[];for(const id of groupPath){const group=items.find(item=>item.id===id&&item.kind==='group');if(!group)break;next.push(id);items=group.children;}groupPath=next;}
function currentGroup(){let value={items:currentMenu().items,name:currentMenu().name};for(const id of groupPath){const item=value.items.find(i=>i.id===id);if(!item||item.kind!=='group')break;value={...item,items:item.children};}return value;}
function locate(id){for(const menu of state.menus){const walk=(items,path=[])=>{for(let i=0;i<items.length;i++){if(items[i].id===id)return {item:items[i],items,index:i,menu,path};if(items[i].kind==='group'){const found=walk(items[i].children,[...path,items[i].id]);if(found)return found;}}};const found=walk(menu.items);if(found)return found;}return null;}
function flatten(){const result=[];for(const menu of state.menus){const walk=(items,path=[])=>items.forEach(item=>{result.push({item,menu,path});if(item.kind==='group')walk(item.children,[...path,item.name]);});walk(menu.items);}return result;}
async function openEditorGroup(id){
  const found=locate(id);if(!found||found.item.kind!=='group')return;
  if(state.activeMenuId!==found.menu.id&&!await change({activeMenuId:found.menu.id}))return;
  groupPath=[...found.path,found.item.id];page='menus';selectedId='';render();
}
async function activateEditorItem(id){
  const found=locate(id);if(!found)return;
  if(found.item.kind==='group'){await openEditorGroup(id);return;}
  selectedId=id;actionDialog(id);render();
}
function applyTheme(){const theme=state.theme==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):state.theme;document.documentElement.dataset.theme=theme;document.documentElement.dataset.reducedMotion=String(state.reducedMotion);document.documentElement.dataset.accent=state.accent||'blue';}
// Errors thrown in the main process arrive wrapped in Electron's "Error invoking remote method" prefix.
const cleanError=message=>String(message??'').replace(/^Error invoking remote method '[^']+': (Error: )?/,'');
function toast(message,error=false,action=null){
  const target=document.querySelector('#toast');clearTimeout(toastTimer);
  target.textContent=error?cleanError(message):message;
  if(action){const button=document.createElement('button');button.type='button';button.className='toast-action';button.textContent=action.label;button.onclick=()=>{clearTimeout(toastTimer);target.className='';action.run();};target.append(button);}
  target.className='visible'+(error?' error':'')+(action?' has-action':'');
  toastTimer=setTimeout(()=>target.className='',error?6000:action?8000:2500);
}
// Offers to put back the configuration that was in place before a destructive change.
function undoToast(message,previous){toast(message,false,{label:'Скасувати',run:async()=>{groupPath=[];await save(structuredClone(previous),'Відновлено');}});}
// Sequences are groups that run all their actions in order instead of opening.
const isSequence=item=>item?.kind==='group'&&item.target==='sequence';
const opensGroup=item=>item?.kind==='group'&&item.target!=='sequence';
async function save(next,message){try{state=await api.saveState(next);applyTheme();if(!overlay)render();if(message)toast(message);return true;}catch(error){toast(error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''),true);return false;}}
const change=(changes,message)=>save({...state,...changes},message);
const actionDrag=overlay?null:bindActionDrag(root,{
  getState:()=>state,
  onError:message=>toast(message,true),
  onMove:async(sourceId,targetId)=>{
    const target=locate(targetId)?.item,next=moveActionToGroup(state,sourceId,targetId),previous=selectedId;
    selectedId=targetId;
    if(await save(next,`Переміщено до «${target.name}»`)){
      [...root.querySelectorAll('.action-list [data-row-id]')].find(row=>row.dataset.rowId===targetId)?.focus({preventScroll:true});
    }else selectedId=previous;
  },
});
const wheelEditorDrag=overlay?null:bindWheelEditorDrag(root,{
  getItems:()=>currentGroup().items,
  parentDropError:()=>{
    if(!groupPath.length)return 'Уже в головному меню';
    const parentItems=groupPath.length===1?currentMenu().items:locate(groupPath.at(-2)).item.children;
    return parentItems.length>=12?'На попередньому рівні вже 12 дій':null;
  },
  onReorder:async(id,target)=>{await save(reorderAction(state,id,target),'Порядок змінено');},
  onMoveParent:async id=>{await save(moveActionToParent(state,id),'Переміщено на рівень вище');},
  onError:message=>toast(message,true),
});
function statusLabel(){return !state.enabled?'Призупинено':runtime.hookReady?'Orbit 2 активний':runtime.hookError?'Миша недоступна':'Запуск модуля миші…';}
// Windows asks for confirmation once; afterwards every start, including sign-in, runs with administrator rights.
function adminStartRow(){const admin=runtime.adminStart||{},on=admin.enabled===true;
  const note=!admin.available?'Доступно у встановленій версії Orbit 2 (не в режимі розробки) і лише для облікового запису адміністратора.':on?(admin.elevated?'Orbit 2 працює з правами адміністратора: бічна кнопка діє й у програмах, запущених від імені адміністратора.':'Перезапустіть Orbit 2, щоб застосувати права адміністратора.'):'Без цього бічна кнопка не працює у програмах, запущених від імені адміністратора. Windows попросить підтвердження один раз.';
  return `<div class="setting-row"><div class="setting-label"><strong>Запускати з правами адміністратора</strong><p>${e(note)}${on?' Програми з колеса теж відкриватимуться з цими правами, а файли з Провідника не перетягуватимуться у вікно Orbit 2.':''}</p></div><button class="toggle ${on?'on':''}" data-admin-start role="switch" aria-checked="${on}" aria-label="Запускати з правами адміністратора" ${!admin.available||adminBusy?'disabled':''}></button></div>`;}
function statusMarkup(){return `<span class="status-badge ${!state.enabled||!runtime.hookReady?'off':''}"><span class="status-dot ${!state.enabled||!runtime.hookReady?'off':''}"></span>${e(statusLabel())}</span>`;}

function render(){
  actionDrag?.reset();
  wheelEditorDrag?.reset();
  const count=state.menus.length;
  root.innerHTML=`<div class="app-shell">
    <header class="titlebar"><div class="title-brand"><span class="brand-mark">${icon('orbit',20)}</span><span>Orbit</span><span class="brand-two">2</span><span class="version">${e(updateStatus.currentVersion)}</span></div><button class="titlebar-search" data-command="palette" aria-label="Пошук дій і команд">${icon('search',14)}<span>Пошук дій і команд</span><kbd>Ctrl K</kbd></button><div class="window-controls"><button class="window-control" data-command="minimize" aria-label="Згорнути">${icon('minus',15)}</button><button class="window-control" data-command="maximize" aria-label="Розгорнути">${icon('app',13)}</button><button class="window-control close" data-command="close-window" aria-label="Згорнути в трей">${icon('close',16)}</button></div></header>
    <aside class="sidebar"><div class="sidebar-label">Робочий простір</div><nav aria-label="Основна навігація">
      ${Object.entries(PAGES).map(([id,[ic,label]])=>`<button class="nav-button ${page===id?'active':''}" data-page="${id}" ${page===id?'aria-current="page"':''}>${icon(ic,18)}${label}${id==='menus'?`<span class="nav-count">${count}</span>`:''}</button>`).join('')}
    </nav><div class="sidebar-bottom"><div class="engine-card"><div class="engine-title"><span class="status-dot ${state.enabled&&runtime.hookReady?'':'off'}"></span><span>${e(statusLabel())}</span></div><p>${state.enabled?'Виклик — бічна кнопка '+state.triggerButton:'Увімкніть у розділі «Керування»'}</p><kbd>${e(hotkeyLabel())}</kbd></div><div class="sidebar-footer"><span>Лише на цьому ПК</span><button class="theme-button" data-command="toggle-theme" aria-label="Перемкнути тему">${icon(document.documentElement.dataset.theme==='dark'?'sun':'moon',14)}</button></div></div></aside>
    <main class="workspace"><div class="page"><div class="breadcrumb"><span>Робочий простір</span>${icon('chevron',10)}<span>${PAGES[page][1]}</span></div>${page==='menus'?menusPage():page==='overview'?overviewPage({state,usage,runtime,entries:flatten(),kinds}):page==='library'?libraryPage():page==='controls'?controlsPage():settingsPage()}</div></main>
  </div>`;
  if(page==='menus'){
    const group=currentGroup();
    renderWheel(document.querySelector('#preview-wheel'),group.items,{title:groupPath.length?group.name:currentMenu().name,selected:selectedId,back:!!groupPath.length,addSlot:group.items.length<12,labels:state.wheelLabels!==false});
  }
  if(page==='settings')loadBackups();
  hydrateAppIcons(root);
  root.querySelectorAll('.action-list [draggable="true"] img').forEach(image=>image.draggable=false);
}

function introCard(){
  const legacy=runtime.legacyRunning?`<section class="intro-card warning" aria-label="Orbit запущено">${icon('info',22)}<div><strong>Перший Orbit теж запущений</strong><p>Обидві програми слухають бічну кнопку, тож можуть відкритися два колеса. Закрийте Orbit і вимкніть у ньому «Запускати разом з Windows».</p></div><button class="btn small primary" data-command="quit-legacy">Закрити Orbit</button></section>`:'';
  if(!state.introPending)return legacy;
  const migrated=runtime.migratedFromLegacy;
  return legacy+`<section class="intro-card hero" aria-label="Перші кроки"><span class="intro-mark">${icon('orbit',26)}</span><div><strong>${migrated?'Ласкаво просимо в Orbit 2 — ваші меню вже тут':'Ласкаво просимо в Orbit 2'}</strong><p>${migrated?'Меню й налаштування перенесено з Orbit. ':''}Затисніть бічну кнопку ${state.triggerButton} у будь-якій програмі — колесо з’явиться біля курсора. Нове: дії «Клавіші» й «Текст», меню для окремих програм, статистика та пошук <kbd>Ctrl K</kbd>.</p></div><button class="btn small" data-command="dismiss-intro">Зрозуміло</button></section>`;
}
function menusPage(){
  const menu=currentMenu(),group=currentGroup();
  return `<div class="page-header"><div><h1>Мої меню</h1><p>Програми, папки та команди, які відкриває колесо.</p></div><div class="header-actions"><button class="btn" data-command="new-menu">${icon('plus',15)}Створити меню</button><button class="btn primary" data-command="preview">${icon('play',14)}Викликати колесо</button></div></div>${introCard()}
    <div class="menu-tabs" role="tablist" aria-label="Набори меню">${state.menus.map(m=>`<button class="menu-tab ${m.id===menu.id?'active':''}" data-menu-id="${e(m.id)}" role="tab" aria-selected="${m.id===menu.id}">${icon('wheel',14)}${e(m.name)}${m.apps?.length?`<span class="tab-link" title="Відкривається над: ${e(m.apps.join(', '))}">${icon('link',11)}</span>`:''}${m.hotkey?`<kbd class="tab-key" title="Відкрити це меню: ${e(m.hotkey.replace('Control','Ctrl'))}">Ctrl Alt ${e(m.hotkey.slice(-1))}</kbd>`:''}<span class="tiny-count">${m.items.length}</span></button>`).join('')}<div class="tabs-extra"><button class="icon-btn" data-command="menu-apps" aria-label="Прив’язати меню до програм" title="Прив’язати до програм">${icon('link',14)}</button><button class="icon-btn" data-export-menu aria-label="Поділитися меню" title="Поділитися меню (зберегти у файл)">${icon('export',14)}</button><button class="icon-btn" data-import-menu aria-label="Імпортувати меню з файлу" title="Імпортувати меню з файлу">${icon('import',14)}</button><button class="icon-btn" data-command="rename-menu" aria-label="Перейменувати меню">${icon('edit',14)}</button><button class="icon-btn" data-command="duplicate-menu" aria-label="Дублювати меню">${icon('copy',14)}</button>${state.menus.length>1?`<button class="icon-btn danger" data-command="delete-menu" aria-label="Видалити меню">${icon('trash',14)}</button>`:''}</div></div>
    <div class="menu-editor"><section class="panel preview-panel"><div class="panel-head"><h2>Попередній перегляд</h2><span class="micro-label">${group.items.length} / 12</span></div><div class="preview-surface">${groupPath.length?`<button class="btn small preview-back" data-command="group-back">${icon('back',13)}Назад</button>`:''}<div class="wheel-mount" id="preview-wheel"></div><span class="preview-label">${groupPath.length?e(group.name.toUpperCase()):(menu.apps?.length?'НАД: '+e(menu.apps.join(', ').toUpperCase()):'ORBIT 2 · RADIAL')}</span></div><div class="preview-bottom">${icon('info',15)}<span>Перетягніть сектор, щоб змінити порядок. Центр переносить дію на рівень вище.</span></div></section>
    <section class="panel"><div class="panel-head"><h2>${groupPath.length?e(group.name):'Дії в меню'}</h2><button class="btn small ghost" data-command="add-action" ${group.items.length>=12?'disabled':''}>${icon('plus',13)}Додати</button></div><div class="action-list">${group.items.length?group.items.map((item,i)=>actionRow(item,i)).join(''):`<div class="empty-state">${icon('plus',26)}<strong>Поки що порожньо</strong><p>Додайте програму, папку або команду до цього колеса.</p><button class="btn" data-command="add-action">Додати дію</button></div>`}</div><div class="list-footer"><span>${groupPath.length?'Вкладене меню':'Перетягніть дію на групу, щоб перемістити'}</span><span>${group.items.length} / 12</span></div></section></div>
    <div class="quick-settings"><button class="quick-setting" data-page="controls">${icon('mouse',22)}<span class="setting-copy"><strong>Бічна кнопка ${state.triggerButton}</strong><small>Виклик колеса · Ctrl + Space</small></span>${icon('chevron',14)}</button><button class="quick-setting" data-page="controls">${icon(state.activationMode==='hover'?'mouse':'play',21)}<span class="setting-copy"><strong>${activationNames[state.activationMode]}</strong><small>${state.activationMode==='hover'?`Затримка ${state.hoverDelay} мс`:'Спосіб запуску обраної дії'}</small></span>${icon('chevron',14)}</button></div>
    <div class="page-foot"><span>${icon('check',12)}Зміни зберігаються автоматично</span></div>`;
}
function actionDescription(item){if(item.kind==='keys')return 'Клавіші · '+item.target;if(item.kind==='text')return 'Текст · '+item.target.replace(/\s+/g,' ').slice(0,90);if(isSequence(item))return `Послідовність · ${item.children.length} ${actionsWord(item.children.length)} по черзі`;if(item.kind==='group')return `${item.children.length} ${item.children.length===1?'дія':'дій'} у вкладеному меню`;if(item.kind==='system')return systemNames[item.target]||'Системна команда';return item.target||'Виберіть шлях до застосунку';}
function actionRow(item,index,library=false,context=''){
  return `<div class="action-row ${selectedId===item.id?'selected':''}" data-row-id="${e(item.id)}" ${!library?`draggable="true" title="Перетягніть у групу" ${item.kind==='group'?`data-drop-group="${e(item.id)}"`:''}`:''} tabindex="0" role="button" aria-label="${item.kind==='group'?'Відкрити':'Редагувати'} ${e(item.name)}">${!library?`<span class="action-number">${String(index+1).padStart(2,'0')}</span>`:''}<span class="action-icon">${itemIcon(item,19)}</span><div class="action-copy"><div class="action-name">${e(item.name)}</div><div class="action-desc" title="${e(actionDescription(item))}">${e(context||actionDescription(item))}</div>${!library&&item.kind==='group'?'<div class="action-drop-message" aria-live="polite"></div>':''}</div>${library?`${usageCount(item.id)?`<span class="usage-badge" title="Кількість запусків">${usageCount(item.id)}×</span>`:''}<span class="type-badge">${isSequence(item)?'Послідовність':kinds[item.kind]}</span>`:''}<div class="action-tools">${!library?`<button class="icon-btn duplicate" data-duplicate-id="${e(item.id)}" aria-label="Дублювати ${e(item.name)}" title="Дублювати">${icon('copy',12)}</button>`:''}${library&&(item.kind!=='group'||isSequence(item))?`<button class="icon-btn" data-run-id="${e(item.id)}" aria-label="Запустити ${e(item.name)}" title="Запустити">${icon('play',12)}</button>`:''}${!library&&groupPath.length?`<button class="icon-btn move-root" data-move-root="${e(item.id)}" aria-label="Перемістити ${e(item.name)} в головне меню" title="Перемістити в головне меню">${icon('moveRoot',13)}</button>`:''}${!library?`<button class="icon-btn reorder" data-move-id="${e(item.id)}" data-direction="-1" aria-label="Перемістити ${e(item.name)} вище" ${index===0?'disabled':''}>${icon('arrowUp',12)}</button>`:''}${item.kind==='group'?`<button class="icon-btn" data-open-group="${e(item.id)}" aria-label="Відкрити групу ${e(item.name)}">${icon('chevron',15)}</button><button class="icon-btn" data-edit-id="${e(item.id)}" aria-label="Редагувати ${e(item.name)}" title="Редагувати групу">${icon('edit',13)}</button><button class="icon-btn danger" data-delete-group="${e(item.id)}" aria-label="Видалити групу ${e(item.name)}" title="Видалити групу">${icon('trash',13)}</button>`:`<button class="icon-btn" data-edit-id="${e(item.id)}" aria-label="Редагувати ${e(item.name)}">${icon('edit',13)}</button><button class="icon-btn danger" data-delete-action="${e(item.id)}" aria-label="Видалити дію ${e(item.name)}" title="Видалити дію">${icon('trash',13)}</button>`}</div></div>`;
}
function libraryEntries(){
  const query=search.toLowerCase();
  const list=flatten().filter(({item,path,menu})=>(libraryKind==='all'||item.kind===libraryKind)&&(item.name+' '+kinds[item.kind]+' '+menu.name+' '+path.join(' ')+(item.kind==='keys'?' '+item.target:'')).toLowerCase().includes(query));
  return librarySort==='popular'?[...list].sort((a,b)=>usageCount(b.item.id)-usageCount(a.item.id)):list;
}
function libraryListMarkup(entries){return entries.length?entries.map(({item,path,menu},i)=>actionRow(item,i,true,[menu.name,...path].join(' / '))).join(''):'<div class="empty-state"><strong>Дій не знайдено</strong><p>Спробуйте іншу назву.</p></div>';}
function libraryPage(){
  const entries=libraryEntries();
  return `<div class="page-header"><div><h1>Усі дії</h1><p>Знайдіть і налаштуйте дію в будь-якому меню.</p></div><button class="btn primary" data-command="add-action">${icon('plus',15)}Додати дію</button></div><div class="library-toolbar"><label class="search-box">${icon('search',16)}<input id="action-search" placeholder="Знайти дію…" aria-label="Знайти дію" value="${e(search)}"></label><div class="segmented compact" role="group" aria-label="Сортування">${[['menu','За меню'],['popular','Популярні']].map(([id,label])=>`<button class="${librarySort===id?'active':''}" data-library-sort="${id}" aria-pressed="${librarySort===id}">${label}</button>`).join('')}</div><span class="micro-label" id="library-count" aria-live="polite">${entries.length} дій</span></div><div class="filter-chips" role="group" aria-label="Тип дії">${[['all','Усі'],...Object.entries(kinds)].map(([id,label])=>`<button class="chip ${libraryKind===id?'active':''}" data-library-kind="${id}" aria-pressed="${libraryKind===id}">${id==='all'?'':icon(id,13)}${label}</button>`).join('')}</div><section class="panel library-list">${libraryListMarkup(entries)}</section>`;
}
// Typing in the search box redraws only the list, so the page and the input itself stay in place.
function refreshLibraryList(){
  const list=root.querySelector('.library-list');if(!list){render();return;}
  const entries=libraryEntries();list.innerHTML=libraryListMarkup(entries);
  root.querySelector('#library-count').textContent=`${entries.length} дій`;hydrateAppIcons(list);
}
function controlsPage(){
  return `<div class="page-header"><div><h1>Керування</h1><p>Налаштуйте мишу та спосіб вибору дій.</p></div></div><div class="settings-stack">
    <section class="settings-section"><div class="mouse-visual"><div class="mouse-diagram" aria-hidden="true"><span class="mouse-side forward ${state.triggerButton===5?'active':''}"></span><span class="mouse-side back ${state.triggerButton===4?'active':''}"></span></div><div><h2>Виклик колеса мишею</h2><p>Стандартні бічні кнопки Mouse 4 та Mouse 5.</p>${statusMarkup()}</div></div>
    <div class="setting-row"><div class="setting-label"><strong>Orbit 2 у фоновому режимі</strong><p>Коли ввімкнено, обрана бічна кнопка викликає колесо замість переходу назад або вперед.</p></div><button class="toggle ${state.enabled?'on':''}" data-toggle="enabled" role="switch" aria-checked="${state.enabled}" aria-label="Orbit 2 у фоновому режимі"></button></div>
    <div class="setting-row"><div class="setting-label"><strong>Запускати разом з Windows</strong><p>Orbit 2 стартує у фоні після входу в систему, тож бічна кнопка працює одразу.</p></div><button class="toggle ${state.launchAtLogin!==false?'on':''}" data-toggle="launchAtLogin" role="switch" aria-checked="${state.launchAtLogin!==false}" aria-label="Запускати разом з Windows"></button></div>
    <div class="setting-row"><div class="setting-label"><strong>Ігровий режим</strong><p>Над повноекранною грою чи програмою бічна кнопка й клавіатурний виклик працюють як звичайно й не відкривають колесо, тож нічого не перебиває гру.${runtime.hotkeysPaused?' <span class="status-note">Зараз Orbit 2 поступається програмі на передньому плані.</span>':''}</p></div><button class="toggle ${state.gameMode!==false?'on':''}" data-toggle="gameMode" role="switch" aria-checked="${state.gameMode!==false}" aria-label="Ігровий режим"></button></div>
    <div class="setting-row"><div class="setting-label"><strong>Не відкривати над програмами</strong><p>${state.excludedApps?.length?`Над ${state.excludedApps.map(name=>`<code>${e(name)}</code>`).join(', ')} колесо не відкривається навіть у вікні.`:'Наприклад, ігри у віконному режимі або програми, яким потрібні бічні кнопки.'}</p></div><button class="btn" data-command="excluded-apps">${icon('edit',13)}${state.excludedApps?.length?'Змінити':'Додати'}</button></div>
    ${adminStartRow()}
    <div class="setting-row"><div class="setting-label"><strong>Кнопка виклику</strong><p>Затисніть кнопку, щоб відкрити колесо біля курсора.</p></div><select class="select" data-preference="triggerButton" aria-label="Кнопка виклику"><option value="4" ${state.triggerButton===4?'selected':''}>Mouse 4 · назад</option><option value="5" ${state.triggerButton===5?'selected':''}>Mouse 5 · вперед</option></select></div>
    <div class="setting-row"><div class="setting-label"><strong>Клавіатурний виклик</strong><p>${!state.hotkey?'Колесо відкривається лише мишею.':runtime.hotkey===state.hotkey?(runtime.shortcutRegistered?'Доступний у будь-якій програмі.':'Скорочення зайняте іншою програмою — оберіть інше.'):'Додатковий спосіб відкрити колесо.'}</p></div><select class="select" data-preference="hotkey" aria-label="Клавіатурний виклик">${HOTKEYS.map(([value,label])=>`<option value="${e(value)}" ${(state.hotkey??'Control+Space')===value?'selected':''}>${e(label)}</option>`).join('')}</select></div></section>
    <section class="settings-section"><div class="section-intro"><h2>Вибір дії</h2><p>Як колесо запускає дії та відкриває вкладки.</p></div><div class="setting-row"><div class="setting-label"><strong>Запускати дію</strong><p>${state.activationMode==='release'?'Наведіть на сектор і відпустіть бічну кнопку.':state.activationMode==='hover'?'Затримайте курсор над сектором для запуску.':'Натисніть лівою кнопкою на потрібний сектор.'}</p></div><select class="select" data-preference="activationMode" aria-label="Спосіб запуску">${Object.entries(activationNames).map(([value,label])=>`<option value="${value}" ${state.activationMode===value?'selected':''}>${label}</option>`).join('')}</select></div><div class="setting-row"><div class="setting-label"><strong>Сектор «+» на колесі</strong><p>Додає програму, в якій ви працюєте, просто з колеса. Спрацьовує лише клацанням, не наведенням.</p></div><button class="toggle ${state.wheelAddSlot!==false?'on':''}" data-toggle="wheelAddSlot" role="switch" aria-checked="${state.wheelAddSlot!==false}" aria-label="Сектор «+» на колесі"></button></div><div class="setting-row"><div class="setting-label"><strong>Відкривати вкладки</strong><p>${state.groupOpenMode==='click'?'Натисніть лівою кнопкою на вкладку, щоб відкрити її.':'Наведіть курсор на вкладку, щоб відкрити її.'}</p></div><select class="select" data-preference="groupOpenMode" aria-label="Спосіб відкриття вкладок">${Object.entries(groupOpenNames).map(([value,label])=>`<option value="${value}" ${(state.groupOpenMode??'hover')===value?'selected':''}>${label}</option>`).join('')}</select></div>${state.activationMode==='hover'?`<div class="setting-row"><div class="setting-label"><strong>Затримка наведення</strong><p>Збільште, якщо дії запускаються випадково.</p></div><select class="select" data-preference="hoverDelay" aria-label="Затримка наведення">${[150,250,350,500,750,1000,1500,2000].map(v=>`<option value="${v}" ${state.hoverDelay===v?'selected':''}>${v} мс</option>`).join('')}</select></div>`:''}</section>
    <div class="info-box">${icon('info',17)}<span>${state.groupOpenMode==='click'?'Вкладені групи відкриваються клацанням.':'Вкладені групи відкриваються наведенням.'} Центр колеса повертає на рівень вище. <kbd>Esc</kbd> закриває колесо. Спеціальні кнопки мишей можуть потребувати налаштування у програмі виробника.</span></div>${runtime.hookError?`<div class="info-box">${icon('info',17)}<span>${e(runtime.hookError)}</span></div>`:''}<button class="btn" data-command="preview">${icon('play',14)}Перевірити колесо</button></div>`;
}
function wheelSizeSetting(){
  const percent=Math.round((state.wheelSize??520)/520*100);
  return `<div class="setting-row"><div class="setting-label"><label for="wheel-size"><strong>Розмір кола</strong></label><p>Масштаб меню під час виклику.</p></div><div class="wheel-size-control"><div class="wheel-size-slider"><input id="wheel-size" type="range" min="60" max="150" step="5" value="${percent}" data-preference="wheelSize" aria-valuetext="${percent}%" style="--range-progress:${(percent-60)/90*100}%"><output id="wheel-size-value" for="wheel-size">${percent}%</output></div><div class="wheel-size-actions"><button class="btn small ghost" data-command="reset-wheel-size" ${state.wheelSize===520?'disabled':''}>Скинути до 100%</button><button class="btn small" data-command="preview">${icon('play',12)}Перевірити</button></div></div></div>`;
}
function settingsPage(){
  return `<div class="page-header"><div><h1>Налаштування</h1><p>Вигляд, поведінка колеса, дані та оновлення.</p></div></div><div class="settings-stack"><section class="settings-section"><div class="section-intro"><h2>Зовнішній вигляд</h2><p>Тема, розмір колеса й анімації.</p></div><div class="setting-row"><div class="setting-label"><strong>Тема</strong><p>Застосовується до редактора й колеса.</p></div><div class="segmented" role="group" aria-label="Тема інтерфейсу">${[['light','sun','Світла'],['dark','moon','Темна'],['system','system','Системна']].map(([id,ic,label])=>`<button class="${state.theme===id?'active':''}" data-theme-value="${id}" aria-pressed="${state.theme===id}">${icon(ic,14)}${label}</button>`).join('')}</div></div><div class="setting-row"><div class="setting-label"><strong>Колір акценту</strong><p>Виділений сектор, перемикачі й головні кнопки.</p></div><div class="accent-swatches" role="radiogroup" aria-label="Колір акценту">${ACCENTS.map(([id,label])=>`<button class="swatch swatch-${id} ${(state.accent||'blue')===id?'active':''}" data-accent="${id}" role="radio" aria-checked="${(state.accent||'blue')===id}" aria-label="${label}" title="${label}"><span></span></button>`).join('')}</div></div>${wheelSizeSetting()}<div class="setting-row"><div class="setting-label"><strong>Підписи на колесі</strong><p>Назви дій під іконками. Без них колесо виглядає чистіше, а назва з’являється в центрі.</p></div><button class="toggle ${state.wheelLabels!==false?'on':''}" data-toggle="wheelLabels" role="switch" aria-checked="${state.wheelLabels!==false}" aria-label="Підписи на колесі"></button></div><div class="setting-row"><div class="setting-label"><strong>Зменшити анімації</strong><p>Миттєві переходи без зміни масштабу.</p></div><button class="toggle ${state.reducedMotion?'on':''}" data-toggle="reducedMotion" role="switch" aria-checked="${state.reducedMotion}" aria-label="Зменшити анімації"></button></div></section>
    <section class="settings-section"><div class="section-intro"><h2>Поведінка колеса</h2><p>Налаштуйте закриття кругового меню.</p></div><div class="setting-row"><div class="setting-label"><strong>Закривати меню натисканням поза ним</strong><p>Натискання поза колом скасовує вибір так само, як Esc.</p></div><button class="toggle ${state.closeOnOutsideClick!==false?'on':''}" data-toggle="closeOnOutsideClick" role="switch" aria-checked="${state.closeOnOutsideClick!==false}" aria-label="Закривати меню натисканням поза ним"></button></div><div class="setting-row"><div class="setting-label"><strong>Меню для програм</strong><p>Над програмою, до якої прив’язано меню, колесо відкриває саме його. Прив’язка — кнопкою ${icon('link',11)} біля вкладок меню.</p></div><button class="toggle ${state.contextMenus!==false?'on':''}" data-toggle="contextMenus" role="switch" aria-checked="${state.contextMenus!==false}" aria-label="Меню для програм"></button></div></section>
    <section class="settings-section" id="backups-section"><div class="section-intro"><h2>Резервні копії</h2><p>Orbit 2 щодня зберігає стан меню перед першою зміною. Зберігається 20 останніх копій.</p></div><div class="setting-row"><div class="setting-label"><strong>Щоденні копії</strong><p>Автоматично, у папці налаштувань Orbit 2.</p></div><div class="row-actions"><button class="btn small" data-command="create-backup">${icon('save',13)}Створити зараз</button><button class="toggle ${state.autoBackup!==false?'on':''}" data-toggle="autoBackup" role="switch" aria-checked="${state.autoBackup!==false}" aria-label="Щоденні копії"></button></div></div><div class="backup-list" id="backup-list" aria-live="polite"><div class="backup-empty">Завантаження…</div></div></section>
    ${updatesSettings(updateStatus)}
    <section class="settings-section"><div class="section-intro"><h2>Налаштування меню</h2><p>Збережіть резервну копію або перенесіть меню на інший комп’ютер.</p></div><div class="setting-row"><div class="setting-label"><strong>Експорт</strong><p>Меню, шляхи та налаштування у JSON-файлі.</p></div><button class="btn" data-command="export">${icon('export',15)}Експортувати</button></div><div class="setting-row"><div class="setting-label"><strong>Імпорт</strong><p>Замінює поточні меню. Перед імпортом можна зробити резервну копію.</p></div><button class="btn" data-command="import">${icon('import',15)}Імпортувати</button></div><div class="setting-row"><div class="setting-label"><strong>Статистика запусків</strong><p>Лічильники для сторінки «Огляд». Зберігаються лише на цьому комп’ютері.</p></div><button class="btn" data-command="reset-usage">${icon('trash',14)}Очистити</button></div></section>
    <section class="settings-section"><div class="setting-row"><div class="setting-label"><strong>Orbit 2 <span class="mono" style="font-size:10px;color:var(--muted)">${e(updateStatus.currentVersion)}</span></strong><p>Windows · локальне зберігання · без облікового запису</p></div><span class="about-mark">${icon('orbit',30)}</span></div></section><div class="info-box">${icon('info',17)}<span>Кнопка закриття згортає Orbit 2 у системний трей. Щоб завершити роботу, оберіть «Вийти з Orbit 2» у меню іконки біля годинника.</span></div></div>`;
}

function closeModal(){modalCleanup?.();modalCleanup=null;document.querySelector('#modal-root').innerHTML='';modalPreviousFocus?.focus();}
function modal(title,body,footer,reuseAction=false){
  modalCleanup?.();modalCleanup=null;
  const existing=reuseAction?document.querySelector('.modal:has(#action-form)'):null;
  if(existing){
    existing.querySelector('#modal-title').textContent=title;
    const content=document.createElement('template');content.innerHTML=body;
    existing.querySelector('.modal-body').replaceWith(content.content);
    existing.querySelector('.modal-footer').innerHTML=footer;
  }else{
    modalPreviousFocus=document.activeElement;
    document.querySelector('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><h2 id="modal-title">${e(title)}</h2><button class="icon-btn" data-command="dismiss" aria-label="Закрити">${icon('close',18)}</button></header>${body}<footer class="modal-footer">${footer}</footer></section></div>`;
  }
  queueMicrotask(()=>{
    const target=existing?document.querySelector('.modal .kind-choice.active'):document.querySelector('.modal input')||document.querySelector('.modal button');
    target?.focus({preventScroll:true});
  });
}
function menuDialog(mode='new'){
  const menu=currentMenu(),editing=mode!=='new';let apps=editing?[...(menu.apps||[])]:[];
  const chips=()=>apps.length?apps.map(name=>`<span class="app-chip">${icon('app',12)}${e(name)}<button type="button" data-remove-app="${e(name)}" aria-label="Відв’язати ${e(name)}">${icon('close',11)}</button></span>`).join(''):'<span class="field-note">Не прив’язано — меню відкривається, коли воно активне.</span>';
  modal(editing?'Налаштувати меню':'Нове меню',`<form id="menu-form" class="modal-body"><div class="field"><label for="menu-name">Назва меню</label><input id="menu-name" name="name" maxlength="100" required placeholder="Наприклад, Монтаж" value="${editing?e(menu.name):''}"><small>Окремий набір дій.</small></div><div class="field"><span class="field-title">Відкривати над програмами</span><div class="app-chips" id="menu-apps">${chips()}</div><div class="field-inline"><input id="menu-app-input" placeholder="Наприклад, photoshop.exe" aria-label="Назва програми (.exe)"><button class="btn" type="button" id="menu-app-add">${icon('plus',13)}Додати</button><button class="btn" type="button" id="menu-app-pick">${icon('search',13)}Вибрати…</button></div><small>Коли така програма на передньому плані, колесо відкриває це меню замість активного.</small></div><div class="field"><label for="menu-hotkey">Власна гаряча клавіша</label><select id="menu-hotkey" name="hotkey" class="select"><option value="">Немає</option>${Array.from({length:9},(_,index)=>{const value=`Control+Alt+${index+1}`,owner=state.menus.find(m=>m.hotkey===value&&(!editing||m.id!==menu.id));return `<option value="${value}" ${editing&&menu.hotkey===value?'selected':''} ${owner?'disabled':''}>Ctrl + Alt + ${index+1}${owner?` — «${e(owner.name)}»`:''}</option>`;}).join('')}</select><small>Відкриває колесо одразу з цим меню, де б ви не були.</small></div><p class="form-error" id="form-error" role="alert"></p></form>`,`<button class="btn" data-command="dismiss">Скасувати</button><button class="btn primary" type="submit" form="menu-form">${editing?'Зберегти':'Створити меню'}</button>`);
  const error=document.querySelector('#form-error'),input=document.querySelector('#menu-app-input');
  const redraw=()=>{document.querySelector('#menu-apps').innerHTML=chips();};
  const addApp=value=>{
    let name=String(value||'').trim().split(/[\\/]/).pop().toLowerCase();if(!name)return;
    if(!/\.exe$/.test(name))name+='.exe';
    if(!/^[^<>:"|?*]+\.exe$/.test(name)){error.textContent='Вкажіть назву файлу програми, наприклад chrome.exe.';return;}
    if(apps.length>=30){error.textContent='Можна прив’язати до 30 програм.';return;}
    if(!apps.includes(name))apps.push(name);error.textContent='';input.value='';redraw();
  };
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();addApp(input.value);}});
  document.querySelector('#menu-app-add').onclick=()=>addApp(input.value);
  document.querySelector('#menu-app-pick').onclick=async()=>{try{const name=await api.pickProgram();if(name)addApp(name);}catch(failure){error.textContent=cleanError(failure.message);}};
  document.querySelector('#menu-apps').addEventListener('click',event=>{const button=event.target.closest('[data-remove-app]');if(button){apps=apps.filter(name=>name!==button.dataset.removeApp);redraw();}});
  if(mode==='apps')queueMicrotask(()=>input.focus());
  document.querySelector('#menu-form').onsubmit=async event=>{
    event.preventDefault();if(input.value.trim())addApp(input.value);
    const name=new FormData(event.target).get('name').trim();if(!name)return;
    const next=structuredClone(state);let targetId=menu.id;
    const hotkey=String(new FormData(event.target).get('hotkey')||'');
    if(editing){const target=next.menus.find(m=>m.id===menu.id);target.name=name;target.apps=apps;target.hotkey=hotkey;}
    else{if(next.menus.length>=20){error.textContent='Можна створити до 20 меню.';return;}targetId=uuid();next.menus.push({id:targetId,name,icon:'orbit',apps,hotkey,items:[]});next.activeMenuId=targetId;groupPath=[];}
    // A program opens one menu, so linking it here unlinks it elsewhere.
    next.menus.forEach(m=>{if(m.id!==targetId)m.apps=(m.apps||[]).filter(app=>!apps.includes(app));});
    if(await save(next,editing?'Меню збережено':'Меню створено'))closeModal();
  };
}
// The same program-name rules as linked menus: one .exe file name, case-insensitive.
function programFromInput(value){let name=String(value||'').trim().split(/[\\/]/).pop().toLowerCase();if(!name)return '';if(!/\.exe$/.test(name))name+='.exe';return /^[^<>:"|?*]+\.exe$/.test(name)?name:null;}
function excludedDialog(){
  let apps=[...(state.excludedApps||[])];
  const chips=()=>apps.length?apps.map(name=>`<span class="app-chip">${icon('app',12)}${e(name)}<button type="button" data-remove-app="${e(name)}" aria-label="Прибрати ${e(name)}">${icon('close',11)}</button></span>`).join(''):'<span class="field-note">Список порожній — колесо відкривається над усіма програмами.</span>';
  modal('Не відкривати над програмами',`<form id="excluded-form" class="modal-body"><div class="field"><span class="field-title">Програми</span><div class="app-chips" id="excluded-apps">${chips()}</div><div class="field-inline"><input id="excluded-input" placeholder="Наприклад, game.exe" aria-label="Назва програми (.exe)"><button class="btn" type="button" id="excluded-add">${icon('plus',13)}Додати</button><button class="btn" type="button" id="excluded-pick">${icon('search',13)}Вибрати…</button></div><small>Коли така програма на передньому плані, бічна кнопка й гарячі клавіші Orbit 2 дістаються їй. Працює і для ігор у вікні, яких ігровий режим не помічає.</small></div><p class="form-error" id="form-error" role="alert"></p></form>`,`<button class="btn" data-command="dismiss">Скасувати</button><button class="btn primary" type="submit" form="excluded-form">Зберегти</button>`);
  const error=document.querySelector('#form-error'),input=document.querySelector('#excluded-input');
  const redraw=()=>{document.querySelector('#excluded-apps').innerHTML=chips();};
  const add=value=>{const name=programFromInput(value);if(name==='')return true;if(name===null){error.textContent='Вкажіть назву файлу програми, наприклад game.exe.';return false;}if(!apps.includes(name)){if(apps.length>=30){error.textContent='Можна додати до 30 програм.';return false;}apps.push(name);}error.textContent='';input.value='';redraw();return true;};
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();add(input.value);}});
  document.querySelector('#excluded-add').onclick=()=>add(input.value);
  document.querySelector('#excluded-pick').onclick=async()=>{try{const name=await api.pickProgram();if(name)add(name);}catch(failure){error.textContent=cleanError(failure.message);}};
  document.querySelector('#excluded-apps').addEventListener('click',event=>{const button=event.target.closest('[data-remove-app]');if(button){apps=apps.filter(name=>name!==button.dataset.removeApp);redraw();}});
  queueMicrotask(()=>input.focus());
  document.querySelector('#excluded-form').onsubmit=async event=>{event.preventDefault();if(!add(input.value))return;if(await save({...structuredClone(state),excludedApps:apps},'Список збережено'))closeModal();};
}
function deleteDialog(type,id){const item=type==='menu'?currentMenu():locate(id)?.item;if(!item)return;modal(type==='menu'?'Видалити меню?':'Видалити дію?',`<div class="modal-body"><p class="delete-copy">Видалити <strong>${e(item.name)}</strong>${item.kind==='group'||type==='menu'?' разом із вкладеними діями':''}? Файли та програми на комп’ютері залишаться на місці.</p></div>`,`<button class="btn" data-command="dismiss">Скасувати</button><button class="btn danger" id="confirm-delete">${icon('trash',14)}Видалити</button>`);document.querySelector('#confirm-delete').onclick=async()=>{const next=structuredClone(state);if(type==='menu'){next.menus=next.menus.filter(m=>m.id!==item.id);next.activeMenuId=next.menus[0].id;groupPath=[];}else{const old=state;state=next;const found=locate(id);found.items.splice(found.index,1);state=old;}const previous=state;if(await save(next)){closeModal();undoToast(`«${item.name}» видалено`,previous);}};}
function actionDialog(id){
  let existing=id?locate(id)?.item:null;
  let draft=existing?structuredClone(existing):{id:uuid(),name:'',kind:'app',target:'',args:'',icon:'',children:[]};
  const pickerConfig={query:existing?.kind==='app'?existing.name:'',selectedName:existing?.kind==='app'?existing.name:'',mode:/^https?:\/\//i.test(draft.target)?'url':'search',detailsOpen:!!draft.args,picked:existing?null:new Map(),moveIds:existing?null:new Set()};
  let capture=()=>{};
  const primaryLabel=()=>existing?'Зберегти':draft.kind==='group'?(pickerConfig.moveIds.size?`Створити групу (${pickerConfig.moveIds.size})`:'Створити групу'):pickerConfig.picked?.size&&['app','folder','script'].includes(draft.kind)?`Додати вибрані (${pickerConfig.picked.size})`:'Додати дію';
  // Names filled in by Orbit (a picked program, a Windows tile) are dropped when the type changes; typed ones stay.
  let nameTyped=!!existing;
  const parentGroup=currentGroup();if(!existing&&parentGroup.items.length>=12){toast('У цьому колесі вже 12 дій. Створіть групу або інше меню.',true);return;}
  function draw(){
    const targetField=draft.kind==='app'?appPickerFields(draft,pickerConfig):draft.kind==='folder'?folderPickerFields(draft,pickerConfig):draft.kind==='group'?groupPickerFields(draft,pickerConfig,existing?[]:currentGroup().items.filter(item=>groupPath.length+1+groupHeight(item)<=MAX_GROUP_DEPTH))+`<label class="check-row"><input type="checkbox" name="sequence" ${draft.target==='sequence'?'checked':''}><span><strong>Послідовність</strong><small>Один вибір на колесі виконує всі дії групи по черзі — наприклад, відкриває програму, папку й вставляє текст.</small></span></label>`:draft.kind==='keys'?keysFields(draft):draft.kind==='text'?textFields(draft):draft.kind==='system'?`<div class="field"><span class="field-title" id="system-title">Команда Windows</span><div class="kind-choices system-choices" role="group" aria-labelledby="system-title">${Object.entries(systemNames).map(([value,label])=>`<button class="kind-choice system-choice ${draft.target===value?'active':''}" data-system="${value}" type="button" aria-pressed="${draft.target===value}">${icon(systemIcons[value],19)}<span>${label}</span></button>`).join('')}</div></div>`:scriptPickerFields(draft,pickerConfig);
    // Windows commands are named by the chosen tile, so they need no name field.
    const fields=['app','system','folder','script','group'].includes(draft.kind)?targetField:`<div class="field"><label for="action-name">Назва</label><input id="action-name" name="name" maxlength="100" value="${e(draft.name)}" placeholder="${{script:'Візьметься з назви файлу',group:'Наприклад, Монтаж',keys:'Наприклад, Нова вкладка',text:'Візьметься з першого рядка'}[draft.kind]||''}" ${draft.kind==='group'?'required':''}></div>${targetField}`;
    modal(existing?'Редагувати дію':'Додати дію',`<form class="modal-body" id="action-form"><div class="kind-choices" role="group" aria-label="Тип дії">${Object.entries(kinds).filter(([kind])=>kind!=='group'||existing?.kind==='group'||groupPath.length<MAX_GROUP_DEPTH).map(([kind,label])=>`<button class="kind-choice ${draft.kind===kind?'active':''}" data-kind="${kind}" type="button" aria-pressed="${draft.kind===kind}">${icon(kind,19)}${label}</button>`).join('')}</div>${fields}<p class="form-error" id="form-error" role="alert"></p></form>`,`${existing?`<button class="btn danger" type="button" id="delete-action">${icon('trash',14)}Видалити</button>`:''}<button class="btn" data-command="dismiss">Скасувати</button><button class="btn primary" type="submit" form="action-form">${primaryLabel()}</button>`,true);
    capture=()=>{
      const form=new FormData(document.querySelector('#action-form'));
      if(draft.kind==='system'){if(!nameTyped||existing?.kind==='system')draft.name=existing?.kind==='system'&&existing.target===draft.target?existing.name:systemNames[draft.target];draft.args='';return;}
      draft.name=String(form.get('name')||'').trim();draft.target=draft.kind==='group'?(form.get('sequence')?'sequence':''):draft.kind==='text'?String(form.get('target')||''):String(form.get('target')||'').trim();draft.args=String(form.get('args')||'');
    };
    if(draft.kind==='app')modalCleanup=mountAppPicker({form:document.querySelector('#action-form'),draft,config:pickerConfig,onChoose:entry=>{
      // The details element is the source of truth; its toggle event may not have arrived yet.
      pickerConfig.detailsOpen=!!document.querySelector('.app-advanced')?.open;
      capture();if(!draft.name||draft.name===pickerConfig.selectedName)draft.name=entry.name;
      draft.target=entry.target;draft.args=entry.args||'';draft.icon='app';pickerConfig.mode='search';pickerConfig.selectedName=entry.name;pickerConfig.query=entry.name;
      rememberAppIcon(entry.target,entry.icon);draw();
      // Picking a program finishes the action unless the user opened the advanced fields to add arguments.
      if(!pickerConfig.detailsOpen)submit();else queueMicrotask(()=>document.querySelector('#action-name')?.focus());
    },onPickedChange:()=>{const button=document.querySelector('.modal-footer .primary');if(button)button.textContent=primaryLabel();},onModeChange:mode=>{capture();pickerConfig.mode=mode;pickerConfig.query='';pickerConfig.selectedName='';draft.target='';draft.args='';draw();queueMicrotask(()=>document.querySelector(mode==='url'?'#action-target':'#app-search')?.focus());}});
    if(draft.kind==='folder')modalCleanup=mountFolderPicker({form:document.querySelector('#action-form'),config:pickerConfig,onChoose:entry=>chooseFolder(entry.target,entry.name),onPickedChange:()=>{const button=document.querySelector('.modal-footer .primary');if(button)button.textContent=primaryLabel();}});
    document.querySelector('#action-name')?.addEventListener('input',()=>{nameTyped=true;});
    if(draft.kind==='group')modalCleanup=mountGroupPicker({form:document.querySelector('#action-form'),draft,config:pickerConfig,onMoveChange:()=>{const button=document.querySelector('.modal-footer .primary');if(button)button.textContent=primaryLabel();}});
    if(draft.kind==='script')modalCleanup=mountScriptPicker({form:document.querySelector('#action-form'),config:pickerConfig,onChoose:entry=>chooseScript(entry.target),onPickedChange:()=>{const button=document.querySelector('.modal-footer .primary');if(button)button.textContent=primaryLabel();}});
    document.querySelector('#browse-script')?.addEventListener('click',async()=>{try{const value=await api.pickTarget('script');if(value)chooseScript(value);}catch(error){document.querySelector('#form-error').textContent=error.message;}});
    document.querySelector('#browse-folder')?.addEventListener('click',async()=>{try{const value=await api.pickTarget('folder');if(value)chooseFolder(value,folderName(value));}catch(error){document.querySelector('#form-error').textContent=error.message;}});
    document.querySelectorAll('[data-kind]').forEach(button=>button.onclick=()=>{capture();const nextKind=button.dataset.kind;if(existing?.kind==='group'&&draft.children.length&&nextKind!=='group'){document.querySelector('#form-error').textContent='Спочатку видаліть або перенесіть дії з групи.';return;}if(draft.kind!==nextKind){draft.kind=nextKind;draft.target=nextKind==='system'?'explorer':'';draft.icon='';if(!nameTyped)draft.name='';pickerConfig.picked?.clear();pickerConfig.moveIds?.clear();}draw();});
    document.querySelectorAll('[data-system]').forEach(button=>button.onclick=()=>{
      draft.target=button.dataset.system;
      document.querySelectorAll('[data-system]').forEach(other=>{const active=other===button;other.classList.toggle('active',active);other.setAttribute('aria-pressed',String(active));});
    });
    document.querySelectorAll('[data-system]').forEach(button=>button.ondblclick=()=>{draft.target=button.dataset.system;submit();});
    document.querySelector('#browse-target')?.addEventListener('click',async()=>{capture();try{const value=await api.pickTarget(draft.kind);if(value){draft.target=value;const name=draft.kind==='folder'?folderName(value):draft.kind==='script'?scriptName(value):value.split(/[\\/]/).pop().replace(/\.[^.]+$/,'');if(!draft.name||draft.name===pickerConfig.selectedName||!nameTyped)draft.name=name;if(draft.kind==='app'){pickerConfig.mode='search';pickerConfig.selectedName=name;pickerConfig.query=name;draw();if(!existing&&!pickerConfig.detailsOpen)submit(true);}else{document.querySelector('#action-target').value=value;document.querySelector('#action-name').value=draft.name;}}}catch(error){document.querySelector('#form-error').textContent=error.message;}});
    if(draft.kind==='keys')mountShortcutCapture(draft,()=>nameTyped);
    document.querySelector('#delete-action')?.addEventListener('click',()=>deleteDialog('action',draft.id));
    document.querySelector('#action-form').onsubmit=event=>{event.preventDefault();submit();};
  }
  async function addPicked(){
    const entries=[...pickerConfig.picked.values()],free=12-currentGroup().items.length;
    if(entries.length>free){document.querySelector('#form-error').textContent=`У цьому колесі є місце ще для ${free} ${actionsWord(free)}.`;return;}
    const next=structuredClone(state),old=state;state=next;
    const added=entries.map(entry=>({id:uuid(),name:entry.name,kind:entry.kind||'app',target:entry.target,args:entry.args||'',icon:entry.kind==='folder'?'folder':entry.kind==='script'?'':'app',children:[]}));
    currentGroup().items.push(...added);state=old;
    if(await save(next,`Додано ${added.length} ${actionsWord(added.length)}`)){selectedId=added.at(-1).id;closeModal();render();}
  }
  // submit() re-reads the form, so a chosen folder or script is written into its (possibly hidden) fields first.
  function chooseFolder(target,name){
    const path=document.querySelector('#action-target'),label=document.querySelector('#action-name');
    if(path)path.value=target;if(label&&!nameTyped)label.value=name;
    submit(true);
  }
  // With the advanced section open the script only fills the form, so arguments can be added before saving.
  function chooseScript(target){
    const path=document.querySelector('#action-target'),label=document.querySelector('#action-name');
    if(path)path.value=target;if(label&&!nameTyped)label.value=scriptName(target);
    if(!document.querySelector('.app-advanced')?.open)submit(true);else document.querySelector('#action-args')?.focus();
  }
  async function submit(single=false){
    capture();if(!single&&!existing&&['app','folder','script'].includes(draft.kind)&&pickerConfig.picked?.size){await addPicked();return;}
    if(!draft.name&&draft.target&&draft.kind==='folder')draft.name=folderName(draft.target);
    if(!draft.name&&draft.target&&draft.kind==='script')draft.name=scriptName(draft.target);
    if(draft.kind==='keys'&&!draft.target){document.querySelector('#form-error').textContent='Натисніть комбінацію клавіш або виберіть готову.';document.querySelector('#action-target')?.focus();return;}
    if(draft.kind==='keys'&&!draft.name)draft.name=SHORTCUT_PRESETS.find(([,keys])=>keys===draft.target)?.[0]||draft.target;
    if(draft.kind==='text'&&!draft.target.trim()){document.querySelector('#form-error').textContent='Додайте текст, який потрібно вставляти.';document.querySelector('#action-target')?.focus();return;}
    if(draft.kind==='text'&&!draft.name)draft.name=draft.target.trim().split(/\r?\n/)[0].slice(0,32);
    if(!draft.name&&draft.kind==='group')draft.name='Нова група';if(draft.kind==='app'&&!draft.target){document.querySelector('#form-error').textContent='Оберіть застосунок зі списку, файл або вкажіть посилання.';document.querySelector('#app-search,#action-target')?.focus();return;}if(!draft.name){document.querySelector('#form-error').textContent='Вкажіть назву дії.';document.querySelector('#action-name').focus();return;}const next=structuredClone(state),old=state;state=next;const moving=!existing&&draft.kind==='group'?pickerConfig.moveIds:null;
    if(existing){const found=locate(existing.id);if(draft.kind==='group'&&found.item.kind==='group')draft.children=found.item.children;found.items[found.index]=draft;}
    else if(moving?.size){
      // Ticked actions move into the new group, which takes the place of the first of them.
      const level=currentGroup().items,at=level.findIndex(item=>moving.has(item.id));
      draft.children=level.filter(item=>moving.has(item.id));
      const rest=level.filter(item=>!moving.has(item.id));rest.splice(at,0,draft);level.splice(0,level.length,...rest);
    }
    else currentGroup().items.push(draft);
    state=old;if(await save(next,existing?'Дію збережено':draft.kind==='group'?(moving?.size?`Групу створено, перенесено ${moving.size} ${actionsWord(moving.size)}`:'Групу створено'):'Дію додано')){selectedId=draft.id;closeModal();
      // A new group opens right away so its actions can be added without finding it in the list.
      if(!existing&&draft.kind==='group'){await openEditorGroup(draft.id);root.querySelector('.panel-head [data-command="add-action"]')?.focus();}else render();}
  }draw();
}

const keycaps=text=>shortcutParts(text).map(part=>`<kbd class="keycap">${e(part)}</kbd>`).join('<span class="keycap-plus">+</span>');
function keysFields(draft){
  return `<div class="field"><label for="action-target">Комбінація клавіш</label><div class="shortcut-capture ${draft.target?'has-value':''}" id="shortcut-capture"><input id="action-target" name="target" readonly value="${e(draft.target)}" placeholder="Клацніть і натисніть клавіші…" aria-describedby="shortcut-help"><span class="shortcut-keys" aria-hidden="true">${keycaps(draft.target)}</span><button type="button" class="icon-btn" id="shortcut-clear" aria-label="Очистити комбінацію">${icon('close',13)}</button></div><small id="shortcut-help">Комбінацію буде натиснуто в програмі, над якою відкрито колесо.</small></div><div class="field"><span class="field-title">Готові комбінації</span><div class="name-chips preset-chips">${SHORTCUT_PRESETS.map(([name,keys,ic])=>`<button type="button" class="name-chip preset-chip ${draft.target===keys?'active':''}" data-preset-keys="${e(keys)}" data-preset-name="${e(name)}" data-preset-icon="${e(ic)}">${icon(ic,12)}${e(name)}<span class="mono">${e(keys)}</span></button>`).join('')}</div></div>`;
}
function textFields(draft){
  return `<div class="field"><label for="action-target">Текст для вставлення</label><textarea id="action-target" name="target" class="snippet-input" maxlength="4096" placeholder="Наприклад, підпис листа, адреса або шаблон відповіді">${e(draft.target)}</textarea><small>Orbit 2 вставить текст у програму під колесом через буфер обміну, а потім поверне попередній текст буфера.</small></div>`;
}
function mountShortcutCapture(draft,nameTyped){
  const box=document.querySelector('#shortcut-capture'),input=box.querySelector('input'),keys=box.querySelector('.shortcut-keys');
  const set=value=>{draft.target=value;input.value=value;keys.innerHTML=keycaps(value);box.classList.toggle('has-value',!!value);
    document.querySelectorAll('[data-preset-keys]').forEach(chip=>chip.classList.toggle('active',chip.dataset.presetKeys===value));};
  input.addEventListener('keydown',event=>{
    if((event.key==='Tab'||event.key==='Escape')&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&!event.shiftKey)return;
    event.preventDefault();event.stopPropagation();
    const result=shortcutFromEvent(event);if(!result)return;
    box.classList.toggle('recording',!result.complete);
    if(result.complete)set(result.text);else keys.innerHTML=keycaps(result.text);
  });
  input.addEventListener('keyup',()=>{if(box.classList.contains('recording')){box.classList.remove('recording');keys.innerHTML=keycaps(draft.target);}});
  input.addEventListener('blur',()=>{box.classList.remove('recording');keys.innerHTML=keycaps(draft.target);});
  box.querySelector('#shortcut-clear').onclick=()=>{set('');input.focus();};
  document.querySelectorAll('[data-preset-keys]').forEach(chip=>chip.onclick=()=>{
    set(chip.dataset.presetKeys);draft.icon=chip.dataset.presetIcon;
    const name=document.querySelector('#action-name');if(name&&(!nameTyped()||!name.value.trim()))name.value=chip.dataset.presetName;
  });
}

// Launches an action from the editor; shortcuts and text go to the window behind Orbit 2.
// A copy with fresh IDs (children too) right after the original.
async function duplicateAction(id){
  const found=locate(id);if(!found)return;
  if(found.items.length>=12){toast('У цьому колесі вже 12 дій.',true);return;}
  const copy=structuredClone(found.item),renew=item=>{item.id=uuid();item.children?.forEach(renew);};renew(copy);copy.name=copy.name.slice(0,92)+' — копія';
  const next=structuredClone(state),old=state;state=next;const target=locate(id);target.items.splice(target.index+1,0,copy);state=old;
  if(await save(next,'Дію продубльовано'))selectedId=copy.id;render();
}
async function runAction(id){
  const found=locate(id);if(!found||opensGroup(found.item))return;
  try{
    if(['keys','text'].includes(found.item.kind)){await api.minimize();await delay(350);}
    const result=await api.executeAction(found.item);
    if(!result.ok)toast(result.error||'Не вдалося виконати дію',true);else toast(`Запущено «${found.item.name}»`);
  }catch(error){toast(error.message,true);}
}
async function editFromPalette(id){
  const found=locate(id);if(!found)return;
  if(state.activeMenuId!==found.menu.id&&!await change({activeMenuId:found.menu.id}))return;
  page='menus';groupPath=found.path;selectedId=id;render();
  if(found.item.kind==='group')await openEditorGroup(id);else actionDialog(id);
}
function openCommandPalette(){
  if(overlay||document.querySelector('.modal'))return;
  const actions=[],groups=[];
  for(const {item,menu,path} of flatten()){
    const where=[menu.name,...path].join(' / ');
    if(opensGroup(item))groups.push({section:'Групи',title:item.name,subtitle:where,iconHTML:itemIcon(item,18),hint:'Відкрити',run:()=>editFromPalette(item.id)});
    else actions.push({section:'Дії',title:item.name,subtitle:`${kinds[item.kind]} · ${where}`,keywords:item.kind==='text'?'':item.target,iconHTML:itemIcon(item,18),hint:usageCount(item.id)?`${usageCount(item.id)}×`:'',count:usageCount(item.id),run:alt=>alt?editFromPalette(item.id):runAction(item.id)});
  }
  actions.sort((a,b)=>b.count-a.count);
  const go=(target,label)=>({section:'Перейти',title:label,iconHTML:icon(PAGES[target][0],18),run:()=>{page=target;groupPath=[];render();}});
  const command=(title,ic,run,keywords='')=>({section:'Команди',title,iconHTML:icon(ic,18),keywords,run});
  const commands=[
    command('Додати дію','plus',()=>{page='menus';render();actionDialog();},'новий створити'),
    command('Викликати колесо','play',()=>api.showWheel(),'показати перевірити'),
    command('Створити меню','wheel',()=>{page='menus';render();menuDialog();}),
    command('Прив’язати поточне меню до програм','link',()=>{page='menus';render();menuDialog('apps');}),
    command('Не відкривати над програмами…','close',()=>{page='controls';render();excludedDialog();},'виключити гра ігри ігнорувати'),
    command(state.gameMode!==false?'Вимкнути ігровий режим':'Увімкнути ігровий режим','play',()=>change({gameMode:state.gameMode===false}),'гра повноекранний'),
    command(document.documentElement.dataset.theme==='dark'?'Світла тема':'Темна тема',document.documentElement.dataset.theme==='dark'?'sun':'moon',()=>runCommand('toggle-theme'),'тема'),
    command('Створити резервну копію','save',()=>runCommand('create-backup'),'backup копія'),
    command('Експортувати налаштування','export',()=>runCommand('export')),
  ];
  const menus=state.menus.filter(menu=>menu.id!==state.activeMenuId).map(menu=>({section:'Меню',title:`Зробити активним: ${menu.name}`,iconHTML:icon('wheel',18),run:async()=>{groupPath=[];selectedId='';page='menus';await change({activeMenuId:menu.id},`Активне меню: ${menu.name}`);}}));
  openPalette([...actions,...groups,...commands,...Object.keys(PAGES).map(id=>go(id,PAGES[id][1])),...menus]);
}
function formatBackupDate(value){const [date,time]=value.split(' ');const [year,month,day]=date.split('-');return `${day}.${month}.${year}${time?' '+time:''}`;}
async function loadBackups(){
  const list=document.querySelector('#backup-list');if(!list||!api.listBackups)return;
  try{
    const backups=await api.listBackups();
    const target=document.querySelector('#backup-list');if(!target)return;
    target.innerHTML=backups.length?backups.slice(0,8).map(backup=>`<div class="backup-row">${icon(backup.manual?'save':'history',15)}<div class="backup-copy"><strong>${e(formatBackupDate(backup.date))}</strong><small>${backup.menus} меню · ${backup.actions} дій · ${Math.max(1,Math.round(backup.size/1024))} КБ${backup.manual?' · вручну':''}</small></div><button class="btn small" data-restore-backup="${e(backup.name)}">Відновити</button></div>`).join(''):'<div class="backup-empty">Копій ще немає. Перша з’явиться перед першою зміною сьогодні.</div>';
  }catch(error){list.innerHTML=`<div class="backup-empty">${e(cleanError(error.message))}</div>`;}
}
function restoreDialog(name){
  const match=/^settings-(\d{4})-(\d{2})-(\d{2})(?:-(\d{2})(\d{2}))?/.exec(name)||[];
  const label=match[1]?`${match[3]}.${match[2]}.${match[1]}${match[4]?` ${match[4]}:${match[5]}`:''}`:name;
  modal('Відновити резервну копію?',`<div class="modal-body"><p class="delete-copy">Поточні меню й налаштування буде замінено копією від <strong>${e(label)}</strong>. Поточний стан буде збережено окремою копією, тож відновлення можна скасувати.</p></div>`,`<button class="btn" data-command="dismiss">Скасувати</button><button class="btn primary" id="confirm-restore">${icon('history',14)}Відновити</button>`);
  document.querySelector('#confirm-restore').onclick=async()=>{try{state=await api.restoreBackup(name);groupPath=[];closeModal();applyTheme();render();toast('Резервну копію відновлено');}catch(error){toast(error.message,true);}};
}

// Files and folders dragged in from Explorer become actions in the open menu or group.
const draggingFiles=event=>[...(event.dataTransfer?.types||[])].includes('Files');
async function addDroppedFiles(files){
  let found=[];
  try{found=await api.inspectDropped(files.map(file=>api.pathForFile(file)).filter(Boolean));}catch(error){toast(error.message,true);return;}
  if(!found.length){toast('Перетягніть програму (.exe, .lnk), папку або скрипт.',true);return;}
  if(page!=='menus'){page='menus';groupPath=[];}
  const free=12-currentGroup().items.length;
  if(free<=0){toast('У цьому колесі вже 12 дій. Створіть групу або інше меню.',true);render();return;}
  const next=structuredClone(state),old=state;state=next;
  const added=found.slice(0,free).map(entry=>({id:uuid(),name:entry.name,kind:entry.kind,target:entry.target,args:'',icon:entry.kind==='app'?'app':'',children:[]}));
  currentGroup().items.push(...added);state=old;
  const skipped=found.length-added.length;
  selectedId=added.at(-1).id;
  await save(next,skipped?`Додано ${added.length} ${actionsWord(added.length)}; ще ${skipped} не вмістилося в колесо`:`Додано ${added.length} ${actionsWord(added.length)}`);
}
if(!overlay){
  document.addEventListener('dragover',event=>{if(!draggingFiles(event))return;event.preventDefault();const blocked=!!document.querySelector('.modal');event.dataTransfer.dropEffect=blocked?'none':'copy';document.body.classList.toggle('file-drop',!blocked);});
  document.addEventListener('dragleave',event=>{if(!event.relatedTarget)document.body.classList.remove('file-drop');});
  document.addEventListener('drop',event=>{if(!draggingFiles(event))return;event.preventDefault();document.body.classList.remove('file-drop');if(!document.querySelector('.modal'))addDroppedFiles([...event.dataTransfer.files]);});
}
root.addEventListener('click',async event=>{
  if(actionDrag?.suppressClick()&&event.target.closest('[data-row-id]')){event.preventDefault();return;}
  if(wheelEditorDrag?.suppressClick()&&event.target.closest('#preview-wheel')){event.preventDefault();return;}
  if(event.target.closest('#preview-wheel [data-add-slot]')){actionDialog();return;}
  const button=event.target.closest('button');
  if(button?.dataset.page){page=button.dataset.page;groupPath=[];render();return;}
  if(button?.dataset.menuId){groupPath=[];selectedId='';await change({activeMenuId:button.dataset.menuId});return;}
  if(button?.dataset.wheelId&&!overlay){await activateEditorItem(button.dataset.wheelId);return;}
  if(button?.hasAttribute('data-wheel-back')&&!overlay){groupPath.pop();render();return;}
  if(button?.dataset.openGroup){await openEditorGroup(button.dataset.openGroup);return;}
  if(button?.dataset.editId){selectedId=button.dataset.editId;actionDialog(selectedId);return;}
  if(button?.dataset.duplicateId){await duplicateAction(button.dataset.duplicateId);return;}
  if(button?.dataset.exportMenu!==undefined){try{const result=await api.exportMenu(currentMenu().id);if(result.ok)toast('Меню збережено у файл');else if(result.error)toast(result.error,true);}catch(error){toast(error.message,true);}return;}
  if(button?.dataset.importMenu!==undefined){try{const result=await api.importMenu();if(result){state=result.state;groupPath=[];selectedId='';applyTheme();render();toast(`Меню «${result.name}» додано`);}}catch(error){toast(error.message,true);}return;}
  if(button?.dataset.moveRoot){
    try{
      const id=button.dataset.moveRoot,name=locate(id)?.item.name,next=moveActionToRoot(state,id);
      if(await save(next,`«${name}» переміщено в головне меню`)){
        root.querySelector('.action-list [data-row-id], [data-command="group-back"]')?.focus({preventScroll:true});
      }
    }catch(error){toast(error.message,true);}
    return;
  }
  if(button?.dataset.deleteGroup){deleteDialog('action',button.dataset.deleteGroup);return;}
  if(button?.dataset.deleteAction){deleteDialog('action',button.dataset.deleteAction);return;}
  if(button?.dataset.moveId){const next=structuredClone(state),old=state;state=next;const found=locate(button.dataset.moveId);if(!found){state=old;return;}const newIndex=found.index+Number(button.dataset.direction);if(newIndex>=0&&newIndex<found.items.length)[found.items[found.index],found.items[newIndex]]=[found.items[newIndex],found.items[found.index]];state=old;await save(next);return;}
  if(button?.dataset.adminStart!==undefined){if(adminBusy)return;adminBusy=true;render();try{const result=await api.setAdminStart(!runtime.adminStart?.enabled);if(!result.ok&&!result.canceled)toast(result.error||'Не вдалося змінити запуск з правами адміністратора.',true);}catch(error){toast(error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''),true);}finally{adminBusy=false;render();}return;}
  if(button?.dataset.toggle){const key=button.dataset.toggle;const current=['closeOnOutsideClick','launchAtLogin','wheelAddSlot','wheelLabels','contextMenus','autoBackup','gameMode'].includes(key)?state[key]!==false:state[key];await change({[key]:!current});return;}
  if(button?.dataset.accent){await change({accent:button.dataset.accent});return;}
  if(button?.dataset.libraryKind){libraryKind=button.dataset.libraryKind;render();return;}
  if(button?.dataset.librarySort){librarySort=button.dataset.librarySort;render();return;}
  if(button?.dataset.runId){await runAction(button.dataset.runId);return;}
  if(button?.dataset.restoreBackup){restoreDialog(button.dataset.restoreBackup);return;}
  if(button?.dataset.themeValue){await change({theme:button.dataset.themeValue});return;}
  const command=button?.dataset.command;
  if(command){await runCommand(command);return;}
  const row=event.target.closest('[data-row-id]');if(row&&!overlay){await activateEditorItem(row.dataset.rowId);return;}
  const sector=event.target.closest('[data-sector]');if(sector&&!overlay){await activateEditorItem(sector.dataset.sector);}
});
async function runCommand(command){
  try{
    switch(command){
      case 'dismiss-intro':await change({introPending:false});break;
      case 'palette':openCommandPalette();break;
      case 'menu-apps':menuDialog('apps');break;
      case 'excluded-apps':excludedDialog();break;
      case 'quit-legacy':{const result=await api.quitLegacy();if(result.ok)toast('Orbit закрито');else toast(result.error,true);break;}
      case 'create-backup':await api.createBackup();toast('Резервну копію створено');loadBackups();break;
      case 'reset-usage':modal('Очистити статистику?',`<div class="modal-body"><p class="delete-copy">Лічильники запусків на сторінці «Огляд» буде скинуто. Меню й дії не зміняться.</p></div>`,`<button class="btn" data-command="dismiss">Скасувати</button><button class="btn danger" id="confirm-reset-usage">${icon('trash',14)}Очистити</button>`);document.querySelector('#confirm-reset-usage').onclick=async()=>{usage=await api.resetUsage();closeModal();render();toast('Статистику очищено');};break;
      case 'minimize':await api.minimize();break;
      case 'maximize':await api.maximize();break;
      case 'close-window':await api.closeWindow();break;
      case 'toggle-theme':await change({theme:document.documentElement.dataset.theme==='dark'?'light':'dark'});break;
      case 'preview':await api.showWheel();break;
      case 'check-updates':updateStatus=await api.checkForUpdates();refreshUpdates(updateStatus);break;
      case 'download-update':updateStatus=await api.downloadUpdate();refreshUpdates(updateStatus);break;
      case 'install-update':updateStatus=await api.installUpdate();refreshUpdates(updateStatus);break;
      case 'open-update-repository':await api.openUpdateRepository();break;
      case 'reset-wheel-size':await change({wheelSize:520});document.querySelector('#wheel-size')?.focus({preventScroll:true});break;
      case 'new-menu':menuDialog();break;
      case 'rename-menu':menuDialog('rename');break;
      case 'delete-menu':deleteDialog('menu');break;
      case 'duplicate-menu':{if(state.menus.length>=20){toast('Можна створити до 20 меню.',true);break;}const copy=structuredClone(currentMenu());copy.id=uuid();copy.name+=' — копія';const renew=items=>items.forEach(i=>{i.id=uuid();if(i.children)renew(i.children);});renew(copy.items);groupPath=[];await change({menus:[...state.menus,copy],activeMenuId:copy.id},'Меню продубльовано');break;}
      case 'add-action':actionDialog();break;
      case 'group-back':groupPath.pop();render();break;
      case 'export':{const result=await api.exportState();if(result.ok)toast('Налаштування експортовано');else if(result.error)toast(result.error,true);break;}
      case 'import':modal('Імпортувати налаштування?',`<div class="modal-body"><p class="delete-copy">Поточні меню та налаштування буде замінено даними з обраного файлу. Імпорт самостійно не запускає жодних дій.</p></div>`,`<button class="btn" data-command="dismiss">Скасувати</button><button class="btn primary" id="confirm-import">Вибрати JSON-файл</button>`);document.querySelector('#confirm-import').onclick=async()=>{try{const result=await api.importState();if(result){state=result;groupPath=[];closeModal();applyTheme();render();toast('Налаштування імпортовано');}}catch(error){toast(error.message,true);}};break;
    }
  }catch(error){toast(error.message,true);}
}
root.addEventListener('change',async event=>{
  const key=event.target.dataset.preference;if(!key)return;
  if(key==='wheelSize'){
    const restoreFocus=document.activeElement===event.target;
    await change({wheelSize:Math.round(Number(event.target.value)*520/100)});
    if(restoreFocus)document.querySelector('#wheel-size')?.focus({preventScroll:true});
  }else change({[key]:['triggerButton','hoverDelay'].includes(key)?Number(event.target.value):event.target.value});
});
root.addEventListener('input',event=>{
  if(event.target.id==='wheel-size'){
    const percent=Number(event.target.value);
    document.querySelector('#wheel-size-value').value=percent+'%';
    event.target.setAttribute('aria-valuetext',percent+'%');
    event.target.style.setProperty('--range-progress',(percent-60)/90*100+'%');
  }
  if(event.target.id==='action-search'){search=event.target.value;refreshLibraryList();}
});
document.querySelector('#modal-root').addEventListener('click',event=>{if(event.target.classList.contains('modal-backdrop')||event.target.closest('[data-command="dismiss"]'))closeModal();});
document.addEventListener('keydown',event=>{
  if(document.querySelector('select:open'))return;
  const dialog=document.querySelector('.modal');
  if(!overlay&&!dialog&&(event.ctrlKey||event.metaKey)&&event.code==='KeyK'){event.preventDefault();if(!paletteOpen())openCommandPalette();return;}
  if(paletteOpen())return;
  if(dialog){if(event.key==='Escape'){event.preventDefault();closeModal();}if(event.key==='Tab'){const focusable=[...dialog.querySelectorAll('button:not(:disabled),input,select,textarea')];const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}return;}
  if(overlay){if(event.key==='Escape'){clearWheelTimers();wheelOpen=false;api.closeWheel();}else if(['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'].includes(event.key)){event.preventDefault();const items=wheelItems();if(items.length)selectWheel((wheelSelected+(event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:1)+items.length)%items.length,true);}else if(event.key==='Enter'){event.preventDefault();commitWheel();}else if(event.key==='Backspace'){event.preventDefault();wheelBack();}
    else if(/^[1-9]$/.test(event.key)&&!event.ctrlKey&&!event.altKey){const items=wheelItems(),index=Number(event.key)-1;if(index<items.length&&items[index]!==ADD_SLOT){event.preventDefault();selectWheel(index,true);commitWheel();}}
    return;}
  if(event.key==='Enter'&&event.target.matches('[data-row-id]')){event.preventDefault();activateEditorItem(event.target.dataset.rowId);}
});

const ADD_SLOT={id:'__orbit-add',kind:'add'};
// Real actions at this wheel level, plus the "+" slot while there is room for it.
function wheelItems(){const items=wheelStack.length?wheelStack.at(-1).children:currentMenu().items;return state.wheelAddSlot!==false&&items.length&&items.length<12?[...items,ADD_SLOT]:items;}
function wheelAddItem(){const items=wheelItems();return wheelForeground&&!items.some(item=>item.target===wheelForeground.target)?{kind:'app',name:wheelForeground.name,target:wheelForeground.target,icon:'app'}:null;}
function restackWheel(){let items=currentMenu().items;const next=[];for(const group of wheelStack){const found=items.find(item=>item.id===group.id&&item.kind==='group');if(!found)break;next.push(found);items=found.children;}wheelStack=next;}
async function addFromWheel(){
  clearWheelTimers();
  const groupPath=wheelStack.map(item=>item.id);
  if(!wheelAddItem()){wheelOpen=false;await api.openAddDialog(groupPath,currentMenu().id).catch(()=>api.closeWheel());return;}
  wheelBusy=true;
  try{const result=await api.addWheelAction(groupPath,currentMenu().id);state=await api.getState();restackWheel();wheelSelected=wheelItems().findIndex(item=>item.id===result.id);drawOverlay();}
  catch(error){toast(error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''),true);}
  finally{wheelBusy=false;}
}
function clearWheelTimers(){clearTimeout(wheelTimer);clearTimeout(groupTimer);wheelTimer=null;groupTimer=null;if(overlay)armSector(document,-1);}
function drawOverlay(animate=false){
  const group=wheelStack.at(-1),entries=wheelItems(),selected=entries[wheelSelected];
  const title=group?group.name:wheelContext||state.menus.length>1?currentMenu().name:'Orbit 2';
  renderWheel(document.querySelector('#overlay-wheel-content'),entries.filter(item=>item!==ADD_SLOT),{title,subtitle:!group&&wheelContext?'Меню програми':'',labels:state.wheelLabels!==false,numbers:wheelTrigger==='keyboard',selected:selected?.id,back:!!group,addSlot:entries.includes(ADD_SLOT)||(!entries.length&&state.wheelAddSlot!==false),addItem:wheelAddItem(),addSelected:selected===ADD_SLOT});
  hydrateAppIcons(document.querySelector('#overlay-wheel'));
  if(animate&&!state.reducedMotion){const w=document.querySelector('.wheel');w.classList.add('wheel-appear');}
}
function selectWheel(index,keyboard=false){
  if(index===wheelSelected)return;clearWheelTimers();wheelSelected=index;
  const items=wheelItems(),selected=items[index];
  document.querySelectorAll('[data-sector]').forEach(node=>node.classList.toggle('selected',node.dataset.sector===selected?.id));
  document.querySelectorAll('[data-wheel-id]').forEach(node=>node.classList.toggle('selected',node.dataset.wheelId===selected?.id));
  document.querySelectorAll('[data-add-slot]').forEach(node=>node.classList.toggle('selected',selected===ADD_SLOT));
  const addItem=wheelAddItem();
  setWheelCenter(document,selected===ADD_SLOT?{name:addItem?addItem.name:'Додати дію',kind:'add'}:selected||null);
  if(keyboard)(selected===ADD_SLOT?document.querySelector('.wheel-item.wheel-add'):[...document.querySelectorAll('.wheel-item[data-wheel-id]')].find(node=>node.dataset.wheelId===selected?.id))?.focus();
  // The "+" slot never activates by hovering, only by an explicit click, Enter or release.
  if(!selected||selected===ADD_SLOT||keyboard||wheelBusy)return;
  if(opensGroup(selected)){if(state.groupOpenMode!=='click'){groupTimer=setTimeout(()=>openWheelGroup(selected),300);armSector(document,index,items.length,300);}}
  else if(state.activationMode==='hover'&&wheelTrigger==='mouse'){wheelTimer=setTimeout(()=>commitWheel(),state.hoverDelay);armSector(document,index,items.length,state.hoverDelay);}
}
function openWheelGroup(item){
  if(!wheelOpen||wheelBusy)return;clearWheelTimers();wheelStack.push(item);wheelSelected=-1;transitionOrigin=mousePoint?{...mousePoint}:null;drawOverlay();
}
function wheelBack(){if(!wheelStack.length)return;clearWheelTimers();wheelStack.pop();wheelSelected=-1;transitionOrigin=mousePoint?{...mousePoint}:null;drawOverlay();}
async function commitWheel(){
  const item=wheelItems()[wheelSelected];if(!item||wheelBusy||!wheelOpen)return;if(opensGroup(item)){openWheelGroup(item);return;}if(item===ADD_SLOT){await addFromWheel();return;}
  clearWheelTimers();wheelBusy=true;wheelOpen=false;
  try{await api.closeWheel();const result=await api.executeAction(item);if(!result.ok){toast(result.error||'Не вдалося виконати дію',true);}}catch(error){toast(error.message,true);}finally{wheelBusy=false;}
}
function initOverlay(){
  document.body.classList.add('overlay');root.innerHTML='<div class="overlay-wheel" id="overlay-wheel"><div class="overlay-wheel-content" id="overlay-wheel-content"></div></div>';
  api.onWheelForeground?.(next=>{wheelForeground=next;if(wheelOpen&&wheelItems().includes(ADD_SLOT))drawOverlay();});
  api.onWheelMenu?.(payload=>{if(wheelOpen&&!wheelStack.length&&wheelSelected<0&&!wheelBusy&&state.menus.some(menu=>menu.id===payload.menuId)){overlayMenuId=payload.menuId;wheelContext=true;drawOverlay();}});
  api.onWheelOpen(payload=>{clearWheelTimers();wheelForeground=null;wheelTrigger=payload.trigger;overlayMenuId=payload.menuId||null;wheelContext=!!payload.context;wheelStack=[];wheelSelected=-1;wheelBusy=false;wheelOpen=true;mousePoint=null;transitionOrigin=null;const center=payload.center||{x:innerWidth/2,y:innerHeight/2};const mount=document.querySelector('#overlay-wheel');const size=payload.size??Math.min(state.wheelSize??520,innerWidth-30,innerHeight-60);mount.style.width=size+'px';mount.style.height=size+'px';mount.style.setProperty('--wheel-scale',size/520);mount.style.left=(center.x-size/2)+'px';mount.style.top=(center.y-size/2)+'px';drawOverlay(true);});
  api.onWheelClosed?.(()=>{clearWheelTimers();wheelOpen=false;wheelSelected=-1;});
  api.onTriggerRelease(()=>{if(!wheelOpen||wheelTrigger!=='mouse'||state.activationMode!=='release')return;if(wheelSelected>=0&&!opensGroup(wheelItems()[wheelSelected]))commitWheel();else if(!wheelStack.length){clearWheelTimers();wheelOpen=false;api.closeWheel();}});
  root.addEventListener('pointerdown',event=>{
    if(!wheelOpen||state.closeOnOutsideClick===false||![0,1,2].includes(event.button))return;
    const bounds=document.querySelector('#overlay-wheel').getBoundingClientRect();
    const distance=Math.hypot(event.clientX-bounds.left-bounds.width/2,event.clientY-bounds.top-bounds.height/2);
    if(distance>207*bounds.width/480){clearWheelTimers();wheelOpen=false;api.closeWheel();}
  });
  root.addEventListener('pointermove',event=>{
    if(!wheelOpen||wheelBusy)return;mousePoint={x:event.clientX,y:event.clientY};
    if(transitionOrigin&&Math.hypot(mousePoint.x-transitionOrigin.x,mousePoint.y-transitionOrigin.y)<12)return;transitionOrigin=null;
    const bounds=document.querySelector('#overlay-wheel').getBoundingClientRect(),scale=bounds.width/480;
    selectWheel(sectorAt((event.clientX-bounds.left-bounds.width/2)/scale,(event.clientY-bounds.top-bounds.height/2)/scale,wheelItems().length,88,225));
  });
  // Scrolling steps through the sectors; a right click goes one level up or closes the wheel.
  root.addEventListener('wheel',event=>{
    if(!wheelOpen||wheelBusy)return;event.preventDefault();
    const items=wheelItems();if(!items.length)return;
    const step=event.deltaY>0?1:-1,start=wheelSelected<0?(step>0?-1:items.length):wheelSelected;
    transitionOrigin=mousePoint?{...mousePoint}:null;
    selectWheel((start+step+items.length)%items.length);
  },{passive:false});
  root.addEventListener('contextmenu',event=>{
    if(!wheelOpen)return;event.preventDefault();
    if(wheelStack.length)wheelBack();else{clearWheelTimers();wheelOpen=false;api.closeWheel();}
  });
  root.addEventListener('click',event=>{const itemButton=event.target.closest('[data-wheel-id]'),sector=event.target.closest('[data-sector]');if(event.target.closest('[data-wheel-back]')){wheelBack();return;}if(event.target.closest('[data-add-slot]')){wheelSelected=wheelItems().indexOf(ADD_SLOT);if(wheelSelected<0&&!wheelItems().length){wheelOpen=false;api.openAddDialog(wheelStack.map(item=>item.id),currentMenu().id).catch(()=>api.closeWheel());return;}commitWheel();return;}if(itemButton||sector){const id=itemButton?.dataset.wheelId||sector.dataset.sector;wheelSelected=wheelItems().findIndex(i=>i.id===id);commitWheel();}});
}

async function init(){
  if(!api){root.innerHTML='<div class="empty-state"><h1>Orbit 2</h1><p>Відкрийте застосунок через Orbit2.exe або npm start.</p></div>';return;}
  state=await api.getState();runtime=await api.getRuntime();updateStatus=await api.getUpdateStatus();applyTheme();
  api.onUpdateStatus(next=>{updateStatus=next;if(!overlay)refreshUpdates(next);});
  // The window that saved already shows this state; redrawing it again would replace the DOM under the user.
  api.onStateChanged(next=>{if(JSON.stringify(next)===JSON.stringify(state))return;state=next;applyTheme();if(!overlay){trimGroupPath();render();}else if(wheelOpen&&!wheelBusy){clearWheelTimers();restackWheel();wheelSelected=-1;drawOverlay();}});
  api.onRuntimeChanged(next=>{runtime=next;if(!overlay&&!document.querySelector('.modal')&&!paletteOpen())render();});
  if(!overlay){
    usage=await api.getUsage().catch(()=>null);
    api.onUsageChanged?.(next=>{usage=next;if(page==='overview'&&!document.querySelector('.modal')&&!paletteOpen())render();});
    window.orbitHydrateIcons=hydrateAppIcons;
  }
  api.onNavigate(async next=>{
    const target=typeof next==='string'?{page:next}:next||{};
    if(!PAGES[target.page])return;
    if(target.menuId&&target.menuId!==state.activeMenuId&&state.menus.some(menu=>menu.id===target.menuId))await change({activeMenuId:target.menuId});
    page=target.page;
    if(Array.isArray(target.groupPath)){groupPath=target.groupPath.filter(id=>typeof id==='string');selectedId='';}
    closeModal?.();render();
    if(target.add)actionDialog();
  });
  api.onActionError?.(({error,actionId})=>{if(!overlay){selectedId=actionId;render();toast(error,true);}});
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(state.theme==='system'){applyTheme();if(!overlay)render();}});
  if(overlay)initOverlay();else render();
  document.documentElement.dataset.ready='true';
}
init().catch(error=>{root.innerHTML=`<div class="empty-state"><h1>Orbit 2</h1><p>${e(error.message)}</p></div>`;console.error(error);});
