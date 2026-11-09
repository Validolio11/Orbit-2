import {escapeHTML as e} from './wheel.mjs';

function view(status){
  const busy=['checking','downloading','installing'].includes(status.phase);
  const messages={idle:'Перевірте, чи доступна нова версія.',checking:'Перевіряємо нові версії…',available:`Доступна версія ${status.version||''}.`,'up-to-date':'Встановлено останню версію.',downloading:`Завантаження ${Math.round(status.progress||0)}%…`,ready:'Оновлення готове. Під час встановлення Orbit 2 перезапуститься.',installing:'Установлюємо оновлення…',error:'Не вдалося перевірити оновлення. Спробуйте ще раз.'};
  return {busy,message:status.message||messages[status.phase]||messages.idle,
    checkHidden:['ready','installing'].includes(status.phase),
    actionHidden:!['available','downloading','ready','installing'].includes(status.phase),
    install:['ready','installing'].includes(status.phase),
    progress:Math.max(0,Math.min(100,Number(status.progress)||0))};
}

export function updatesSettings(status){
  const v=view(status);
  return `<section class="settings-section" id="app-updates"><div class="section-intro"><h2>Оновлення</h2><p>Нові версії Orbit 2 з GitHub.</p></div><div class="setting-row"><div class="setting-label update-copy"><strong data-update-version>Встановлено ${e(status.currentVersion)}</strong><p id="update-message" role="status" aria-live="polite" aria-atomic="true" class="${status.phase==='error'?'update-error':''}">${e(v.message)}</p><progress class="update-progress" max="100" value="${v.progress}" aria-label="Завантаження оновлення" ${status.phase==='downloading'?'':'hidden'}></progress></div><div class="update-actions"><button class="btn" data-command="check-updates" ${v.busy?'disabled':''} ${v.checkHidden?'hidden':''}>${status.phase==='checking'?'Перевіряємо…':'Перевірити оновлення'}</button><button class="btn primary" data-update-action data-command="${v.install?'install-update':'download-update'}" ${v.busy?'disabled':''} ${v.actionHidden?'hidden':''}>${v.install?'Установити й перезапустити':status.phase==='downloading'?'Завантажуємо…':'Завантажити'}</button></div></div><div class="update-source"><span>Меню та налаштування зберігаються.</span><button class="btn small ghost" data-command="open-update-repository">GitHub · Validolio11/Orbit-2 ↗</button></div></section>`;
}

export function refreshUpdates(status){
  const section=document.querySelector('#app-updates');if(!section)return;
  const v=view(status),check=section.querySelector('[data-command="check-updates"]'),action=section.querySelector('[data-update-action]'),message=section.querySelector('#update-message'),progress=section.querySelector('progress');
  section.querySelector('[data-update-version]').textContent='Встановлено '+status.currentVersion;
  if(message.textContent!==v.message)message.textContent=v.message;
  message.classList.toggle('update-error',status.phase==='error');
  check.hidden=v.checkHidden;check.disabled=v.busy;check.textContent=status.phase==='checking'?'Перевіряємо…':'Перевірити оновлення';
  action.hidden=v.actionHidden;action.disabled=v.busy;action.dataset.command=v.install?'install-update':'download-update';
  action.textContent=v.install?'Установити й перезапустити':status.phase==='downloading'?'Завантажуємо…':'Завантажити';
  progress.hidden=status.phase!=='downloading';progress.value=v.progress;
}
