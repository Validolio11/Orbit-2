const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async()=>{
  const project=path.resolve(__dirname,'..');
  const dpi150=process.argv.includes('--dpi150');
  const packaged=process.argv.includes('--packaged');
  const app=await _electron.launch({args:[...(packaged?[]:[project]),'--e2e',...(dpi150?['--force-device-scale-factor=1.5']:[])],executablePath:packaged?path.join(project,'dist/Orbit2-win32-x64/Orbit2.exe'):require('electron'),cwd:project});
  try{
    await app.firstWindow();
    let page;
    for(let attempt=0;attempt<100;attempt++){
      page=app.windows().find(window=>window.url().endsWith('/index.html'));
      if(page)break;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    assert.ok(page,'Main renderer must load.');page.setDefaultTimeout(10000);
    await page.waitForSelector('html[data-ready="true"]');
    const response=await page.evaluate(()=>window.orbit.searchApps('Adobe'));
    assert.equal(response.error,undefined);
    const candidates=response.apps.filter(entry=>/after effects|illustrator|photoshop|premiere pro|media encoder/i.test(entry.name)&&!entry.name.includes('Beta')&&!entry.target.startsWith('app-id:'));
    if(!candidates.length){console.log('SKIP: no installed Adobe programs available for native icon quality QA.');return;}
    const output=path.join(project,'output','playwright');await fs.mkdir(output,{recursive:true});
    const baseline=await app.evaluate(async({app,shell},target)=>{
      const resolved=/\.lnk$/i.test(target)?shell.readShortcutLink(target).target:target;
      const results=[];
      for(const size of ['small','normal','large']){
        const image=await app.getFileIcon(resolved,{size});
        results.push({option:size,size:image.getSize(),scales:image.getScaleFactors(),representations:image.getScaleFactors().map(scale=>{
          const png=image.toPNG({scaleFactor:scale});return{scale,width:png.readUInt32BE(16),height:png.readUInt32BE(20)};
        })});
      }
      return results;
    },candidates[0].target);
    const icons=[];
    for(const entry of candidates){
      const data=await page.evaluate(target=>window.orbit.getAppIcon(target),entry.target);
      assert.ok(data?.startsWith('data:image/png;base64,'),'Actual program icon must be returned as PNG.');
      assert.ok(data.length<200000,'High-resolution program icons must fit both existing icon caches.');
      const png=Buffer.from(data.split(',')[1],'base64');
      const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
      assert.ok(width>=64&&height>=64,'Installed Adobe icon must offer genuine high-resolution pixels.');
      const name=entry.name.replace(/[^a-z0-9]+/ig,'-').replace(/-$/,'').toLowerCase();
      await fs.writeFile(path.join(output,`icons-sharp-${name}-source.png`),png);
      icons.push({name:entry.name,width,height,dataChars:data.length});
    }
    // Seed only the isolated test profile. No app is launched by this scenario.
    await page.evaluate(async entries=>{
      const state=await window.orbit.getState();state.wheelSize=780;state.theme='dark';
      const children=entries.map((entry,index)=>({id:`icon-qa-${index}`,name:entry.name,kind:'app',target:entry.target,args:entry.args||'',icon:'app',children:[]}));
      state.menus=[{id:'icon-qa',name:'Icon QA',icon:'orbit',items:[{id:'adobe-qa',name:'Adobe',kind:'group',target:'',args:'',icon:'adobe',children}]}];state.activeMenuId='icon-qa';
      await window.orbit.saveState(state);await window.orbit.showWheel();
    },candidates);
    const overlay=app.windows().find(window=>window.url().includes('overlay=1'));assert.ok(overlay);overlay.setDefaultTimeout(10000);
    await overlay.locator('[data-wheel-id="adobe-qa"]').click();
    await overlay.waitForFunction(expected=>[...document.querySelectorAll('#overlay-wheel .app-icon-slot img')].filter(image=>image.complete&&image.naturalWidth>=64).length===expected,candidates.length);
    const dimensions=await overlay.locator('#overlay-wheel .app-icon-slot img').evaluateAll(images=>images.map(image=>{
      const bounds=image.getBoundingClientRect();return{naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,displayWidth:bounds.width,physicalWidth:Math.ceil(bounds.width*devicePixelRatio),dpr:devicePixelRatio};
    }));
    for(const image of dimensions)assert.ok(image.naturalWidth>=image.physicalWidth,`Icon ${image.naturalWidth}px is too small for ${image.physicalWidth} physical pixels.`);
    await overlay.locator('.wheel').evaluate(async wheel=>{await Promise.all(wheel.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})));});
    await overlay.screenshot({path:path.join(output,dpi150?'icons-sharp-wheel-150-dpi150.png':'icons-sharp-wheel-150.png')});
    await overlay.keyboard.press('Escape');
    console.log(JSON.stringify({electronBaseline:baseline,highResolutionIcons:icons,rendered150Percent:dimensions}));
    console.log('ORBIT_ICONS_OK');
  }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
