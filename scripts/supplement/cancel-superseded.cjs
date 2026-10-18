const allowed=new Map([[39129110968,'f3b6cc9279462e1e6186a8be7b9db51c5e7bab08'],[39130928545,'7a244e460b27d3caddeb03b4534cc2c2c14b9116']])
async function cancelSuperseded({github,context,core}){
 if(context.repo.owner!=='kyan54'||context.repo.repo!=='tabby')throw Error('Wrong repository')
 for(const [id,sha]of allowed){
  const r=(await github.rest.actions.getWorkflowRun({owner:'kyan54',repo:'tabby',run_id:id})).data
  if(r.head_sha!==sha||r.path!=='.github/workflows/supplement-platforms.yml')throw Error('Unexpected superseded run identity')
  if(r.status!=='completed'){await github.rest.actions.cancelWorkflowRun({owner:'kyan54',repo:'tabby',run_id:id});core.info('Cancelled superseded validation run '+id)}
 }
}
module.exports={cancelSuperseded}
