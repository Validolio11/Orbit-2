const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');

(async()=>{
  const project = path.resolve(__dirname, '..');
  const packaged=process.argv.includes('--packaged');
  const app = await _electron.launch({args:packaged?['--e2e']:[project,'--e2e'],executablePath:packaged?path.join(project,'dist','Orbit2-win32-x64','Orbit2.exe'):require('electron'),cwd:project});
  const errors=[];
  try {
    await app.firstWindow();
    let page;
    for(let attempt=0;attempt<100;attempt++){
      page=app.windows().find(window=>window.url().endsWith('/index.html'));
      if(page)break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    if(!page)throw new Error('Main Orbit window did not load.');
    page.setDefaultTimeout(7000);
    await page.waitForSelector('html[data-ready="true"]');
    for(const window of app.windows())window.on('pageerror',error=>errors.push(error.message));
    const dialog=()=>page.getByRole('dialog');
    const command=name=>page.locator(`[data-command="${name}"]`);
    const modalButton=name=>dialog().getByRole('button',{name,exact:true});
    const waitSave=async()=>page.waitForSelector('#modal-root:empty',{state:'attached'});
    console.log('PASS: initial renderer and isolated IPC bridge');

    await command('new-menu').click();await page.getByLabel('Назва меню',{exact:true}).fill('QA меню');await modalButton('Створити меню').click();await waitSave();
    await command('rename-menu').click();await page.getByLabel('Назва меню',{exact:true}).fill('QA робоче');await modalButton('Зберегти').click();await waitSave();
    await page.getByRole('tab',{name:'QA робоче'}).waitFor();
    const add=async(kind,name,target)=>{
      await page.locator('.panel-head [data-command="add-action"]').click();
      await dialog().locator(`[data-kind="${kind}"]`).click();
      // While adding a program or folder, its name and path are edited under the advanced section.
      if(['app','folder','script'].includes(kind))await dialog().locator('.app-advanced>summary').click();
      if(kind!=='system')await dialog().locator('#action-name').fill(name);
      else assert.equal(await dialog().locator('#action-name').count(),0,'Windows commands take the tile name');
      if(kind==='system')await dialog().locator(`[data-system="${target}"]`).click();
      else if(kind!=='group')await dialog().locator('#action-target').fill(target);
      await modalButton(kind==='group'?'Створити групу':'Додати дію').click();await waitSave();
      if(kind==='group'){
        // A new group opens at once with its Add button focused.
        await page.locator('[data-command="group-back"]').waitFor();
        assert.equal(await page.locator('#preview-wheel .wheel-center strong').textContent(),name);
        assert.equal(await page.evaluate(()=>document.activeElement?.dataset.command),'add-action');
        await page.locator('[data-command="group-back"]').click();
      }
      await page.locator('.action-name').filter({hasText:name}).waitFor();
    };
    await add('folder','QA папка',project);
    await add('app','QA програма','C:\\Missing\\Application.exe');
    await add('script','QA скрипт',path.join(project,'scripts','check-ui.cjs'));
    await add('system','Вимкнути / увімкнути звук','mute');
    await add('group','QA група','');
    let saved=await page.evaluate(()=>window.orbit.getState());
    assert.equal(saved.menus.find(m=>m.id===saved.activeMenuId).items.length,5);
    await page.reload();await page.waitForSelector('html[data-ready="true"]');
    assert.equal(await page.locator('.action-list .action-row').count(),5);
    await page.locator('#preview-wheel .wheel-add').click();await dialog().getByRole('heading',{name:'Додати дію'}).waitFor();
    await page.waitForFunction(()=>!document.getAnimations().some(animation=>animation.playState==='running'));
    await page.keyboard.press('Escape');await page.keyboard.press('Escape');await waitSave();
    console.log('PASS: create/rename menu, all five action types, new group opens, add sector, persistence after reload');

    await page.getByRole('button',{name:'Відкрити групу QA група',exact:true}).click();
    await add('system','Параметри Windows','settings');
    await page.locator('[data-command="group-back"]').click();
    saved=await page.evaluate(()=>window.orbit.getState());
    const qaItems=saved.menus.find(menu=>menu.id===saved.activeMenuId).items;
    const qaGroup=qaItems.find(item=>item.name==='QA група'),qaChild=qaGroup.children[0],qaFolder=qaItems.find(item=>item.name==='QA папка');
    const groupRow=()=>page.locator(`.action-list [data-row-id="${qaGroup.id}"]`);
    const expectNestedPreview=async()=>{
      await page.locator(`#preview-wheel [data-wheel-id="${qaChild.id}"]`).waitFor();
      assert.equal(await page.locator('#preview-wheel [data-wheel-id]').count(),1);
      assert.equal(await dialog().count(),0,'Opening a preview group must not open the editor');
    };
    // Click the group icon itself, then the center to return to the parent wheel.
    await page.locator(`#preview-wheel [data-wheel-id="${qaGroup.id}"] svg`).click();
    await expectNestedPreview();
    await page.locator('#preview-wheel [data-wheel-back]').click();
    await groupRow().waitFor();
    // Aim at the exposed outer ring of the SVG sector, away from its icon button.
    const sectorPoint=await page.locator(`#preview-wheel [data-sector="${qaGroup.id}"]`).evaluate(sector=>{
      const sectors=[...sector.parentElement.querySelectorAll('.wheel-sector')];
      const angle=(-90+sectors.indexOf(sector)*360/sectors.length)*Math.PI/180;
      const bounds=sector.closest('svg').getBoundingClientRect();
      return{x:bounds.left+bounds.width*(.5+195*Math.cos(angle)/480),y:bounds.top+bounds.height*(.5+195*Math.sin(angle)/480)};
    });
    await page.mouse.click(sectorPoint.x,sectorPoint.y);
    await expectNestedPreview();
    await command('group-back').click();
    await groupRow().locator('.action-copy').click();
    await expectNestedPreview();
    await command('group-back').click();
    await groupRow().focus();await groupRow().press('Enter');
    await expectNestedPreview();
    await command('group-back').click();
    // The explicit pencil remains the group editor, and ordinary actions still edit.
    await groupRow().locator(`[data-edit-id="${qaGroup.id}"]`).click();
    await dialog().waitFor();assert.equal(await dialog().locator('#action-name').inputValue(),'QA група');
    await modalButton('Скасувати').click();
    await page.locator(`#preview-wheel [data-wheel-id="${qaFolder.id}"]`).click();
    await dialog().waitFor();assert.equal(await dialog().locator('#action-name').inputValue(),'QA папка');
    await modalButton('Скасувати').click();
    console.log('PASS: preview group icon/sector and row click/Enter open children; center/back return; group pencil and ordinary actions edit');
    const before=(await page.locator('.action-name').allTextContents());
    await page.getByRole('button',{name:'Перемістити QA група вище',exact:true}).click();
    // The list redraws once the move is saved to disk.
    await page.waitForFunction(previous=>JSON.stringify([...document.querySelectorAll('.action-name')].map(node=>node.textContent))!==previous,JSON.stringify(before));
    const after=await page.locator('.action-name').allTextContents();
    assert.notDeepEqual(after,before);
    await command('duplicate-menu').click();
    await page.getByRole('tab',{name:'QA робоче — копія'}).waitFor();
    saved=await page.evaluate(()=>window.orbit.getState());
    const allIds=[];const walk=items=>items.forEach(item=>{allIds.push(item.id);walk(item.children||[])});saved.menus.forEach(m=>walk(m.items));assert.equal(allIds.length,new Set(allIds).size);
    await command('delete-menu').click();await dialog().locator('#confirm-delete').click();await waitSave();
    console.log('PASS: nested group, reorder, duplicate nested IDs, delete menu');

    await page.locator('[data-page="library"]').click();
    await page.getByLabel('Знайти дію',{exact:true}).fill('Документи');
    assert.equal(await page.locator('.library-list .action-row').count(),1);
    await page.getByLabel('Знайти дію',{exact:true}).fill('no-such-action-123');
    await page.getByText('Дій не знайдено',{exact:true}).waitFor();
    await page.locator('[data-page="controls"]').click();
    await page.getByLabel('Кнопка виклику').selectOption('5');
    // Mouse 5 (forward) is the upper side button on the diagram, Mouse 4 (back) the lower one.
    await page.locator('.mouse-side.forward.active').waitFor();
    assert.equal(await page.locator('.mouse-side.back.active').count(),0);
    await page.getByLabel('Спосіб запуску').selectOption('hover');
    await page.getByLabel('Затримка наведення').selectOption('500');
    await page.getByRole('switch',{name:'Orbit у фоновому режимі',exact:true}).click();
    await page.getByRole('switch',{name:'Orbit у фоновому режимі',exact:true}).click();
    await page.getByLabel('Кнопка виклику').selectOption('4');
    await page.locator('.mouse-side.back.active').waitFor();
    assert.equal(await page.locator('.mouse-side.forward.active').count(),0);
    await page.getByLabel('Спосіб запуску').selectOption('click');
    await page.getByLabel('Спосіб запуску').selectOption('release');
    console.log('PASS: search/empty search, Mouse4/5, hover/release/click, hover delay, enabled round trip');

    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-theme-value="light"]').click();
    await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
    await page.locator('[data-theme-value="system"]').click();
    await page.locator('[data-theme-value="dark"]').click();
    await page.getByRole('switch',{name:'Зменшити анімації',exact:true}).click();
    await page.getByRole('switch',{name:'Зменшити анімації',exact:true}).click();
    await page.locator('[data-page="menus"]').click();
    // Fresh profiles get an Adobe group only when Adobe is installed; the overlay checks below need one.
    saved=await page.evaluate(()=>window.orbit.getState());
    const mainMenu=saved.menus.find(menu=>menu.id==='main');
    if(!mainMenu.items.some(item=>item.id==='adobe')){
      mainMenu.items.unshift({id:'adobe',name:'Adobe',kind:'group',target:'',args:'',icon:'adobe',children:[['illustrator','Illustrator'],['after-effects','After Effects'],['photoshop','Photoshop']].map(([id,name])=>({id,name,kind:'app',target:`C:\\Adobe\\${name}.exe`,args:'',icon:id,children:[]}))});
      await page.evaluate(next=>window.orbit.saveState(next),saved);
    }
    await page.getByRole('tab',{name:'Головне меню'}).click();
    await command('preview').click();
    const overlay=app.windows().find(w=>w.url().includes('overlay=1'));overlay.setDefaultTimeout(7000);
    await overlay.locator('[data-wheel-id="adobe"]').click();
    await overlay.locator('[data-wheel-id="illustrator"]').waitFor();
    await overlay.keyboard.press('Backspace');
    await overlay.locator('[data-wheel-id="adobe"]').waitFor();
    await overlay.keyboard.press('Escape');
    const overlayVisible=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('overlay=1')).isVisible());
    assert.equal(overlayVisible,false);
    console.log('PASS: light/system/dark theme, reduced motion round trip, global overlay/group/back/Escape');

    // The shared Windows desktop can deliver unrelated physical mouse movement, including the
    // move that selects whatever sector sits under the cursor when the wheel appears.
    // Isolate it before opening, only for this keyboard scenario; the mouse scenarios run unguarded.
    await overlay.evaluate(()=>{
      window.__orbitKeyboardPointerGuard=new AbortController();
      document.addEventListener('pointermove',event=>event.stopImmediatePropagation(),{capture:true,signal:window.__orbitKeyboardPointerGuard.signal});
    });
    const previousWheel=await overlay.locator('.wheel').elementHandle();
    await command('preview').click();
    await overlay.waitForFunction(previous=>!previous.isConnected,previousWheel);
    await previousWheel.dispose();
    await overlay.bringToFront();
    try{
      await overlay.locator('.wheel').evaluate(async wheel=>{
        await Promise.all(wheel.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})));
      });
      await overlay.locator('.wheel-center').click();
      await overlay.waitForFunction(()=>document.hasFocus()&&document.visibilityState==='visible');
      await overlay.keyboard.press('ArrowRight');
      await overlay.locator('[data-sector="adobe"].selected').waitFor();
      await overlay.keyboard.press('Enter');
      await overlay.locator('[data-wheel-id="illustrator"]').waitFor();
      await overlay.keyboard.press('Escape');
    }finally{
      await overlay.evaluate(()=>{window.__orbitKeyboardPointerGuard?.abort();delete window.__orbitKeyboardPointerGuard;});
    }
    assert.deepEqual(errors,[]);
    const metrics=await page.evaluate(()=>({width:innerWidth,height:innerHeight,workspaceClient:document.querySelector('.workspace').clientHeight,workspaceScroll:document.querySelector('.workspace').scrollHeight}));
    console.log('PASS: keyboard sector/group selection; no renderer errors');console.log(JSON.stringify(metrics));
    const visibility=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('overlay=1')).isVisible());
    const waitVisibility=async expected=>{
      for(let attempt=0;attempt<100;attempt++){
        if(await visibility()===expected)return;
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.equal(await visibility(),expected);
    };
    await page.getByRole('button',{name:'Налаштування',exact:true}).click();
    const outsideToggle=()=>page.getByRole('switch',{name:'Закривати меню натисканням поза ним',exact:true});
    assert.equal(await outsideToggle().getAttribute('aria-checked'),'true');
    await outsideToggle().click();
    await page.reload();await page.waitForSelector('html[data-ready="true"]');
    assert.equal((await page.evaluate(()=>window.orbit.getState())).closeOnOutsideClick,false);
    await command('preview').click();await waitVisibility(true);
    await overlay.mouse.click(50,50);assert.equal(await visibility(),true);
    await overlay.keyboard.press('Escape');await waitVisibility(false);
    await page.getByRole('button',{name:'Налаштування',exact:true}).click();await outsideToggle().click();
    await page.getByRole('button',{name:'Мої меню',exact:false}).first().click();
    await command('preview').click();await waitVisibility(true);
    await overlay.mouse.click(300,300);assert.equal(await visibility(),true);
    await overlay.mouse.click(50,50);await waitVisibility(false);
    console.log('PASS: outside-click setting persistence/on/off, center stays open, wheel-square corner dismisses, Escape always works');
    await page.getByRole('button',{name:'Налаштування',exact:true}).click();
    const sizeSlider=()=>page.getByRole('slider',{name:'Розмір кола',exact:true});
    const waitSize=size=>page.waitForFunction(expected=>window.orbit.getState().then(value=>value.wheelSize===expected),size);
    assert.equal(await sizeSlider().inputValue(),'100');
    await sizeSlider().focus();await sizeSlider().press('Home');await waitSize(312);
    await page.waitForFunction(()=>document.activeElement?.id==='wheel-size');
    assert.equal(await page.locator('#wheel-size-value').textContent(),'60%');
    await page.reload();await page.waitForSelector('html[data-ready="true"]');
    await page.getByRole('button',{name:'Налаштування',exact:true}).click();
    assert.equal(await sizeSlider().inputValue(),'60');
    const wheelBounds=()=>overlay.locator('#overlay-wheel').boundingBox();
    const checkWheelSize=async expected=>{
      await waitVisibility(true);
      await overlay.waitForFunction(size=>Math.abs(document.querySelector('#overlay-wheel').getBoundingClientRect().width-size)<1,expected);
      const box=await wheelBounds();
      const center={x:box.x+box.width/2,y:box.y+box.height/2};
      await overlay.mouse.click(center.x,center.y);assert.equal(await visibility(),true);
      await overlay.mouse.click(center.x+box.width*207/480+8,center.y);await waitVisibility(false);
      return box;
    };
    await command('preview').click();const smallWheel=await checkWheelSize(312);
    await sizeSlider().focus();await sizeSlider().press('End');await waitSize(780);
    await command('preview').click();
    const fittedSize=await app.evaluate(({BrowserWindow})=>{
      const b=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('overlay=1')).getBounds();
      return Math.min(780,b.width-30,b.height-60);
    });
    const largeWheel=await checkWheelSize(fittedSize);assert.ok(largeWheel.width>smallWheel.width);
    await page.locator('[data-command="reset-wheel-size"]').click();await waitSize(520);
    assert.equal(await sizeSlider().inputValue(),'100');
    assert.equal(await page.locator('[data-command="reset-wheel-size"]').isDisabled(),true);
    await command('preview').click();await checkWheelSize(520);
    console.log('PASS: wheel size slider keyboard/min/max/reset, persistence, screen fitting and outside-click geometry');
    // Exercise import/export through the actual controls and IPC, substituting
    // only the OS picker destination with a temporary file in test userData.
    const exported=await app.evaluate(({app,dialog})=>{
      const p=app.getPath('userData')+'/qa-export.json';
      dialog.showSaveDialog=async()=>({canceled:false,filePath:p});
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:[p]});
      return p;
    });
    await page.locator('[data-page="settings"]').click();
    await command('export').click();
    await page.getByRole('status').filter({hasText:'Налаштування експортовано'}).waitFor();
    const file=JSON.parse(await fs.readFile(exported,'utf8'));assert.equal(file.version,2);
    await command('import').click();await dialog().locator('#confirm-import').click();await waitSave();
    await page.getByRole('status').filter({hasText:'Налаштування імпортовано'}).waitFor();
    await page.locator('[data-page="menus"]').click();
    await page.getByRole('button',{name:'Відкрити групу Adobe',exact:true}).click();
    await page.locator('[data-edit-id="illustrator"]').click();
    await dialog().locator('#delete-action').click();await dialog().locator('#confirm-delete').click();await waitSave();
    assert.equal(await page.locator('.action-list .action-row').count(),2);
    await page.locator('[data-command="group-back"]').click();
    console.log('PASS: JSON export/import through IPC, action deletion; native picker path substituted for isolation');
    await fs.mkdir(path.join(project,'output','playwright'),{recursive:true});
    await page.screenshot({path:path.join(project,'output','playwright','verified-dark.png')});
    console.log('ORBIT_UI_OK');
  } finally {await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
