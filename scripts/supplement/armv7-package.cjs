const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module'),p=require('./policy.cjs')
function options(){return {dir:true,linux:['deb','tar.gz','rpm','pacman','appimage'],armv7l:true,config:{npmRebuild:false,extraMetadata:{version:p.VERSION},deb:{compression:'gz'},rpm:{compression:'gzip'},pacman:{compression:'gz'}},publish:'never'}}
async function validate(){
 const req=createRequire(path.join(process.cwd(),'package.json'))
 await req('app-builder-lib/out/util/config/config').validateConfiguration(options().config,{isEnabled:false})
 console.log('Actual electron-builder configuration schema passed')
}
async function packageAll(){
 if(process.platform!=='linux'||process.arch!=='arm')throw Error('Expected ARMv7 packaging environment')
 await validate()
 const req=createRequire(path.join(process.cwd(),'package.json')),{build}=await import(req.resolve('electron-builder'))
 fs.writeFileSync('.supplement-packaging.json',JSON.stringify({deb:'gzip',rpm:'gzip',pacman:'gzip',reason:'Standard compression to avoid costly xz under ARMv7 emulation; package content and all validation gates retained'}))
 await build(options())
}
if(require.main===module)(process.argv[2]==='--validate-only'?validate():packageAll()).catch(e=>{console.error(e);process.exitCode=1})
module.exports={options,packageAll,validate}
