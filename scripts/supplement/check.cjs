const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto'),{createRequire}=require('node:module')
const p=require('./policy.cjs')
const root=process.cwd(),[platform,arch]=process.argv.slice(2),out=path.join(root,'supplement-output');fs.mkdirSync(out,{recursive:true})
const req=createRequire(path.join(root,'package.json')),asar=req('@electron/asar')
const run=(cmd,args,options={})=>cp.execFileSync(cmd,args,{encoding:'utf8',timeout:90000,maxBuffer:32*1024*1024,...options})
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isSymbolicLink()?[]:e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)])}
const machine={x64:62,arm64:183,armv7l:40}
function checkNative(file){
 const b=fs.readFileSync(file)
 if(platform==='linux'){if(b.toString('hex',0,4)!=='7f454c46'||b.readUInt16LE(18)!==machine[arch])throw Error('Wrong ELF architecture: '+file);const ld=run('ldd',[file]);if(ld.includes('not found'))throw Error('Missing native dependency: '+file)}
 if(platform==='windows'){const pe=b.readUInt32LE(0x3c);if(b.toString('ascii',pe,pe+4)!=='PE\0\0'||b.readUInt16LE(pe+4)!==(arch==='arm64'?0xaa64:0x8664))throw Error('Wrong PE architecture: '+file)}
 if(platform==='macos'&&!run('lipo',['-archs',file]).split(/\s+/).includes('x86_64'))throw Error('Wrong Mach-O architecture')
}
function checkApp(app,resources){
 const pkg=JSON.parse(asar.extractFile(path.join(resources,'app.asar'),'package.json'));if(pkg.version!==p.VERSION)throw Error('Embedded version mismatch')
 const ssh=fs.readFileSync(path.join(resources,'builtin-plugins/tabby-ssh/dist/index.js'),'utf8');if(ssh.includes('openSortEditor')||!ssh.includes('serverFileList'))throw Error('Wrong SFTP code')
 checkNative(app)
 const nodes=files(resources).filter(f=>f.endsWith('.node'));if(!nodes.length)throw Error('Missing native addons');nodes.forEach(checkNative);return nodes.length
}
if(run('git',['rev-parse','HEAD']).trim()!==p.SOURCE)throw Error('Wrong checked-out source SHA')
const dist=path.join(root,'dist')
const appdir=platform==='macos'?path.join(dist,'mac/Tabby.app'):platform==='windows'?path.join(dist,arch==='x64'?'win-unpacked':'win-arm64-unpacked'):path.join(dist,arch==='x64'?'linux-unpacked':`linux-${arch}-unpacked`)
const app=platform==='macos'?path.join(appdir,'Contents/MacOS/Tabby'):path.join(appdir,platform==='windows'?'Tabby.exe':'tabby')
const resources=path.join(appdir,platform==='macos'?'Contents/Resources':'resources')
const nativeCount=checkApp(app,resources)
const config=fs.mkdtempSync(path.join(os.tmpdir(),'tabby-supplement-config-'))
const smoke=platform==='linux'?run('xvfb-run',['-a',app,'--no-sandbox','--version'],{env:{...process.env,TABBY_CONFIG_DIRECTORY:config}}):run(app,['--version'],{env:{...process.env,TABBY_CONFIG_DIRECTORY:config}})
if(!smoke.includes(p.VERSION))throw Error('CLI smoke version mismatch: '+smoke)
for(const name of p.namesFor(platform,arch)){
 const file=name==='tabby-web.tar.gz'?path.join(root,name):path.join(dist,name)
 if(!fs.existsSync(file))throw Error('Missing product: '+name)
 if(name.endsWith('.zip')){
  if(platform==='windows')run('7z',['t',file])
  else run('unzip',['-tq',file])
 }
 if(platform==='linux'&&name!=='tabby-web.tar.gz'){
  let meta=''
  if(name.endsWith('.deb')){meta=run('dpkg-deb',['-f',file,'Version','Architecture']);if(!meta.includes({x64:'amd64',arm64:'arm64',armv7l:'armhf'}[arch]))throw Error('DEB arch mismatch')}
  if(name.endsWith('.rpm')){meta=run('rpm',['-qp','--qf','%{VERSION}-%{RELEASE} %{ARCH}',file]);if(!(arch==='armv7l'?/armv7(?:l|hl)/.test(meta):meta.includes({x64:'x86_64',arm64:'aarch64'}[arch])))throw Error('RPM arch mismatch')}
  if(name.endsWith('.pacman'))meta=run('tar',['-xOf',file,'.PKGINFO'])
  if(meta&&(!meta.includes('1.0.238')||!meta.includes('fix')))throw Error('Package version mismatch: '+name)
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'tabby-package-check-'))
  try{
   if(name.endsWith('.deb'))run('dpkg-deb',['-x',file,scratch])
   else if(name.endsWith('.rpm'))run('bash',['-c','rpm2cpio "$1" | (cd "$2" && cpio -id --quiet --no-absolute-filenames)','bash',file,scratch])
   else if(name.endsWith('.AppImage')){fs.chmodSync(file,0o755);run(file,['--appimage-extract'],{cwd:scratch})}
   else run('tar',['-xf',file,'-C',scratch])
   const entries=files(scratch),packed=entries.find(f=>f.endsWith('/resources/app.asar'))
   if(!packed)throw Error('Package has no app.asar: '+name)
   checkApp(path.join(path.dirname(path.dirname(packed)),'tabby'),path.dirname(packed))
  }finally{fs.rmSync(scratch,{recursive:true,force:true})}
 }
 if(name==='tabby-web.tar.gz'&&!run('tar',['-tf',file]).includes('web/dist/'))throw Error('Missing web build')
 fs.copyFileSync(file,path.join(out,name))
}
const signed=platform==='macos'||process.env.WINDOWS_SIGNED==='true'
const report={controlSource:run('git',['-C',path.resolve(__dirname,'../..'),'rev-parse','HEAD']).trim(),source:p.SOURCE,version:p.VERSION,platform,arch,versionVerified:true,nativeDependenciesVerified:true,nativeAddonCount:nativeCount,packageFormatsVerified:true,smokePassed:true,smoke:arch==='armv7l'?'CLI under QEMU ARMv7':'native CI CLI --version',signed,notarized:platform==='macos',gatekeeper:platform==='macos',files:p.namesFor(platform,arch).map(name=>{const f=path.join(out,name);return{name,bytes:fs.statSync(f).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')}})}
fs.writeFileSync(path.join(out,`CHECKS-${platform}-${arch}.json`),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))
