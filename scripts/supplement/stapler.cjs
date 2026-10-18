const cp=require('node:child_process')
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function validate(app){
 for(let attempt=1;attempt<=3;attempt++){
  const r=cp.spawnSync('xcrun',['stapler','validate',app],{encoding:'utf8',timeout:60000})
  process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'')
  if(r.status===0)return
  if(attempt===3||!/(NSURLErrorDomain|network connection|CloudKit)/i.test((r.stdout||'')+(r.stderr||'')))throw Error('Stapled notarization ticket validation failed')
  console.log('Retrying Apple ticket validation after transient network failure ('+attempt+'/3)');await wait(5000*attempt)
 }
}
if(require.main===module)validate(process.argv[2]).catch(e=>{console.error(e.message);process.exitCode=1})
module.exports={validate}
