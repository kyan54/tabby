const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto')
const p=require('./policy.cjs'),{publish,validate}=require('./publish.cjs')
function fixture(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'supplement-policy-')),calls=[]
 const release={id:p.RELEASE_ID,tag_name:p.TAG,name:p.TAG,target_commitish:p.SOURCE,draft:false,prerelease:false,body:'Original notes',html_url:'https://github.com/kyan54/tabby/releases/tag/'+p.TAG,assets:p.original.map(a=>({name:a.name,id:a.id,size:a.size,digest:'sha256:'+a.sha256}))}
 for(const m of p.matrix){const files=p.namesFor(m.platform,m.arch).map(name=>{const data=Buffer.from('synthetic '+name);fs.writeFileSync(path.join(directory,name),data);return{name,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')}});fs.writeFileSync(path.join(directory,`CHECKS-${m.platform}-${m.arch}.json`),JSON.stringify({source:p.SOURCE,version:p.VERSION,platform:m.platform,arch:m.arch,files,nativeDependenciesVerified:true,nativeLoadPassed:true,versionVerified:true,smokePassed:true,packageFormatsVerified:true,signed:m.platform==='macos',notarized:m.platform==='macos',gatekeeper:m.platform==='macos'}))}
 const github={rest:{git:{getRef:async()=>({data:{object:{sha:p.SOURCE}}})},repos:{getRelease:async()=>({data:release}),uploadReleaseAsset:async a=>{calls.push(['upload',a.name]);release.assets.push({id:900000+calls.length,name:a.name,size:a.data.length,digest:'sha256:'+crypto.createHash('sha256').update(a.data).digest('hex')})},updateRelease:async a=>{assert.deepEqual(Object.keys(a).sort(),['owner','repo','release_id','body'].sort());calls.push(['notes']);release.body=a.body}}}}
 return{directory,calls,release,args:{github,context:{repo:{owner:'kyan54',repo:'tabby'}},core:{notice(){}},directory},cleanup:()=>fs.rmSync(directory,{recursive:true,force:true})}
}
test('whitelist has exactly 22 missing products, never the existing arm64 Mac files',()=>{assert.equal(p.products.length,22);assert.equal(new Set(p.products).size,22);assert.ok(p.products.every(n=>!p.original.some(a=>a.name===n)))})
test('all six verified platforms append only; original five assets remain identical; exact-byte retry is read-only',async()=>{const f=fixture();try{const old=JSON.stringify(f.release.assets);await publish(f.args);assert.equal(f.calls.filter(c=>c[0]==='upload').length,24);assert.equal(JSON.stringify(f.release.assets.slice(0,5)),old);assert.match(f.release.body,/UNSIGNED/);const count=f.calls.length;await publish(f.args);assert.equal(f.calls.length,count)}finally{f.cleanup()}})
test('changed original bytes, release identity, source tag, wrong repo, and name collision stop before any upload',async()=>{for(const mode of ['oldHash','oldID','releaseID','tag','repo','collision']){const f=fixture();try{if(mode==='oldHash')f.release.assets[0].digest='sha256:'+'0'.repeat(64);if(mode==='oldID')f.release.assets[0].id++;if(mode==='releaseID')f.release.id++;if(mode==='tag')f.args.github.rest.git.getRef=async()=>({data:{object:{sha:'0'.repeat(40)}}});if(mode==='repo')f.args.context.repo.owner='Eugeny';if(mode==='collision')f.release.assets.push({name:p.products[0],size:1,digest:'sha256:'+'0'.repeat(64)});await assert.rejects(publish(f.args));assert.deepEqual(f.calls,[])}finally{f.cleanup()}}})
test('incomplete evidence, corrupted artifact, unexpected file and unsigned Intel Mac fail before upload',async()=>{for(const mode of ['smoke','checksum','unexpected','unsigned']){const f=fixture();try{const reportPath=path.join(f.directory,'CHECKS-macos-x86_64.json'),r=JSON.parse(fs.readFileSync(reportPath));if(mode==='smoke')r.smokePassed=false;if(mode==='unsigned')r.signed=false;fs.writeFileSync(reportPath,JSON.stringify(r));if(mode==='checksum')fs.appendFileSync(path.join(f.directory,p.products[0]),'bad');if(mode==='unexpected')fs.writeFileSync(path.join(f.directory,'tabby-1.0.238-fix-macos-arm64.zip'),'bad');await assert.rejects(publish(f.args));assert.deepEqual(f.calls,[])}finally{f.cleanup()}}})
test('workflow pins application source, standard runners, no external publisher or overwrite/delete operations',()=>{const s=fs.readFileSync(path.join(__dirname,'../../.github/workflows/supplement-platforms.yml'),'utf8');assert.equal((s.match(/ref: b72b9b6e2feb7b5e352afd6b47c2f41fce3bfcf1/g)||[]).length,4);assert.equal((s.match(/path: source\n/g)||[]).length,4);for(const label of ['macos-15-intel','windows-2022','windows-11-arm','ubuntu-24.04-arm'])assert.ok((s+fs.readFileSync(path.join(__dirname,'plan.cjs'),'utf8')).includes(label));assert.doesNotMatch(s,/KEYGEN_TOKEN:.*secrets|PACKAGECLOUD_TOKEN|overwrite_files|deleteRelease|deleteRef|createRelease/);assert.ok(s.includes("KEYGEN_TOKEN: ''"));assert.ok(s.includes('contents: read'));assert.ok(s.includes('contents: write'))})

test('native selection distinguishes ARMv7 from arm64 and excludes other platform prebuilds',()=>{
 assert.equal(p.selectedNative('/russh/russh.linux-arm-gnueabihf.node','linux','armv7l'),true)
 assert.equal(p.selectedNative('/russh/russh.linux-arm64-gnu.node','linux','armv7l'),false)
 assert.equal(p.selectedNative('/russh/russh.win32-x64-msvc.node','linux','x64'),false)
 assert.equal(p.selectedNative('/russh/russh.darwin-x64.node','macos','x86_64'),true)
 assert.equal(p.selectedNative('/node-pty/prebuilds/win32-arm64/conpty.node','windows','arm64'),true)
 assert.equal(p.selectedNative('/node-pty/prebuilds/win32-x64/conpty.node','windows','arm64'),false)
})

test('recovery schedules only selected missing producer and keeps complete final product whitelist',()=>{
 const {plan}=require('./plan.cjs')
 const r=plan({build:['windows-arm64'],reuse_runs:[39129110968]})
 assert.equal(r.macos,'false');assert.equal(r.linux,'false');assert.equal(r.armv7,'false');assert.equal(r.windows,'true')
 assert.deepEqual(JSON.parse(r.windows_matrix).include.map(x=>x.arch),['arm64'])
 assert.throws(()=>plan({build:['macos-arm64'],reuse_runs:[]}))
 assert.throws(()=>plan({build:['windows-arm64'],reuse_runs:['bad']}))
 assert.equal(p.products.length,22)
})

test('unsigned Windows environment removes empty certificate selectors without changing source/version or OS policy',()=>{
 const {signingEnvironment}=require('./windows-build.cjs')
 const input={HAS_WINDOWS_SIGNING:'false',SM_CODE_SIGNING_CERT_SHA1_HASH:'',SM_PUBLISHER_NAME:'',SM_KEYPAIR_ALIAS:'',TABBY_RELEASE_VERSION:p.VERSION,ARCH:'arm64'}
 const result=signingEnvironment(input)
 assert.equal(result.SM_CODE_SIGNING_CERT_SHA1_HASH,undefined);assert.equal(result.SM_PUBLISHER_NAME,undefined);assert.equal(result.SM_KEYPAIR_ALIAS,undefined)
 assert.equal(result.TABBY_RELEASE_VERSION,p.VERSION);assert.equal(result.ARCH,'arm64');assert.equal(input.SM_CODE_SIGNING_CERT_SHA1_HASH,'')
 assert.equal(signingEnvironment({...input,HAS_WINDOWS_SIGNING:'true',SM_KEYPAIR_ALIAS:'synthetic-existing-alias'}).SM_KEYPAIR_ALIAS,'synthetic-existing-alias')
 const ps=fs.readFileSync(path.join(__dirname,'uac.ps1'),'utf8');assert.match(ps,/RUNNER_TEMP/);assert.match(ps,/Copy-Item tabby-uac/);assert.doesNotMatch(ps,/Set-ExecutionPolicy|Disable|Set-MpPreference/)
})

test('generic native prebuild selection follows platform/arch and GNU libc for SerialPort',()=>{
 assert.equal(p.selectedNative('/@serialport/bindings-cpp/prebuilds/android-arm/node.napi.armv7.node','linux','x64'),false)
 assert.equal(p.selectedNative('/@serialport/bindings-cpp/prebuilds/linux-x64/node.napi.glibc.node','linux','x64'),true)
 assert.equal(p.selectedNative('/@serialport/bindings-cpp/prebuilds/linux-x64/node.napi.musl.node','linux','x64'),false)
 assert.equal(p.selectedNative('/@serialport/bindings-cpp/prebuilds/win32-arm64/node.napi.node','windows','arm64'),true)
})

test('superseded cancellation is restricted to two exact repository/run/control SHAs, never release mutation',async()=>{
 const {cancelSuperseded}=require('./cancel-superseded.cjs');const calls=[]
 const args={context:{repo:{owner:'kyan54',repo:'tabby'}},core:{info(){}},github:{rest:{actions:{getWorkflowRun:async a=>({data:{head_sha:a.run_id===39129110968?'f3b6cc9279462e1e6186a8be7b9db51c5e7bab08':'7a244e460b27d3caddeb03b4534cc2c2c14b9116',path:'.github/workflows/supplement-platforms.yml',status:'in_progress'}}),cancelWorkflowRun:async a=>calls.push(a.run_id)}}}}
 await cancelSuperseded(args);assert.deepEqual(calls,[39129110968,39130928545]);calls.length=0
 args.github.rest.actions.getWorkflowRun=async()=>({data:{head_sha:'unexpected',path:'.github/workflows/supplement-platforms.yml',status:'in_progress'}})
 await assert.rejects(cancelSuperseded(args));assert.deepEqual(calls,[])
})

test('runtime checks remove compiler overrides without mutating build environment',()=>{
 const {runtimeEnvironment}=require('./runtime-env.cjs')
 const original={RUST_TARGET_TRIPLE:'aarch64-unknown-linux-gnu',ELECTRON_RUN_AS_NODE:'1',TABBY_RELEASE_VERSION:p.VERSION,PATH:'/example'}
 assert.deepEqual(runtimeEnvironment(original),{PATH:'/example'})
 assert.equal(original.RUST_TARGET_TRIPLE,'aarch64-unknown-linux-gnu')
})

test('Windows packaging requires compiled entry existence and nonzero size',()=>{
 const {validateCompiledEntry}=require('./windows-build.cjs')
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'asar-check-fixture-'))
 try{
  fs.mkdirSync(path.join(scratch,'app/dist'),{recursive:true})
  assert.throws(()=>validateCompiledEntry(scratch),/Missing compiled/)
  fs.writeFileSync(path.join(scratch,'app/dist/main.js'),'')
  assert.throws(()=>validateCompiledEntry(scratch),/Missing compiled/)
  const source=fs.readFileSync(path.join(__dirname,'windows-build.cjs'),'utf8')
  assert.doesNotMatch(source,/writeFileSync/)
 }finally{fs.rmSync(scratch,{recursive:true,force:true})}
})

test('Windows compile stops immediately on native command failure before packaging',()=>{
 const {compile}=require('./windows-compile.cjs'),calls=[]
 assert.throws(()=>compile(cmd=>{calls.push(cmd);throw Error('fixture install failed')}),/fixture install failed/)
 assert.equal(calls.length,1)
 compile(cmd=>calls.push(cmd));assert.equal(calls.length,6)
})

test('global node-gyp path resolves in isolated lifecycle child and is removed for app runtime',()=>{
 const cp=require('node:child_process'),{runtimeEnvironment}=require('./runtime-env.cjs')
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'gyp-path-fixture-'))
 try{
  const globalRoot=path.join(scratch,'global'),pkg=path.join(globalRoot,'node-gyp')
  fs.mkdirSync(pkg,{recursive:true});fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:'node-gyp',version:'13.0.2'}))
  const script=path.join(scratch,'lifecycle.cjs');fs.writeFileSync(script,"console.log(require.resolve('node-gyp/package.json'))")
  const env={...process.env,NODE_PATH:globalRoot,npm_config_node_gyp:path.join(pkg,'bin/node-gyp.js')}
  assert.equal(cp.execFileSync(process.execPath,[script],{env,encoding:'utf8'}).trim(),fs.realpathSync(path.join(pkg,'package.json')))
  assert.equal(runtimeEnvironment(env).NODE_PATH,undefined);assert.equal(runtimeEnvironment(env).npm_config_node_gyp,undefined)
 }finally{fs.rmSync(scratch,{recursive:true,force:true})}
})

