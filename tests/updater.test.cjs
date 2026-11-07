const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createHash}=require('node:crypto');
const {EventEmitter}=require('node:events');
const {createUpdater,compareVersions,selectRelease,isAllowedURL,validatePaths,PRODUCT}=require('../src/updater.cjs');
const repo='Validolio11/Orbit-2',payload=Buffer.from('fixture archive bytes');
const digest=createHash('sha256').update(payload).digest('hex');
const release=(overrides={})=>({draft:false,prerelease:false,tag_name:'v0.2.0',assets:[{name:'Orbit2-0.2.0-win32-x64.zip',state:'uploaded',size:payload.length,digest:'sha256:'+digest,browser_download_url:`https://github.com/${repo}/releases/download/v0.2.0/Orbit2-0.2.0-win32-x64.zip`}],...overrides});

test('update versions compare numerically, honor prereleases and reject malformed values',()=>{
  assert.ok(compareVersions('1.10.0','1.9.9')>0);
  assert.ok(compareVersions('1.0.0','1.0.0-rc.4')>0);
  assert.ok(compareVersions('1.0.0-rc.10','1.0.0-rc.9')>0);
  assert.equal(compareVersions('1.0.0+build.4','1.0.0'),0);
  for(const v of ['01.0.0','1.0','1.0.0-01','1.0.0-rc..1','9007199254740993.0.0'])assert.throws(()=>compareVersions(v,'1.0.0'));
});

test('only newer stable releases with the exact Windows asset and SHA-256 are eligible',()=>{
  assert.equal(selectRelease(release(),'0.1.1',repo).version,'0.2.0');
  assert.equal(selectRelease(release(),'0.2.0',repo),null);
  assert.equal(selectRelease(release(),'1.0.0',repo),null);
  for(const r of [release({draft:true}),release({prerelease:true}),release({assets:[]}),release({assets:[...release().assets,...release().assets]}),release({tag_name:'v0.3.0-rc.1'})])assert.throws(()=>selectRelease(r,'0.1.1',repo));
  for(const patch of [{digest:null},{size:0},{size:2**31},{browser_download_url:'https://evil.example/Orbit2.exe'},{state:'new'}])assert.throws(()=>selectRelease(release({assets:[{...release().assets[0],...patch}]}),'0.1.1',repo));
});

test('update transport restricts protocol, credentials, repository and asset redirect hosts',()=>{
  assert.equal(isAllowedURL(`https://api.github.com/repos/${repo}/releases/latest`,repo,'api'),true);
  assert.equal(isAllowedURL(release().assets[0].browser_download_url,repo,'asset'),true);
  assert.equal(isAllowedURL('https://release-assets.githubusercontent.com/assets/file?signature=abc',repo,'asset',true),true);
  for(const url of ['http://github.com/Validolio11/Orbit-2/releases/download/v1/a','https://github.com.evil.example/Validolio11/Orbit-2/releases/download/a','https://user:pass@github.com/Validolio11/Orbit-2/releases/download/a','https://github.com/another/repo/releases/download/a','https://release-assets.githubusercontent.com.evil.example/file'])assert.equal(isAllowedURL(url,repo,'asset',true),false);
  assert.throws(()=>validatePaths(path.parse(process.cwd()).root,path.join(os.tmpdir(),'outside'),__filename));
  assert.throws(()=>validatePaths(process.cwd(),path.join(process.cwd(),'updates'),__filename));
});

async function fixture(t,options={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'orbit-updater-unit-'));
  const install=path.join(root,'app'),updates=path.join(root,'updates'),helper=path.join(root,'Update.ps1');
  await fs.mkdir(install);await fs.writeFile(helper,'# test helper');
  const statuses=[];
  const updater=createUpdater({version:'0.1.1',repo,installDir:install,updatesDir:updates,helperPath:helper,isolated:true,onStatus:s=>statuses.push(s),...options});
  t.after(async()=>{updater.dispose();const resolved=await fs.realpath(root);assert.equal(path.dirname(resolved).toLowerCase(),(await fs.realpath(os.tmpdir())).toLowerCase());assert.ok(path.basename(resolved).startsWith('orbit-updater-unit-'));await fs.rm(resolved,{recursive:true,force:true,maxRetries:3});});
  return {updater,root,install,updates,statuses};
}

