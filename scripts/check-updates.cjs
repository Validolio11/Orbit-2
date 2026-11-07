const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');

(async()=>{
  const project=path.resolve(__dirname,'..');
  const packaged=process.argv.includes('--packaged');
  const app=await _electron.launch({args:packaged?['--e2e']:[project,'--e2e'],executablePath:packaged?path.join(project,'dist','Orbit2-win32-x64','Orbit2.exe'):require('electron'),cwd:project});
  try{
    await app.firstWindow();let page;
    for(let n=0;n<100;n++){page=app.windows().find(p=>p.url().endsWith('/index.html'));if(page)break;await new Promise(r=>setTimeout(r,50));}
    if(!page)throw new Error('Main window missing');page.setDefaultTimeout(15000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.waitForSelector('html[data-ready="true"]');
    await app.evaluate(({ipcMain,BrowserWindow,shell})=>{
      const main=BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('overlay=1'));
      main.webContents.setBackgroundThrottling(false);main.setSize(1180,900);main.hide();
      const qa=globalThis.__orbitUpdatesQA={status:{phase:'idle',currentVersion:'7.4.2'},calls:{check:0,download:0,install:0},external:[],pending:{}};
      qa.publish=patch=>{
        qa.status={currentVersion:'7.4.2',...patch};
        for(const window of BrowserWindow.getAllWindows())window.webContents.send('orbit:update-status',qa.status);
        return qa.status;
      };
      for(const channel of ['orbit:get-update-status','orbit:check-updates','orbit:download-update','orbit:install-update'])ipcMain.removeHandler(channel);
      ipcMain.handle('orbit:get-update-status',()=>qa.status);
      for(const [action,phase] of [['check','checking'],['download','downloading'],['install','installing']]){
        ipcMain.handle(`orbit:${action==='check'?'check-updates':action+'-update'}`,()=>{
          qa.calls[action]++;
          qa.publish({phase,version:action==='check'?undefined:'7.5.0',progress:0});
          return new Promise(resolve=>{qa.pending[action]=patch=>resolve(qa.publish(patch));});
        });
      }
      // Exercise the production repository IPC handler while preventing a real browser launch.
      shell.openExternal=async url=>{qa.external.push(url);};
    });
    await page.reload();await page.waitForSelector('html[data-ready="true"]');
    await page.locator('[data-page="settings"]').click();
    const section=page.locator('#app-updates');
    const check=()=>section.locator('[data-command="check-updates"]');
    const action=()=>section.locator('[data-update-action]');
    const message=()=>section.locator('#update-message');
    const publish=patch=>app.evaluate((_,patch)=>globalThis.__orbitUpdatesQA.publish(patch),patch);
    const finish=(name,patch)=>app.evaluate((_,{name,patch})=>{
      const qa=globalThis.__orbitUpdatesQA;
      if(!qa.pending[name])throw new Error(`Missing pending ${name}`);
      qa.pending[name](patch);delete qa.pending[name];
    },{name,patch});
    const waitMessage=text=>page.waitForFunction(text=>document.querySelector('#update-message')?.textContent===text,text);
    const screenshot=async filename=>{
      await page.evaluate(()=>document.fonts.ready);
      await app.evaluate(({BrowserWindow})=>{
        const window=BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('overlay=1'));
        window.show();
      });
      try{await page.screenshot({path:filename,timeout:10000});}
      finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('overlay=1')).hide());}
    };
    assert.equal(await section.locator('[data-update-version]').textContent(),'Встановлено 7.4.2','Installed version must come from the native updater');
    assert.equal(await page.locator('.title-brand .version').textContent(),'7.4.2');
    await section.locator('[data-command="open-update-repository"]').click();
    assert.deepEqual(await app.evaluate(()=>globalThis.__orbitUpdatesQA.external),['https://github.com/Validolio11/Orbit-2']);

    await check().click();await waitMessage('Перевіряємо нові версії…');
    assert.equal(await check().isDisabled(),true,'Checking must disable repeated requests');
    assert.equal(await action().isVisible(),false);
    await finish('check',{phase:'up-to-date'});await waitMessage('Встановлено останню версію.');
    assert.equal(await check().isEnabled(),true);
    assert.equal(await action().isVisible(),false);
    console.log('PASS: native version, fixed repository link, checking and no update');

    await check().click();await waitMessage('Перевіряємо нові версії…');
    await finish('check',{phase:'available',version:'7.5.0'});await waitMessage('Доступна версія 7.5.0.');
    assert.equal(await action().textContent(),'Завантажити');
    await page.evaluate(()=>{window.__updatesSection=document.querySelector('#app-updates');window.__settingsSection=document.querySelector('.settings-section');});
    await action().click();await waitMessage('Завантаження 0%…');
    assert.equal(await action().isDisabled(),true);
    assert.equal(await check().isDisabled(),true);
    for(const progress of [17,63,100]){
      await publish({phase:'downloading',version:'7.5.0',progress});await waitMessage(`Завантаження ${progress}%…`);
      const bar=section.getByRole('progressbar',{name:'Завантаження оновлення'});
      assert.equal(await bar.isVisible(),true);
      assert.equal(await bar.evaluate(el=>el.value),progress);
      assert.equal(await page.evaluate(()=>window.__updatesSection===document.querySelector('#app-updates')&&window.__settingsSection===document.querySelector('.settings-section')),true,'Progress must preserve the existing settings DOM');
    }
    await finish('download',{phase:'ready',version:'7.5.0'});await waitMessage('Оновлення готове. Під час встановлення Orbit перезапуститься.');
    assert.equal(await action().textContent(),'Установити й перезапустити');
    assert.equal(await action().isEnabled(),true);
    assert.equal(await check().isVisible(),false);
    assert.equal(await section.locator('progress').isVisible(),false);
    await page.locator('[data-theme-value="dark"]').click();
    await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
    await section.scrollIntoViewIfNeeded();
    const output=path.join(project,'output','playwright');await fs.mkdir(output,{recursive:true});
    await screenshot(path.join(output,'updates-dark-ready.png'));
    console.log('PASS: available, download progress, stable settings DOM and ready state');

    await action().click();await waitMessage('Установлюємо оновлення…');
    assert.equal(await action().isDisabled(),true);
    await finish('install',{phase:'error',version:'7.5.0',message:'Не вдалося встановити оновлення. Закрийте програми й спробуйте ще раз.'});
    await waitMessage('Не вдалося встановити оновлення. Закрийте програми й спробуйте ще раз.');
    assert.equal(page.isClosed(),false,'Install failure must keep the application open');
    assert.equal(await check().isEnabled(),true);
    assert.equal(await action().isVisible(),false);
    assert.equal(await message().evaluate(el=>el.classList.contains('update-error')),true);

    await check().click();await waitMessage('Перевіряємо нові версії…');
    await finish('check',{phase:'error',message:'Немає з’єднання з GitHub. Перевірте інтернет і спробуйте ще раз.'});
    await waitMessage('Немає з’єднання з GitHub. Перевірте інтернет і спробуйте ще раз.');
    assert.equal(await check().isEnabled(),true,'Network errors must allow retry');
    await page.locator('[data-theme-value="light"]').click();
    await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('overlay=1')).setSize(1050,720));
    await section.scrollIntoViewIfNeeded();
    await screenshot(path.join(output,'updates-light-error.png'));
    await check().click();await waitMessage('Перевіряємо нові версії…');
    await finish('check',{phase:'up-to-date'});await waitMessage('Встановлено останню версію.');
    assert.equal(await message().evaluate(el=>el.classList.contains('update-error')),false,'Retry success must clear error styling');
    assert.deepEqual(await app.evaluate(()=>globalThis.__orbitUpdatesQA.calls),{check:4,download:1,install:1});
    assert.deepEqual(errors,[]);
    console.log('PASS: install error keeps Orbit open, network failure and successful retry; no renderer errors');
    console.log('ORBIT_UPDATES_UI_OK');
  }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
