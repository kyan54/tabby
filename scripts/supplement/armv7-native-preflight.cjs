const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),{createRequire}=require('node:module'),{runtimeEnvironment}=require('./runtime-env.cjs')
const options=version=>({buildPath:path.join(process.cwd(),'app'),electronVersion:version,arch:'arm',force:true,buildFromSource:true,onlyModules:['@serialport/bindings-cpp'],useCache:false})
async function preflight(){
 if(process.platform!=='linux'||process.arch!=='arm')throw Error('Expected native ARMv7 build environment')
 const req=createRequire(path.join(process.cwd(),'package.json'))
 const {rebuild}=await import(req.resolve('@electron/rebuild'))
 const version=req('electron/package.json').version
 await rebuild(options(version))
 const moduleDir=path.join(process.cwd(),'app/node_modules/@serialport/bindings-cpp')
 const release=path.join(moduleDir,'build/Release')
 if(!fs.existsSync(release)||!fs.readdirSync(release).some(n=>n.endsWith('.node')))throw Error('SerialPort generic Release addon missing after source build')
 const modules=['keytar','node-pty','russh','fontmanager-redux','native-process-working-directory','@serialport/bindings-cpp']
 const expression=modules.map(name=>'require('+JSON.stringify(path.join(process.cwd(),'app/node_modules',name))+')').join(';')+';console.log("raw-armv7-native-load-ok abi="+process.versions.modules)'
 cp.execFileSync(req('electron'),['-e',expression],{stdio:'inherit',timeout:180000,env:{...runtimeEnvironment(process.env),ELECTRON_RUN_AS_NODE:'1'}})
 console.log('ARMv7 SerialPort built from source; all six raw native entrypoints loaded before packaging')
}
if(require.main===module)preflight().catch(e=>{console.error(e);process.exitCode=1})
module.exports={options,preflight}