test('check handles GitHub availability, malformed responses and retry without parallel checks',async t=>{
  let response={statusCode:403,body:''},calls=0,unblock;
  const {updater}=await fixture(t,{request:async()=>{calls++;if(unblock!==undefined)await new Promise(resolve=>unblock=resolve);return response;}});
  assert.equal((await updater.check()).phase,'error');
  response={statusCode:404,body:''};assert.equal((await updater.check()).phase,'up-to-date');
  response={statusCode:200,body:'{invalid'};assert.equal((await updater.check()).phase,'error');
  response={statusCode:200,body:JSON.stringify(release())};unblock=null;
  const pending=updater.check();await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await updater.check()).phase,'checking');assert.equal(calls,4);
  unblock();assert.equal((await pending).phase,'available');
});

test('checksum mismatch never launches the helper and removes partial update data',async t=>{
  let launched=0;
  const {updater,updates}=await fixture(t,{request:async url=>({statusCode:200,body:url.includes('api.github.com')?JSON.stringify(release()):Buffer.from('corrupted zip bytes!')}),launch:()=>{launched++;throw Error('Must not execute');}});
  await updater.check();const result=await updater.download();
  assert.equal(result.phase,'error');assert.equal(launched,0);
  assert.deepEqual(await fs.readdir(updates),[]);
});

test('download validates hash, prepares files, reports progress and blocks application in isolated mode',async t=>{
  let launches=0;
  const launch=(_exe,args)=>{
    launches++;const child=new EventEmitter();child.kill=()=>{};
    const arg=key=>args[args.indexOf(key)+1];
    (async()=>{
      const stage=arg('-StagePath');
      await fs.mkdir(path.join(stage,'resources','app.asar.unpacked','native'),{recursive:true});
      for(const name of ['Orbit2.exe','resources/app.asar','resources/app.asar.unpacked/native/Orbit2.Input.exe','resources/app.asar.unpacked/native/Update.ps1'])await fs.writeFile(path.join(stage,name),'fixture');
      await fs.writeFile(path.join(stage,'orbit-release.json'),JSON.stringify({product:PRODUCT,version:'0.2.0',platform:'win32',arch:'x64'}));
      await fs.writeFile(path.join(arg('-WorkDir'),'prepared.json'),JSON.stringify({ok:true}));
      child.emit('exit',0);
    })().catch(error=>child.emit('error',error));
    return child;
  };
  const {updater,statuses,updates}=await fixture(t,{request:async url=>({statusCode:200,body:url.includes('api.github.com')?JSON.stringify(release()):payload}),launch});
  await updater.check();assert.equal((await updater.download()).phase,'ready');assert.equal(launches,1);
  assert.ok(statuses.some(s=>s.phase==='downloading'&&s.progress===100));
  assert.equal((await updater.install()).phase,'error');assert.equal(launches,1);
  assert.deepEqual(await fs.readdir(updates),[]);
});

test('redirects to other hosts and oversized API responses fail without following them',async t=>{
  let calls=0;
  const {updater}=await fixture(t,{request:async()=>{calls++;return {statusCode:302,headers:{location:'https://evil.example/payload'},body:''};}});
  assert.equal((await updater.check()).phase,'error');assert.equal(calls,1);
  const other=await fixture(t,{request:async()=>({statusCode:200,body:' '.repeat(1024*1024+1)})});
  assert.equal((await other.updater.check()).phase,'error');
});

