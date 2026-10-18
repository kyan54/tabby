const cp=require('node:child_process')
const steps=['yarn --frozen-lockfile --network-timeout 1000000','yarn run test:ssh-term','yarn run test:unit','yarn run build','node scripts/prepackage-plugins.mjs']
function compile(execute){for(const command of steps)execute(command)}
if(require.main===module){
 if(process.platform!=='win32')throw Error('Windows producer requires native Windows')
 const installEnv={...process.env,NODE_OPTIONS:'--require '+JSON.stringify(require('node:path').join(__dirname,'windows-gyp-compat.cjs'))}
 cp.execFileSync(process.execPath,['-e',"const m=require('node-gyp/package.json');if(m.version!=='13.0.2'||typeof m.bin['node-gyp']!=='string')throw Error('Native launcher compatibility unavailable');console.log('Native launcher compatibility verified')"],{stdio:'inherit',env:installEnv})
 compile(command=>{
  cp.execFileSync(process.env.ComSpec||process.env.COMSPEC||'cmd.exe',['/d','/s','/c',command],{stdio:'inherit',env:command.startsWith('yarn --frozen')?installEnv:process.env})
  if(command.startsWith('yarn --frozen'))require.resolve('@serialport/bindings-cpp',{paths:[require('node:path').join(process.cwd(),'app')]})
 })
}
module.exports={compile}
