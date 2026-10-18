const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module'),p=require('./policy.cjs')
function options(){return {dir:true,linux:['deb','tar.gz','rpm','pacman','appimage'],armv7l:true,config:{npmRebuild:false,extraMetadata:{version:p.VERSION},deb:{compression:'gzip'},rpm:{compression:'gzip'},pacman:{compression:'gzip'}},publish:'never'}}
async function packageAll(){
 if(process.platform!=='linux'||process.arch!=='arm')throw Error('Expected ARMv7 packaging environment')
 const req=createRequire(path.join(process.cwd(),'package.json')),{build}=await import(req.resolve('electron-builder'))
 fs.writeFileSync('.supplement-packaging.json',JSON.stringify({deb:'gzip',rpm:'gzip',pacman:'gzip',reason:'Standard compression to avoid costly xz under ARMv7 emulation; package content and all validation gates retained'}))
 await build(options())
}
if(require.main===module)packageAll().catch(e=>{console.error(e);process.exitCode=1})
module.exports={options,packageAll}
