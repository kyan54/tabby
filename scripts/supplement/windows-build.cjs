const cp=require('node:child_process')
function signingEnvironment(original){
 const env={...original}
 if(env.HAS_WINDOWS_SIGNING!=='true'){
  for(const key of ['SM_KEYPAIR_ALIAS','SM_CODE_SIGNING_CERT_SHA1_HASH','SM_PUBLISHER_NAME','WIN_CSC_LINK','WIN_CSC_KEY_PASSWORD','CSC_LINK','CSC_KEY_PASSWORD'])delete env[key]
  env.CSC_IDENTITY_AUTO_DISCOVERY='false'
 }
 return env
}
function validateCompiledEntry(root=process.cwd()){
 const fs=require('node:fs'),path=require('node:path')
 const entry=path.join(root,'app/dist/main.js')
 if(!fs.existsSync(entry)||!fs.statSync(entry).size)throw Error('Missing compiled application main: '+entry)

}
if(require.main===module){validateCompiledEntry();const r=cp.spawnSync(process.execPath,['scripts/build-windows.mjs'],{env:signingEnvironment(process.env),stdio:'inherit'});if(r.error)throw r.error;process.exit(r.status??1)}
module.exports={signingEnvironment,validateCompiledEntry}
