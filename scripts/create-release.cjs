const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {createReadStream}=require('node:fs');
const {spawn}=require('node:child_process');

(async()=>{
  const project=path.resolve(__dirname,'..'),pkg=require('../package.json');
  if(!/^\d+\.\d+\.\d+$/.test(pkg.version))throw new Error('A stable version is required.');
  if(process.env.GITHUB_REF_TYPE==='tag'&&process.env.GITHUB_REF_NAME!=='v'+pkg.version)throw new Error('Git tag must match package.json version.');
  const bundle=await fs.realpath(path.join(project,'dist','Orbit2-win32-x64'));
  const dist=await fs.realpath(path.join(project,'dist'));
  if(path.dirname(bundle).toLowerCase()!==dist.toLowerCase()||path.basename(bundle)!=='Orbit2-win32-x64')throw new Error('Unexpected bundle path.');
  await fs.access(path.join(bundle,'Orbit2.exe'));await fs.access(path.join(bundle,'resources','app.asar'));
  await fs.writeFile(path.join(bundle,'orbit-release.json'),JSON.stringify({product:'com.creationsoft.orbit2',version:pkg.version,platform:'win32',arch:'x64'},null,2)+'\n');
  const output=path.join(project,'release');await fs.mkdir(output,{recursive:true});
  const name=`Orbit2-${pkg.version}-win32-x64.zip`,archive=path.join(output,name);
  await new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'archive-release.ps1'),'-BundlePath',bundle,'-ArchivePath',archive],{cwd:project,windowsHide:true,stdio:'inherit'});
    child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('Release archive failed: '+code)));
  });
  const hash=crypto.createHash('sha256');for await(const chunk of createReadStream(archive))hash.update(chunk);
  const digest=hash.digest('hex');await fs.writeFile(path.join(output,'SHA256SUMS.txt'),`${digest}  ${name}\n`);
  console.log(JSON.stringify({archive,size:(await fs.stat(archive)).size,sha256:digest}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
