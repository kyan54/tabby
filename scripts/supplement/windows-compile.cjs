const cp=require('node:child_process')
const steps=['yarn --frozen-lockfile --network-timeout 1000000','yarn run test:ssh-term','yarn run test:unit','yarn run build','node scripts/prepackage-plugins.mjs']
function compile(execute){for(const command of steps)execute(command)}
if(require.main===module){
 if(process.platform!=='win32')throw Error('Windows producer requires native Windows')
 compile(command=>cp.execFileSync(process.env.ComSpec||process.env.COMSPEC||'cmd.exe',['/d','/s','/c',command],{stdio:'inherit',env:command.startsWith('yarn --frozen')?{...process.env,NODE_OPTIONS:('--require '+JSON.stringify(require('node:path').join(__dirname,'windows-gyp-compat.cjs')))}:process.env}))
}
module.exports={compile}