test('installer arms only after helper readiness and saved state; app shutdown preserves the armed helper',async t=>{
  const events=[];let killed=false,commitFile,updater,installLaunch;
  const launch=(_exe,args,options)=>{
    const child=new EventEmitter();child.pid=234567;child.kill=()=>{killed=true;};child.unref=()=>{};
    const arg=key=>args[args.indexOf(key)+1],work=arg('-WorkDir');
    (async()=>{
      if(arg('-Mode')==='Prepare'){
        const stage=arg('-StagePath');
        for(const name of ['Orbit2.exe','resources/app.asar','resources/app.asar.unpacked/native/Orbit2.Input.exe','resources/app.asar.unpacked/native/Update.ps1']){await fs.mkdir(path.dirname(path.join(stage,name)),{recursive:true});await fs.writeFile(path.join(stage,name),'fixture');}
        await fs.writeFile(path.join(stage,'orbit-release.json'),JSON.stringify({product:PRODUCT,version:'0.2.0',platform:'win32',arch:'x64'}));
        await fs.writeFile(path.join(work,'prepared.json'),'{"ok":true}');child.emit('exit',0);
      }else{
        events.push('helper');commitFile=path.join(work,'commit.json');installLaunch={args,options};
        // The launcher exits before the relaunched installer reports readiness under its own PID.
        child.emit('exit',0);await new Promise(resolve=>setTimeout(resolve,120));
        await fs.writeFile(path.join(work,'ready.json'),JSON.stringify({token:path.basename(work),pid:345678}));
      }
    })().catch(error=>child.emit('error',error));
    return child;
  };
  const f=await fixture(t,{isolated:false,request:async url=>({statusCode:200,body:url.includes('api.github.com')?JSON.stringify(release()):payload}),launch,
    beforeInstall:async()=>{await assert.rejects(fs.access(commitFile));events.push('saved');},
    onInstallReady:async()=>{const commit=JSON.parse(await fs.readFile(commitFile));assert.equal(commit.parentPid,process.pid);events.push('quit');updater.dispose();}});
  updater=f.updater;await updater.check();await updater.download();
  assert.equal((await updater.install()).phase,'installing');
  assert.deepEqual(events,['helper','saved','quit']);assert.equal(killed,false);
  assert.ok(installLaunch.args.includes('-Detach'));assert.ok(!installLaunch.options.detached,'PowerShell exits without running when spawned detached');
});

test('a failed install written by the helper after Orbit closed is reported on the next start',async t=>{
  const {updater,updates,statuses}=await fixture(t);
  const work=path.join(updates,'a'.repeat(32));await fs.mkdir(work,{recursive:true});
  await fs.writeFile(path.join(work,'journal.json'),JSON.stringify({phase:'old-moved',version:'0.2.0'}));
  await fs.writeFile(path.join(work,'result.json'),JSON.stringify({ok:false,error:'The new Orbit version failed its startup check.',rolledBack:true}));
  const reported=await updater.reportFailedInstall();
  assert.equal(reported.phase,'error');assert.match(reported.message,/0\.2\.0.*попередній версії/);
  assert.equal(statuses.at(-1).phase,'error');
});

test('cleanup removes finished and abandoned update files but keeps an interrupted install for recovery',async t=>{
  const {updater,root,updates}=await fixture(t);
  const id=n=>String(n).repeat(32);
  const make=async(dir,files=[])=>{await fs.mkdir(dir,{recursive:true});for(const file of files)await fs.writeFile(path.join(dir,file),'{}');};
  await make(path.join(updates,id(1)),['Orbit2-0.2.0-win32-x64.zip','commit.json','result.json']);
  await make(path.join(updates,id(2)),['commit.json']);
  await make(path.join(updates,id(3)),['prepared.json']);
  await make(path.join(updates,'not-an-update'));
  for(const n of [1,2,4])await make(path.join(root,`.Orbit2-update-stage-${id(n)}`),['Orbit2.exe']);
  await make(path.join(root,`.Orbit2-update-backup-${id(1)}`),['Orbit2.exe']);
  await updater.cleanup();
  assert.deepEqual((await fs.readdir(updates)).sort(),[id(2),'not-an-update'].sort());
  assert.deepEqual((await fs.readdir(root)).filter(name=>name.startsWith('.Orbit2-')).sort(),[`.Orbit2-update-backup-${id(1)}`,`.Orbit2-update-stage-${id(2)}`].sort());
  assert.ok((await fs.readdir(root)).includes('app'));
});
