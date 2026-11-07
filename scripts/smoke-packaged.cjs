const {spawn}=require('node:child_process');
const path=require('node:path');
const child=spawn(path.resolve(__dirname,'../dist/Orbit2-win32-x64/Orbit2.exe'),['--smoke-test'],{windowsHide:true,stdio:'inherit'});
const timer=setTimeout(()=>{child.kill();process.exitCode=1;},30000);
child.once('error',error=>{clearTimeout(timer);console.error(error.message);process.exitCode=1;});
child.once('exit',code=>{clearTimeout(timer);process.exitCode=code===0?0:1;});
