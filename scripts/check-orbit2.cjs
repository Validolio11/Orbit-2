const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');

// Orbit 2 features end to end: keys and text actions, linked menus over a program, accent color,
// command palette, Overview statistics, backups and the wheel's live center and numbers.
(async()=>{
  const project=path.resolve(__dirname,'..');
  const shots=path.join(project,'output','playwright');await fs.mkdir(shots,{recursive:true});
  const app=await _electron.launch({args:[project,'--e2e'],executablePath:require('electron'),cwd:project});
  try{
    await app.firstWindow();let page;
    for(let n=0;n<100;n++){page=app.windows().find(w=>w.url().endsWith('/index.html'));if(page)break;await new Promise(r=>setTimeout(r,50));}
    if(!page)throw new Error('Main window missing');page.setDefaultTimeout(10000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.waitForSelector('html[data-ready="true"]');
    const state=()=>page.evaluate(()=>window.orbit.getState());
    const dialog=()=>page.getByRole('dialog');
    const waitSave=()=>page.waitForSelector('#modal-root:empty',{state:'attached'});
    const shot=name=>page.screenshot({path:path.join(shots,`orbit2-${name}.png`)});

    await page.locator('.intro-card.hero').waitFor();
    assert.equal(await page.title(),'Orbit 2');
    assert.equal((await state()).version,2);
    await shot('menus');
    await page.locator('[data-command="dismiss-intro"]').click();
    console.log('PASS: Orbit 2 shell, version 2 settings and welcome card');

    // A "keys" action recorded from the keyboard, then a preset.
    await page.locator('.panel-head [data-command="add-action"]').click();
    await dialog().locator('[data-kind="keys"]').click();
    await dialog().locator('#action-target').focus();
    await page.keyboard.press('Control+Shift+KeyT');
    assert.equal(await dialog().locator('#action-target').inputValue(),'Ctrl+Shift+T');
    assert.equal(await dialog().locator('.shortcut-keys .keycap').count(),3);
    await dialog().locator('#action-name').fill('Відновити вкладку');
    await shot('keys-dialog');
    await dialog().getByRole('button',{name:'Додати дію',exact:true}).click();await waitSave();
    let items=(await state()).menus[0].items;
    assert.deepEqual(items.filter(item=>item.kind==='keys').map(item=>[item.name,item.target]),[['Відновити вкладку','Ctrl+Shift+T']]);
    await page.locator('.action-desc').filter({hasText:'Клавіші · Ctrl+Shift+T'}).waitFor();
    console.log('PASS: keyboard shortcut action recorded from real key presses');

    // A text snippet named after its first line.
    await page.locator('.panel-head [data-command="add-action"]').click();
    await dialog().locator('[data-kind="text"]').click();
    await dialog().locator('#action-target').fill('З повагою,\nІван');
    await dialog().getByRole('button',{name:'Додати дію',exact:true}).click();await waitSave();
    items=(await state()).menus[0].items;
    const snippet=items.find(item=>item.kind==='text');
    assert.deepEqual([snippet.name,snippet.target],['З повагою,','З повагою,\nІван']);
    console.log('PASS: text snippet action keeps line breaks and takes its name from the first line');

    // A second menu linked to a program opens over that program.
    await page.locator('[data-command="new-menu"]').click();
    await page.getByLabel('Назва меню',{exact:true}).fill('Фотошоп');
    await page.locator('#menu-app-input').fill('Photoshop');await page.locator('#menu-app-input').press('Enter');
    await page.locator('.app-chip').filter({hasText:'photoshop.exe'}).waitFor();
    await shot('menu-dialog');
    await dialog().getByRole('button',{name:'Створити меню',exact:true}).click();await waitSave();
    let saved=await state();
    const linked=saved.menus.find(menu=>menu.name==='Фотошоп');
    assert.deepEqual(linked.apps,['photoshop.exe']);
    await page.locator('.menu-tab .tab-link').waitFor();
    await page.getByRole('tab',{name:/Головне меню/}).click();
    await page.waitForFunction(()=>window.orbit.getState().then(value=>value.activeMenuId==='main'));
    await app.evaluate(()=>globalThis.__orbitE2E.showWheel(undefined,'C:\\Program Files\\Adobe\\Photoshop.exe'));
    const overlay=app.windows().find(w=>w.url().includes('overlay=1'));overlay.setDefaultTimeout(10000);
    overlay.on('pageerror',error=>errors.push(error.message));
    await overlay.waitForFunction(()=>document.querySelector('.wheel-center [data-center-title]')?.textContent==='Фотошоп');
    assert.equal(await overlay.locator('.wheel-center [data-center-sub]').textContent(),'Меню програми');
    await overlay.keyboard.press('Escape');
    await app.evaluate(()=>globalThis.__orbitE2E.showWheel(undefined,'C:\\Windows\\notepad.exe'));
    await overlay.waitForFunction(()=>document.querySelector('.wheel-center [data-center-title]')?.textContent==='Головне меню');
    await overlay.keyboard.press('Escape');
    console.log('PASS: a menu linked to photoshop.exe opens over Photoshop and the active menu elsewhere');

    // The wheel previews the selected action in its center.
    await page.locator('[data-command="preview"]').first().click();
    await overlay.locator('.wheel').waitFor();
    await overlay.evaluate(()=>document.querySelector('.wheel').getAnimations({subtree:true}).forEach(animation=>animation.finish()));
    await overlay.evaluate(()=>{window.__guard=new AbortController();document.addEventListener('pointermove',event=>event.stopImmediatePropagation(),{capture:true,signal:window.__guard.signal});});
    const firstName=(await state()).menus.find(menu=>menu.id==='main').items[0].name;
    await overlay.locator('.wheel-center').click();
    await overlay.keyboard.press('ArrowRight');
    await overlay.waitForFunction(name=>document.querySelector('[data-center-title]').textContent===name,firstName);
    assert.equal(await overlay.locator('.wheel-center.previewing').count(),1);
    await overlay.screenshot({path:path.join(shots,'orbit2-wheel.png')});
    await overlay.evaluate(()=>window.__guard.abort());
    await overlay.keyboard.press('Escape');
    console.log('PASS: wheel center previews the selected action');

    // Accent color and wheel labels.
    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-accent="violet"]').click();
    await page.waitForFunction(()=>document.documentElement.dataset.accent==='violet');
    assert.equal((await state()).accent,'violet');
    await page.getByRole('switch',{name:'Підписи на колесі',exact:true}).click();
    await page.waitForFunction(()=>window.orbit.getState().then(value=>value.wheelLabels===false));
    await page.getByRole('switch',{name:'Підписи на колесі',exact:true}).click();
    // The first saves of the day left an automatic backup.
    await page.locator('#backup-list .backup-row').first().waitFor();
    await page.locator('[data-command="create-backup"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('#backup-list .backup-row').length>=2);
    await shot('settings');
    // Restoring the morning copy brings back the state before today's changes and keeps the current one.
    const before=(await state()).menus.length;
    await page.locator('#backup-list [data-restore-backup]').last().click();
    await dialog().locator('#confirm-restore').click();await waitSave();
    assert.ok((await state()).menus.length<before);
    console.log('PASS: accent color, wheel labels, automatic and manual backups, restore');

    // Command palette: open with Ctrl+K, filter, run a page command.
    await page.keyboard.press('Control+KeyK');
    await page.locator('.palette').waitFor();
    await page.locator('#palette-input').fill('огляд');
    await page.locator('.palette-item.active').filter({hasText:'Огляд'}).waitFor();
    await shot('palette');
    await page.keyboard.press('Enter');
    await page.locator('.palette').waitFor({state:'detached'});
    await page.locator('h1').filter({hasText:'Огляд'}).waitFor();
    console.log('PASS: Ctrl+K palette filters and navigates');

    // Overview shows real recorded launches.
    saved=await state();
    const target=saved.menus.find(menu=>menu.id===saved.activeMenuId).items.find(item=>item.kind!=='group');
    await app.evaluate(async(_,id)=>{for(let n=0;n<3;n++)await globalThis.__orbitE2E.recordUsage(id);},target.id);
    await page.locator('.overview-row').filter({hasText:target.name}).filter({hasText:'3×'}).waitFor();
    assert.equal(await page.locator('.activity-day.today .activity-value').textContent(),'3');
    await shot('overview');
    await page.locator('[data-page="library"]').click();
    await page.locator('[data-library-kind="system"]').click();
    await page.locator('[data-library-sort="popular"]').click();
    await page.locator('.library-list .action-row').first().waitFor();
    await shot('library');
    console.log('PASS: Overview statistics, library type filter and popularity sort');

    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-theme-value="light"]').click();
    await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
    await page.locator('[data-page="menus"]').click();
    await shot('menus-light');
    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-theme-value="dark"]').click();
    assert.deepEqual(errors,[]);
    console.log('ORBIT2_OK');
  }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