test('final collection reuses exact four recovery runs and never schedules another producer',()=>{
 assert.deepEqual(require('./artifact-runs.json'),[39132516264,39132620663,39132795862,39133657854])
 const source=fs.readFileSync(path.resolve(__dirname,'../../.github/workflows/finalize-supplement.yml'),'utf8')
 assert.match(source,/runs-on: ubuntu-24.04/);assert.match(source,/mac\?\.conclusion!==\x27success\x27/)
 assert.match(source,/artifacts.some/);assert.match(source,/Collect current and previously validated producer artifacts/)
 assert.doesNotMatch(source,/build-linux|build-macos|build-windows|yarn run build|deleteRelease|updateRef/)
})

test('real node-gyp-build 4.6 launcher uses Node JS entry with node-gyp 13 string bin metadata',()=>{
 const vm=require('node:vm'),{normalize}=require('./windows-gyp-compat.cjs')
 const source=fs.readFileSync(path.join(__dirname,'fixtures/node-gyp-build-4.6.cjs'),'utf8')
 function launch(compat){
  let captured
  const manifest={name:'node-gyp',version:'13.0.2',bin:'./bin/node-gyp.js'}
  const req=name=>{
   if(name==='child_process')return {spawn:(exe,args)=>{captured={exe,args};return {on:()=>{}}}}
   if(name==='os')return {platform:()=> 'win32'}
   if(name==='path')return path
   if(name==='node-gyp/package.json')return compat?normalize(name,manifest):manifest
   throw Error('Unexpected launcher dependency: '+name)
  }
  req.resolve=()=>path.join('/fixture/node-gyp','package.json')
  vm.runInNewContext(source,{require:req,process:{execPath:'/fixture/node.exe',env:{npm_config_build_from_source:'true'},argv:['node','bin.js']},console})
  assert.equal(manifest.bin,'./bin/node-gyp.js');return captured
 }
 assert.equal(launch(false).exe,'node-gyp.cmd')
 assert.deepEqual(JSON.parse(JSON.stringify(launch(true))),{exe:'/fixture/node.exe',args:[path.join('/fixture/node-gyp','bin/node-gyp.js'),'rebuild']})
})

