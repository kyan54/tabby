const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process')
const p=require('./policy.cjs'),{config}=require('./plan.cjs'),{hash}=require('./publish.cjs')
async function collect({github,context,core,directory}){
 const ids=[context.runId,...config().reuse_runs],names=p.matrix.map(m=>`supplement-${m.platform}-${m.arch}`)
 let chosen=new Map()
 for(let attempt=0;attempt<360;attempt++){
  chosen=new Map();let priorRunning=false
  for(const id of ids){
   const artifacts=(await github.rest.actions.listWorkflowRunArtifacts({owner:'kyan54',repo:'tabby',run_id:id,per_page:100})).data.artifacts
   for(const a of artifacts)if(names.includes(a.name)&&!a.expired&&!chosen.has(a.name))chosen.set(a.name,{run:id,artifact:a})
   if(id!==context.runId){const r=(await github.rest.actions.getWorkflowRun({owner:'kyan54',repo:'tabby',run_id:id})).data;if(r.status!=='completed')priorRunning=true}
  }
  const missing=names.filter(n=>!chosen.has(n));if(!missing.length)break
  if(!priorRunning||attempt===359)throw Error('Missing verified producer artifacts: '+missing.join(', '))
  if(attempt%3===0)core.info('Waiting for original producers: '+missing.join(', '))
  await new Promise(r=>setTimeout(r,20000))
 }
 fs.mkdirSync(directory,{recursive:true})
 for(const name of names){
  const picked=chosen.get(name),temp=fs.mkdtempSync(path.join(os.tmpdir(),'supplement-artifact-'))
  try{
   core.info(`Collect ${name} from run ${picked.run}, artifact ${picked.artifact.id}`)
   cp.execFileSync('gh',['run','download',String(picked.run),'--repo','kyan54/tabby','--name',name,'--dir',temp],{stdio:'inherit',timeout:1800000})
   for(const entry of fs.readdirSync(temp,{withFileTypes:true})){
    if(!entry.isFile())throw Error('Unexpected artifact directory or symlink')
    const from=path.join(temp,entry.name),to=path.join(directory,entry.name)
    if(fs.existsSync(to)&&hash(to)!==hash(from))throw Error('Artifact merge collision: '+entry.name)
    fs.copyFileSync(from,to)
   }
  }finally{fs.rmSync(temp,{recursive:true,force:true})}
 }
}
module.exports={collect}
