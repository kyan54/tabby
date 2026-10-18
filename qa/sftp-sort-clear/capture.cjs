const fs=require('fs'),path=require('path'),cp=require('child_process');
const repository=path.resolve(__dirname,'../..');const root=path.dirname(repository);const WebSocket=require(repository+'/node_modules/ws');
const qa=root+'/releases/sftp-sort-clear';const label=process.argv[2];
const config=qa+'/'+label+'-config',user=qa+'/'+label+'-user';fs.mkdirSync(config,{recursive:true});fs.mkdirSync(user,{recursive:true});
fs.writeFileSync(config+'/config.yaml','version: 1\nprofiles: []\nappearance:\n  vibrancy: false\nssh:\n  sftpSort:\n    rules: null\n    field: name\n');
try{fs.unlinkSync(user+'/DevToolsActivePort')}catch{}
const log=fs.openSync(qa+'/'+label+'-startup.log','w');const proc=cp.spawn(qa+'/Tabby SFTP Sorting QA.app/Contents/MacOS/Tabby SFTP Test',['--remote-debugging-port=0','--user-data-dir='+user],{env:{...process.env,TABBY_CONFIG_DIRECTORY:config},stdio:['ignore',log,log]});
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
 const fake=[['z.log',false,30,33188],['z-folder',true,0,16877],['a.txt',false,10,33188],['a-folder',true,0,16877],['m.json',false,20,33188]].map(([name,isDirectory,size,mode],i)=>({name,isDirectory,size,mode,isSymlink:false,fullPath:'/demo/'+name,modified:new Date(2026,9,18,8,i)}));
 const panel=component.instance;panel.session={openSFTP:async()=>({readdir:async()=>fake})};panel.path='/demo';panel.cwdDetectionAvailable=true;
 const element=component.location.nativeElement;element.classList.add('bg-dark');Object.assign(element.style,{position:'absolute',height:'80%',width:'100%',bottom:'0',zIndex:'5'});
 document.querySelector('.content.main').append(element);app.attachView(component.hostView);component.changeDetectorRef.detectChanges();await new Promise(r=>setTimeout(r,300));component.changeDetectorRef.detectChanges();
 window.__sftpQA={component,panel,injector,core:c,tabby:t,app};
 const row=element.querySelector('.list-group-item-action');const style=getComputedStyle(row);return {renderedRows:element.querySelectorAll('.list-group-item-action').length,hasHeader:!!element.querySelector('.file-list-header'),font:style.fontFamily,fontSize:style.fontSize,rowPadding:style.padding,color:style.color,background:getComputedStyle(element).backgroundColor,path:panel.path,headerButtons:element.querySelectorAll('.file-list-header button').length};
 })()`);
 await delay(500);const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(qa+'/'+label+'.png',Buffer.from(shot.data,'base64'));fs.writeFileSync(qa+'/'+label+'-measurements.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 if(label==='clear') {
 const checks=await evaluate(`(async()=>{
 const {component,panel,injector,core,tabby,app}=window.__sftpQA;const el=component.location.nativeElement;const config=injector.get(tabby.ConfigService);const buttons=el.querySelectorAll('.file-list-header button');
 const names=()=>panel.filteredFileList.map(f=>f.name);const raw=['z-folder','a-folder','z.log','a.txt','m.json'];
 const click=async(index,shift=false)=>{buttons[index].dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:shift}));component.changeDetectorRef.detectChanges();await config.save()};
 if(panel.sort.length!==1||panel.sort[0].field!=='name')throw Error('Expected legacy default name state');
 await click(1);const asc=panel.sortDirection('size');await click(1);const desc=panel.sortDirection('size');await click(1);const off=panel.sort.length===0&&JSON.stringify(names())===JSON.stringify(raw);
 await panel.navigate('/demo');component.changeDetectorRef.detectChanges();const refresh=panel.sort.length===0&&JSON.stringify(names())===JSON.stringify(raw);
 await panel.navigate('/other');component.changeDetectorRef.detectChanges();const reenter=panel.sort.length===0&&JSON.stringify(names())===JSON.stringify(raw);
 for(const index of [0,1,2])await click(index,true);
 await click(1,true);await click(1,true);const secondaryRemoved=panel.sortPriority('size')===0&&panel.sortPriority('modified')===2;
 await click(0,true);await click(0,true);const primaryRemoved=panel.sortPriority('modified')===1;
 await click(2,true);await click(2,true);const lastRemoved=panel.sort.length===0;
 await config.load();const persisted=Array.isArray(config.store.ssh.sftpSort.rules)&&config.store.ssh.sftpSort.rules.length===0;const reopened=injector.get(core.ComponentFactoryResolver).resolveComponentFactory(require('tabby-ssh').SFTPPanelComponent).create(injector);reopened.instance.session=panel.session;reopened.instance.path='/reopened';reopened.instance.cwdDetectionAvailable=true;app.attachView(reopened.hostView);reopened.changeDetectorRef.detectChanges();await new Promise(r=>setTimeout(r,50));reopened.changeDetectorRef.detectChanges();const reopenedEmpty=reopened.instance.sort.length===0&&JSON.stringify(reopened.instance.filteredFileList.map(f=>f.name))===JSON.stringify(raw);app.detachView(reopened.hostView);reopened.destroy();
 panel.openSortEditor();component.changeDetectorRef.detectChanges();const advancedEmpty=panel.sortDraft.length===0;
 const parent=el.querySelector('.list-group-item-action').textContent.includes('Go up');const noArrows=!/[↑↓]/.test(el.querySelector('.file-list-header').textContent);
 return {asc,desc,off,refresh,reenter,secondaryRemoved,primaryRemoved,lastRemoved,persisted,reopenedEmpty,advancedEmpty,parent,noArrows,finalNames:names()};
 })()`);
 if(checks.asc!=='asc'||checks.desc!=='desc'||Object.entries(checks).some(([key,value])=>typeof value==='boolean'&&!value))throw Error('Actual three-state interaction check failed');
 const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(qa+'/clear.png',Buffer.from(shot.data,'base64'));
 fs.writeFileSync(qa+'/three-state-interactions.json',JSON.stringify(checks,null,2));console.log(JSON.stringify(checks));
 }
 }finally{if(ws)ws.close();proc.kill('SIGTERM');await delay(1000)}})().catch(e=>{console.error(e.message);process.exitCode=1});