test('compatibility preload works through actual NODE_OPTIONS child process',()=>{
 const cp=require('node:child_process'),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'gyp-preload-fixture-'))
 try{
  const pkg=path.join(scratch,'node_modules/node-gyp');fs.mkdirSync(pkg,{recursive:true})
  fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:'node-gyp',version:'13.0.2',bin:'./bin/node-gyp.js'}))
  const script=path.join(scratch,'child.cjs');fs.writeFileSync(script,"console.log(JSON.stringify(require('node-gyp/package.json').bin))")
  const before=JSON.parse(cp.execFileSync(process.execPath,[script],{encoding:'utf8'}));assert.equal(typeof before,'string')
  const after=JSON.parse(cp.execFileSync(process.execPath,[script],{encoding:'utf8',env:{...process.env,NODE_OPTIONS:'--require '+JSON.stringify(path.join(__dirname,'windows-gyp-compat.cjs'))}}))
  assert.deepEqual(after,{'node-gyp':'./bin/node-gyp.js'})
 }finally{fs.rmSync(scratch,{recursive:true,force:true})}
})

test('reused frontend rejects native content and symlinks while preserving portable files',()=>{
 const {portable,copyTree}=require('./reuse-frontend.cjs'),root=fs.mkdtempSync(path.join(os.tmpdir(),'frontend-policy-'))
 try{
  const file=path.join(root,'hidden.js');fs.writeFileSync(file,Buffer.from('7f454c4601010100','hex'));assert.throws(()=>portable(file),/Native binary/)
  fs.writeFileSync(file,'console.log("portable")');assert.doesNotThrow(()=>portable(file))
  const input=path.join(root,'input');fs.mkdirSync(input);fs.symlinkSync(file,path.join(input,'link.js'));assert.throws(()=>copyTree(input,path.join(root,'out')),/symlink/)
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})

test('explicit binfmt interpreter preserves the AppImage target argv0',()=>{
 const cp=require('node:child_process'),root=fs.mkdtempSync(path.join(os.tmpdir(),'qemu-argv0-'))
 try{
  const interpreter=path.join(root,'qemu.cjs');fs.writeFileSync(interpreter,'#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)))\n');fs.chmodSync(interpreter,0o755)
  const result=cp.execFileSync('bash',[path.join(__dirname,'appimage-armv7-runner.sh'),'/fixture/probe.AppImage','--appimage-extract'],{encoding:'utf8',env:{...process.env,SUPPLEMENT_QEMU_ARM:interpreter}})
  assert.deepEqual(JSON.parse(result),['/fixture/probe.AppImage','/fixture/probe.AppImage','--appimage-extract'])
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})

test('ARMv7 recovery checkpoints compiled natives before packaging and retains full validation',()=>{
 const workflow=fs.readFileSync(path.resolve(__dirname,'../../.github/workflows/armv7-recovery.yml'),'utf8')
 assert.match(workflow,/runs-on: ubuntu-24.04/);assert.match(workflow,/ref: b72b9b6e2feb7b5e352afd6b47c2f41fce3bfcf1/)
 assert.ok(workflow.indexOf('Preserve prepared source')<workflow.indexOf('Package five ARMv7 formats'))
 assert.match(workflow,/sha256sum/);assert.match(workflow,/source\/\.supplement-prepared.json/)
 const prepare=fs.readFileSync(path.join(__dirname,'armv7.sh'),'utf8');assert.match(prepare,/git diff --exit-code/);assert.match(prepare,/check.cjs linux armv7l/)
 assert.match(prepare,/reuse-frontend.cjs/);assert.doesNotMatch(prepare,/git reset|git checkout.*--|yarn run build/)
})
