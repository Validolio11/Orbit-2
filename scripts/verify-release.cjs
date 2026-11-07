// Read-only public feed + real archive verification. The installation is never applied.
const {createUpdater}=require('../src/updater.cjs');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');

// Orbit runs the updater inside Electron, whose fs treats app.asar as a folder, so preparation is verified there too.
function prepareInElectron(){
  const result=spawnSync(require('electron'),[__filename,'--prepare-only'],{stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
  assert.equal(result.status,0,'Public release preparation failed inside Electron');
}

async function verifyPreparation(){
  assert.ok(process.versions.electron,'Preparation must be verified inside Electron');
  const packagedAsar=path.resolve(__dirname,'../dist/Orbit2-win32-x64/resources/app.asar');
  assert.ok(require('node:fs').statSync(packagedAsar).isDirectory(),'Electron asar handling must be active, as in Orbit');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'orbit-release-verify-'));
  const updater=createUpdater({version:'0.1.0',repo:'Validolio11/Orbit-2',installDir:path.resolve(__dirname,'../dist/Orbit2-win32-x64'),updatesDir:root,helperPath:path.resolve(__dirname,'../native/Update.ps1'),isolated:true,onStatus:s=>{if(s.phase!=='downloading'||s.progress===0||s.progress===100)console.log(s.phase,s.version||'',s.message||'');}});
  try{
    const available=await updater.check();assert.equal(available.phase,'available',available.message);
    const ready=await updater.download();assert.equal(ready.phase,'ready',ready.message);
    await updater.check(); // Drop this uncommitted verified stage through scoped cleanup.
    assert.deepEqual(await fs.readdir(root),[]);
    console.log('ORBIT_PUBLIC_RELEASE_VERIFIED');
  }finally{
    updater.dispose();const resolved=await fs.realpath(root);
    assert.equal(path.dirname(resolved).toLowerCase(),(await fs.realpath(os.tmpdir())).toLowerCase());assert.ok(path.basename(resolved).startsWith('orbit-release-verify-'));
    await fs.rm(resolved,{recursive:true,force:true,maxRetries:3});
  }
}

(async()=>{
  if(process.argv.includes('--prepare-only')){await verifyPreparation();return;}
  if(!process.argv.includes('--ui-only'))prepareInElectron();
  const {_electron}=require('playwright');
  const app=await _electron.launch({args:['--e2e'],executablePath:path.resolve(__dirname,'../dist/Orbit2-win32-x64/Orbit2.exe')});
  try{
    await app.firstWindow();let page;
    for(let n=0;n<100;n++){page=app.windows().find(w=>w.url().endsWith('/index.html'));if(page)break;await new Promise(resolve=>setTimeout(resolve,50));}
    assert.ok(page);page.setDefaultTimeout(20000);await page.waitForSelector('html[data-ready="true"]');
    await page.getByRole('button',{name:'Налаштування',exact:true}).click();
    await page.locator('[data-command="check-updates"]').click();
    await page.waitForFunction(()=>{
      const message=document.querySelector('#update-message');
      return message?.textContent==='Встановлено останню версію.'||message?.textContent?.startsWith('Доступна версія')||message?.classList.contains('update-error');
    },{},{timeout:30000});
    const status=await page.evaluate(()=>window.orbit.getUpdateStatus());
    console.log('Public feed status',JSON.stringify(status));
    assert.ok(['up-to-date','available'].includes(status.phase),status.message);
    console.log('ORBIT_PUBLIC_UPDATE_UI_OK',JSON.stringify(status));
  }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
