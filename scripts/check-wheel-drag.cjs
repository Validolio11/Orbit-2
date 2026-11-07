const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');

(async()=>{
  const project=path.resolve(__dirname,'..'),packaged=process.argv.includes('--packaged');
  const app=await _electron.launch({args:packaged?['--e2e']:[project,'--e2e'],executablePath:packaged?path.join(project,'dist/Orbit2-win32-x64/Orbit2.exe'):require('electron'),cwd:project});
  let pointerDown=false;
  try{
    await app.firstWindow();let page;
    for(let attempt=0;attempt<100;attempt++){
      page=app.windows().find(window=>window.url().endsWith('/index.html'));
      if(page)break;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    assert.ok(page);page.setDefaultTimeout(10000);
    await page.waitForSelector('html[data-ready="true"]');
    const errors=[];
    for(const window of app.windows())window.on('pageerror',error=>errors.push(error.message));
    const fixture=await page.evaluate(async()=>{
      const state=await window.orbit.getState();
      const action=(id,name=id)=>({id,name,kind:'app',target:`C:\\Orbit QA\\${id}.exe`,args:'--project "scene 2026"',icon:'app',children:[]});
      const folder=(id,name=id)=>({id,name,kind:'folder',target:`D:\\Motion projects\\${name}`,args:'',icon:'folder',children:[]});
      const group=(id,name,children=[])=>({id,name,kind:'group',target:'',args:'',icon:'group',children});
      const adobe=group('adobe','Adobe',[action('illustrator','Illustrator'),group('motion','Motion Design',[folder('work','Work'),group('tools','Tools',[action('render','Render')]),action('nested-ae','After Effects')]),group('solo','Solo',[folder('solo-leaf','Solo Folder')])]);
      const full=group('full','Full Parent',[group('blocked','Blocked',[folder('blocked-leaf','Blocked Folder')]),...Array.from({length:11},(_,index)=>action(`full-${index}`))]);
      state.menus=[{id:'wheel-drag-qa',name:'Wheel Drag QA',icon:'orbit',items:[action('after-effects','After Effects'),folder('projects','Projects'),adobe,action('photoshop','Photoshop'),full,folder('assets','Assets')]}];
      state.activeMenuId='wheel-drag-qa';state.theme='dark';state.reducedMotion=true;
      await window.orbit.saveState(state);return state;
    });
    const read=()=>page.evaluate(()=>window.orbit.getState());
    const row=id=>page.locator(`.action-list [data-row-id="${id}"]`);
    const button=id=>page.locator(`#preview-wheel [data-wheel-id="${id}"]`);
    const center=()=>page.locator('#preview-wheel .wheel-center');
    const ids=()=>page.locator('#preview-wheel [data-wheel-id]').evaluateAll(nodes=>nodes.map(node=>node.dataset.wheelId));
    const noEditor=async()=>assert.equal(await page.getByRole('dialog').count(),0,'Dragging must not open an action editor.');
    const item=(state,id)=>{
      const walk=items=>{for(const value of items){if(value.id===id)return value;const found=walk(value.children||[]);if(found)return found;}return null;};
      return walk(state.menus[0].items);
    };
    const point=async locator=>{const bounds=await locator.boundingBox();assert.ok(bounds);return{x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};};
    const sourcePoint=async(id,svg=false)=>{
      if(!svg)return point(button(id));
      return page.locator(`#preview-wheel [data-sector="${id}"]`).evaluate(sector=>{
        const sectors=[...sector.parentElement.querySelectorAll('[data-sector]')],angle=(-90+sectors.indexOf(sector)*360/sectors.length)*Math.PI/180;
        const bounds=sector.closest('svg').getBoundingClientRect();
        for(const radius of [202,198,190,115])for(const offset of [0,.18,-.18,.3,-.3]){
          const candidate=angle+offset*2*Math.PI/sectors.length;
          const result={x:bounds.left+bounds.width*(.5+radius*Math.cos(candidate)/480),y:bounds.top+bounds.height*(.5+radius*Math.sin(candidate)/480)};
          if(document.elementFromPoint(result.x,result.y)===sector)return result;
        }
        throw new Error('The SVG drag must start on the actual sector path.');
      });
    };
    const startDrag=async(id,target,{svg=false}={})=>{
      const source=await sourcePoint(id,svg);
      await page.mouse.move(source.x,source.y);await page.mouse.down();pointerDown=true;
      await page.mouse.move(source.x+8,source.y+1,{steps:3});
      await page.mouse.move(target.x,target.y,{steps:10});
      await page.locator('.wheel-editor-dragging').waitFor();
      assert.equal(await page.locator('.wheel-drag-ghost').count(),1);
    };
    const finishDrag=async()=>{await page.mouse.up();pointerDown=false;await page.locator('.wheel-drag-ghost').waitFor({state:'detached'});};
    const assertOrder=async(expected,parentId=null)=>{
      await page.waitForFunction(({expected,parentId})=>window.orbit.getState().then(state=>{
        const walk=items=>{for(const value of items){if(value.id===parentId)return value.children;const found=walk(value.children||[]);if(found)return found;}return null;};
        const items=parentId?walk(state.menus[0].items):state.menus[0].items;
        return JSON.stringify(items.map(value=>value.id))===JSON.stringify(expected);
      }),{expected,parentId});
      assert.deepEqual(await ids(),expected);
      assert.deepEqual(await page.locator('.action-list [data-row-id]').evaluateAll(nodes=>nodes.map(node=>node.dataset.rowId)),expected);
      await noEditor();
    };
    const capture=async name=>{const directory=path.join(project,'output','playwright');await fs.mkdir(directory,{recursive:true});await page.screenshot({path:path.join(directory,name)});};
    await button('after-effects').waitFor();
    let order=['after-effects','projects','adobe','photoshop','full','assets'];await assertOrder(order);
    await startDrag('after-effects',await point(button('photoshop')));
    await page.locator('#preview-wheel [data-sector="photoshop"].reorder-target').waitFor();
    await capture('wheel-drag-sector-target.png');
    await finishDrag();
    order=['projects','adobe','photoshop','after-effects','full','assets'];await assertOrder(order);
    await startDrag('assets',await point(button('projects')),{svg:true});
    await page.locator('#preview-wheel [data-sector="projects"].reorder-target').waitFor();
    await finishDrag();
    order=['assets','projects','adobe','photoshop','after-effects','full'];await assertOrder(order);
    await startDrag('adobe',await point(button('projects')));
    await finishDrag();
    order=['assets','adobe','projects','photoshop','after-effects','full'];await assertOrder(order);
    await page.reload();await page.waitForSelector('html[data-ready="true"]');await assertOrder(order);
    console.log('PASS: icon and actual SVG-sector drags reorder in both directions; group dragging does not navigate; list/state/reload agree');

    const rootSnapshot=await read();
    await startDrag('after-effects',await point(center()));
    await page.locator('#preview-wheel .wheel-center.parent-drop-rejected').waitFor();
    await finishDrag();assert.deepEqual(await read(),rootSnapshot);await assertOrder(order);
    await startDrag('projects',await point(page.locator('.page-header h1')));
    await finishDrag();assert.deepEqual(await read(),rootSnapshot);await assertOrder(order);
    await startDrag('assets',await point(button('photoshop')));
    await page.keyboard.press('Escape');await page.mouse.up();pointerDown=false;
    assert.deepEqual(await read(),rootSnapshot);await assertOrder(order);
    assert.equal(await page.locator('.wheel-drag-ghost,.editor-drag-source,.reorder-target,.parent-drop,.parent-drop-rejected').count(),0);
    console.log('PASS: root-center drop, outside drop and Escape cancel without saved changes or leftover drag state');

    await button('adobe').click();await button('motion').waitFor();await noEditor();
    await button('motion').click();await button('work').waitFor();await noEditor();
    const rootMoveButton=row('work').locator('[data-move-root="work"]');
    assert.equal((await rootMoveButton.textContent()).trim(),'');
    assert.equal(await rootMoveButton.getAttribute('aria-label'),'Перемістити Work в головне меню');
    assert.equal(await rootMoveButton.getAttribute('title'),'Перемістити в головне меню');
    await startDrag('work',await point(center()));
    await page.locator('#preview-wheel .wheel-center.parent-drop').waitFor();
    assert.equal(await center().locator('small').textContent(),'Перемістити на рівень вище');
    await capture('wheel-drag-center-target.png');
    await finishDrag();await row('work').waitFor({state:'detached'});
    let saved=await read();
    assert.deepEqual(item(saved,'adobe').children.map(value=>value.id),['illustrator','motion','solo','work']);
    assert.deepEqual(item(saved,'work'),item(fixture,'work'));
    assert.equal(saved.menus[0].items.some(value=>value.id==='work'),false);
    await assertOrder(['tools','nested-ae'],'motion');
    await startDrag('tools',await point(center()));await finishDrag();await row('tools').waitFor({state:'detached'});
    saved=await read();assert.deepEqual(item(saved,'tools'),item(fixture,'tools'));await assertOrder(['nested-ae'],'motion');
    console.log('PASS: center drops move folders and whole group subtrees exactly one level up while retaining the current nested view and launch details');

    await page.locator('[data-command="group-back"]').click();await button('solo').click();await button('solo-leaf').waitFor();
    await startDrag('solo-leaf',await point(center()));await finishDrag();
    await page.locator('#preview-wheel .wheel-empty').waitFor();
    assert.equal(await page.locator('.action-list [data-row-id]').count(),0);
    saved=await read();assert.equal(item(saved,'solo').children.length,0);
    assert.deepEqual(item(saved,'solo-leaf'),item(fixture,'solo-leaf'));await noEditor();
    await page.locator('[data-command="group-back"]').click();await page.locator('[data-command="group-back"]').click();
    await button('full').click();await button('blocked').click();await button('blocked-leaf').waitFor();
    const fullSnapshot=await read();
    await startDrag('blocked-leaf',await point(center()));
    await page.locator('#preview-wheel .wheel-center.parent-drop-rejected').waitFor();
    await finishDrag();assert.deepEqual(await read(),fullSnapshot);await assertOrder(['blocked-leaf'],'blocked');
    await page.locator('[data-command="group-back"]').click();await page.locator('[data-command="group-back"]').click();
    console.log('PASS: moving the final child leaves a usable empty group; a full parent rejects the move without losing the source; root buttons stay icon-only with accessible labels/tooltips');

    const beforeOverlay=await read();
    await page.locator('[data-command="preview"]').click();
    const overlay=app.windows().find(window=>window.url().includes('overlay=1'));assert.ok(overlay);overlay.setDefaultTimeout(10000);
    await overlay.locator('[data-wheel-id="adobe"]').waitFor();
    const overlaySource=await overlay.locator('[data-wheel-id="adobe"]').boundingBox(),overlayTarget=await overlay.locator('[data-wheel-id="projects"]').boundingBox();
    await overlay.mouse.move(overlaySource.x+overlaySource.width/2,overlaySource.y+overlaySource.height/2);await overlay.mouse.down();
    try{
      await overlay.mouse.move(overlayTarget.x+overlayTarget.width/2,overlayTarget.y+overlayTarget.height/2,{steps:10});
      assert.equal(await overlay.locator('.wheel-drag-ghost,.editor-drag-source,.reorder-target,.parent-drop').count(),0);
      assert.equal(await overlay.locator('#preview-wheel').count(),0);
      assert.deepEqual(await read(),beforeOverlay);
    }finally{await overlay.mouse.up();}
    await overlay.keyboard.press('Escape');
    assert.deepEqual(await read(),beforeOverlay);assert.deepEqual(errors,[]);
    console.log('PASS: the global launcher overlay never exposes editing gestures or changes menu order');
    console.log('ORBIT_WHEEL_DRAG_OK');
  }finally{
    if(pointerDown){try{await app.windows().find(window=>window.url().endsWith('/index.html'))?.mouse.up();}catch{}}
    await app.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
