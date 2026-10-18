const fs=require('fs'),path=require('path'),cp=require('child_process');
const repository=path.resolve(__dirname,'../..');const root=path.dirname(repository);const WebSocket=require(repository+'/node_modules/ws');
const qa=root+'/releases/sftp-native-comparison';const label=process.argv[2];
const config=qa+'/'+label+'-config',user=qa+'/'+label+'-user';fs.mkdirSync(config,{recursive:true});fs.mkdirSync(user,{recursive:true});
fs.writeFileSync(config+'/config.yaml','version: 1\nprofiles: []\nappearance:\n  vibrancy: false\n');
try{fs.unlinkSync(user+'/DevToolsActivePort')}catch{}
const log=fs.openSync(qa+'/'+label+'-startup.log','w');const proc=cp.spawn(qa+'/Tabby SFTP Comparison.app/Contents/MacOS/Tabby SFTP Test',['--remote-debugging-port=0','--user-data-dir='+user],{env:{...process.env,TABBY_CONFIG_DIRECTORY:config},stdio:['ignore',log,log]});
const delay=n=>new Promise(r=>setTimeout(r,n));let ws;let seq=0;const pending=new Map();
async function send(method,params={}){const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(pending.delete(id))reject(Error('CDP timeout '+method))},15000).unref()})}
(async()=>{try{
 let port;for(let i=0;i<70;i++){try{port=fs.readFileSync(user+'/DevToolsActivePort','utf8').split('\n')[0];break}catch{}await delay(300)}if(!port)throw Error('No isolated debug endpoint');
 let target;for(let i=0;i<50;i++){const list=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();target=list.find(x=>x.type==='page');if(target)break;await delay(200)}
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.once('open',r));ws.on('message',raw=>{const m=JSON.parse(raw);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value};
 for(let i=0;i<70;i++){if(await evaluate('Boolean(window.pluginModules && document.querySelector(".content.main"))'))break;await delay(300)}
 console.log('runtime',await evaluate(`(()=>{const c=require('@angular/core');const p=c.getPlatform();return {moduleCount:p?._modules?.length,plugins:window.pluginModules?.map(m=>m.pluginName)}})()`));
 const result=await evaluate(`(async()=>{
 const c=require('@angular/core'),t=require('tabby-core'),ssh=require('tabby-ssh');
 const module=c.getPlatform()._modules[0],injector=module.injector;
 const app=injector.get(c.ApplicationRef);
 const component=injector.get(c.ComponentFactoryResolver).resolveComponentFactory(ssh.SFTPPanelComponent).create(injector);
 const fake=[['logs',true,0,16877],['src',true,0,16877],['README.md',false,1536,33188],['package.json',false,2870,33188],['report.csv',false,18200,33188]].map(([name,isDirectory,size,mode],i)=>({name,isDirectory,size,mode,isSymlink:false,fullPath:'/demo/'+name,modified:new Date(2026,9,18,8,i)}));
 const panel=component.instance;panel.session={openSFTP:async()=>({readdir:async()=>fake})};panel.path='/demo';panel.cwdDetectionAvailable=true;
 const element=component.location.nativeElement;element.classList.add('bg-dark');Object.assign(element.style,{position:'absolute',height:'80%',width:'100%',bottom:'0',zIndex:'5'});
 document.querySelector('.content.main').append(element);app.attachView(component.hostView);component.changeDetectorRef.detectChanges();await new Promise(r=>setTimeout(r,300));component.changeDetectorRef.detectChanges();
 window.__sftpQA={component,panel};
 const row=element.querySelector('.list-group-item-action');const style=getComputedStyle(row);return {renderedRows:element.querySelectorAll('.list-group-item-action').length,hasHeader:!!element.querySelector('.file-list-header'),font:style.fontFamily,fontSize:style.fontSize,rowPadding:style.padding,color:style.color,background:getComputedStyle(element).backgroundColor,path:panel.path,headerButtons:element.querySelectorAll('.file-list-header button').length};
 })()`);
 await delay(500);const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(qa+'/'+label+'.png',Buffer.from(shot.data,'base64'));fs.writeFileSync(qa+'/'+label+'-measurements.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 if(label==='modified') {
 const checks=await evaluate(`(()=>{const {component,panel}=window.__sftpQA;const el=component.location.nativeElement;const buttons=el.querySelectorAll('.file-list-header button');buttons[1].click();component.changeDetectorRef.detectChanges();const primary=panel.sort[0].field;buttons[2].dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));component.changeDetectorRef.detectChanges();const secondary=panel.sort.findIndex(r=>r.field==='modified')+1;const key=new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Enter',shiftKey:true});buttons[2].dispatchEvent(key);component.changeDetectorRef.detectChanges();panel.showFilter=true;panel.filterText='README';panel.onFilterChange();component.changeDetectorRef.detectChanges();return {primary,secondary,modifiedDirection:panel.sort.find(r=>r.field==='modified').direction,keyboardDefaultPrevented:key.defaultPrevented,parentRemainsFirst:el.querySelector('.list-group-item-action').textContent.includes('Go up'),filteredNames:panel.filteredFileList.map(f=>f.name)}})()`);
 if(checks.primary!=='size'||checks.secondary!==3||checks.modifiedDirection!=='desc'||!checks.keyboardDefaultPrevented||!checks.parentRemainsFirst||checks.filteredNames[0]!=='README.md')throw Error('Actual component interaction check failed');
 fs.writeFileSync(qa+'/actual-interactions.json',JSON.stringify(checks,null,2));console.log(JSON.stringify(checks));
 }

 }finally{if(ws)ws.close();proc.kill('SIGTERM');await delay(1000)}})().catch(e=>{console.error(e.message);process.exitCode=1});
