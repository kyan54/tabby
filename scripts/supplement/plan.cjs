const fs=require('node:fs'),path=require('node:path'),p=require('./policy.cjs')
const config=()=>JSON.parse(fs.readFileSync(path.join(__dirname,'recovery.json')))
function plan(c=config()){
 const known=p.matrix.map(m=>m.platform+'-'+m.arch)
 if(!Array.isArray(c.build)||!c.build.length||c.build.some(x=>!known.includes(x))||new Set(c.build).size!==c.build.length||!Array.isArray(c.reuse_runs)||c.reuse_runs.some(x=>!Number.isSafeInteger(x)||x<=0))throw Error('Invalid supplemental build plan')
 const linux=[{platform:'linux',arch:'x64',os:'ubuntu-24.04',rust:'x86_64-unknown-linux-gnu'},{platform:'linux',arch:'arm64',os:'ubuntu-24.04-arm',rust:'aarch64-unknown-linux-gnu'}].filter(m=>c.build.includes(m.platform+'-'+m.arch))
 const windows=[{platform:'windows',arch:'x64',os:'windows-2022',rust:'x86_64-pc-windows-msvc'},{platform:'windows',arch:'arm64',os:'windows-11-arm',rust:'aarch64-pc-windows-msvc'}].filter(m=>c.build.includes(m.platform+'-'+m.arch))
 return {macos:String(c.build.includes('macos-x86_64')),armv7:String(c.build.includes('linux-armv7l')),linux:String(linux.length>0),windows:String(windows.length>0),linux_matrix:JSON.stringify({include:linux}),windows_matrix:JSON.stringify({include:windows})}
}
module.exports={config,plan}
