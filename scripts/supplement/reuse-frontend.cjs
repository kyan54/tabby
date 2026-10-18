const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{createRequire}=require('node:module'),{pathToFileURL}=require('node:url'),p=require('./policy.cjs')
function portable(file){
 if(/\.(node|exe|dll|so(?:\.[0-9.]+)?|dylib)$/i.test(file))throw Error('Native file forbidden in reused frontend: '+file)
 const b=fs.readFileSync(file).subarray(0,4),magic=b.toString('hex')
 if(magic==='7f454c46'||b.toString('ascii',0,2)==='MZ'||['feedface','feedfacf','cefaedfe','cffaedfe','cafebabe'].includes(magic))throw Error('Native binary forbidden in frontend')
}
function copyTree(from,to){
 fs.mkdirSync(to,{recursive:true})
 for(const e of fs.readdirSync(from,{withFileTypes:true})){
  if(e.isSymbolicLink())throw Error('Unexpected frontend symlink')
  const f=path.join(from,e.name),t=path.join(to,e.name)
  if(e.isDirectory())copyTree(f,t);else{portable(f);fs.copyFileSync(f,t)}
 }
}
async function reuse(root,basis){
 for(const name of ['BUILD_INFO.json',`tabby-${p.VERSION}-macos-arm64.zip`]){
  const original=p.original.find(f=>f.name===name),file=path.join(basis,name)
  if(fs.statSync(file).size!==original.size||crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==original.sha256)throw Error('Unverified frontend basis: '+name)
 }
 const info=JSON.parse(fs.readFileSync(path.join(basis,'BUILD_INFO.json')))
 if(info.commit!==p.SOURCE||info.version!==p.VERSION)throw Error('Frontend source mismatch')
 const resources=path.join(basis,'unpacked/Tabby.app/Contents/Resources'),archive=path.join(resources,'app.asar')
 const req=createRequire(path.join(root,'package.json')),asar=req('@electron/asar')
 if(JSON.parse(asar.extractFile(archive,'package.json')).version!==p.VERSION)throw Error('Frontend embedded version mismatch')
 const scratch=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'tabby-dist-copy-'))
 try{
  for(const name of asar.listPackage(archive).map(n=>n.replace(/^\//,''))){
   if(!name.startsWith('dist/'))continue
   const stat=asar.statFile(archive,name)
   if(stat.files)continue
   if(stat.link||name.split('/').includes('..'))throw Error('Unexpected archive path')
   const out=path.join(scratch,name.slice(5));fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,asar.extractFile(archive,name));portable(out)
  }
  if(!fs.statSync(path.join(scratch,'main.js')).size)throw Error('Missing frontend main')
  copyTree(scratch,path.join(root,'app/dist'))
 }finally{fs.rmSync(scratch,{recursive:true,force:true})}
 const vars=await import(pathToFileURL(path.join(root,'scripts/vars.mjs')))
 for(const plugin of vars.builtinPlugins.filter(n=>n!=='tabby-web'))copyTree(path.join(resources,'builtin-plugins',plugin,'dist'),path.join(root,plugin,'dist'))
 const ssh=fs.readFileSync(path.join(root,'tabby-ssh/dist/index.js'),'utf8');if(!ssh.includes('serverFileList')||ssh.includes('openSortEditor'))throw Error('Wrong frontend customizations')
 const result={source:p.SOURCE,version:p.VERSION,basis:'original published Mac arm64 ZIP',basisSha256:p.original.find(f=>f.name.endsWith('arm64.zip')).sha256,scope:'Only architecture-independent app/dist and plugin/dist files reused; all ARMv7 native dependencies rebuilt separately'}
 fs.writeFileSync(path.join(root,'.supplement-frontend-basis.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));return result
}
if(require.main===module)reuse(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1})
module.exports={portable,copyTree,reuse}
