// node-gyp-build 4.x reads bin['node-gyp']; node-gyp 13 publishes bin as a
// string. Normalize only this tooling metadata during dependency installation.
const Module=require('node:module')
function normalize(request,value){
 if((request==='node-gyp/package.json'||/[/\\]node-gyp[/\\]package\.json$/.test(request))&&typeof value?.bin==='string')return {...value,bin:{'node-gyp':value.bin}}
 return value
}
const original=Module._load
Module._load=function(request,parent,isMain){return normalize(request,original.call(this,request,parent,isMain))}
module.exports={normalize}
