const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const policy=require('./policy.cjs')
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function validate(directory){
 const reports=policy.matrix.map(({platform,arch})=>{
  const r=JSON.parse(fs.readFileSync(path.join(directory,`CHECKS-${platform}-${arch}.json`)))
  if(r.source!==policy.SOURCE||r.version!==policy.VERSION||r.platform!==platform||r.arch!==arch||!r.nativeDependenciesVerified||!r.nativeLoadPassed||!r.versionVerified||!r.smokePassed||!r.packageFormatsVerified)throw Error('Incomplete platform evidence: '+platform+'/'+arch)
  if(r.frontendBasis&&(r.frontendBasis.source!==policy.SOURCE||r.frontendBasis.version!==policy.VERSION||r.frontendBasis.basisSha256!==policy.original.find(f=>f.name.endsWith('arm64.zip')).sha256))throw Error('Invalid frontend provenance')
  if(platform==='macos'&&(!r.signed||!r.notarized||!r.gatekeeper))throw Error('Intel Mac must be signed and notarized')
  const wanted=policy.namesFor(platform,arch)
  if(r.files.length!==wanted.length||!wanted.every(n=>r.files.some(f=>f.name===n)))throw Error('Product whitelist mismatch')
  for(const f of r.files){const p=path.join(directory,f.name);if(!wanted.includes(f.name)||fs.statSync(p).size!==f.bytes||hash(p)!==f.sha256)throw Error('Product hash mismatch')}
  return r
 })
 const expected=[...policy.products,...policy.matrix.map(m=>`CHECKS-${m.platform}-${m.arch}.json`)]
 if(fs.readdirSync(directory).some(n=>!expected.includes(n)&&!policy.metadata.includes(n)))throw Error('Unexpected artifact file')
 fs.writeFileSync(path.join(directory,policy.metadata[0]),reports.flatMap(r=>r.files).map(f=>`${f.sha256}  ${f.name}`).join('\n')+'\n')
 fs.writeFileSync(path.join(directory,policy.metadata[1]),JSON.stringify({source:policy.SOURCE,version:policy.VERSION,release_id:policy.RELEASE_ID,platforms:reports,limitations:'CLI smoke tests on CI runners; ARMv7 under QEMU. No real SSH or user desktop acceptance. Windows signing status is recorded per platform; Linux packages are not cryptographically signed.'},null,2)+'\n')
 return [...policy.products,...policy.metadata]
}
async function preflight(github,context){
 if(context.repo.owner!=='kyan54'||context.repo.repo!=='tabby')throw Error('Wrong repository')
 const release=(await github.rest.repos.getRelease({owner:'kyan54',repo:'tabby',release_id:policy.RELEASE_ID})).data
 const ref=(await github.rest.git.getRef({owner:'kyan54',repo:'tabby',ref:'tags/'+policy.TAG})).data
 policy.assertIdentity(release,ref.object.sha)
 return release
}
async function publish({github,context,core,directory}){
 const names=validate(directory)
 const release=await preflight(github,context)
 // Detect ALL collisions before any upload. A retry may skip only identical,
 // already-added bytes, never overwrite or delete an existing asset.
 for(const name of names){const old=release.assets.find(a=>a.name===name);if(old&&(old.size!==fs.statSync(path.join(directory,name)).size||old.digest!=='sha256:'+hash(path.join(directory,name))))throw Error('Asset collision: '+name)}
 for(const name of names){
  if(release.assets.some(a=>a.name===name))continue
  await preflight(github,context)
  const data=fs.readFileSync(path.join(directory,name))
  await github.rest.repos.uploadReleaseAsset({owner:'kyan54',repo:'tabby',release_id:policy.RELEASE_ID,name,headers:{'content-type':'application/octet-stream','content-length':data.length},data})
 }
 const final=await preflight(github,context)
 if(!names.every(n=>final.assets.some(a=>a.name===n&&a.digest==='sha256:'+hash(path.join(directory,n)))))throw Error('Uploaded bytes do not match')
 const report=JSON.parse(fs.readFileSync(path.join(directory,policy.metadata[1])))
 const windows=report.platforms.filter(r=>r.platform==='windows').map(r=>`${r.arch}: ${r.signed?'Authenticode verified':'UNSIGNED / 未签名'}`).join('; ')
 const marker='<!-- additional-platform-assets -->'
 const note=`\n\n${marker}\n## 补齐跨平台附件\n\n源码固定为 \`${policy.SOURCE}\`，版本 \`${policy.VERSION}\`。新增 Intel Mac、Windows x64/arm64、Linux x64/arm64/armv7l 和 Web bundle。现有 Mac arm64 及原五个附件保持原 ID 和哈希。\n\nIntel Mac 经 Developer ID 签名、公证和 Gatekeeper 验证。Windows：${windows}。未签名 Windows 包可能触发系统提示，请勿关闭安全保护。Linux 包未进行独立加密签名。\n\n各平台执行包格式、架构、内嵌版本及 native 依赖校验和 CI CLI smoke test；ARMv7 在 QEMU 中运行，不宣称各平台实机 GUI/SSH 全面验收。完整清单见 BUILD_INFO-additional.json，新增文件校验见 SHA256SUMS-additional.txt。`
 if(!final.body.includes(marker))await github.rest.repos.updateRelease({owner:'kyan54',repo:'tabby',release_id:policy.RELEASE_ID,body:final.body.replace('Windows、Linux、Intel Mac 不在本次产物验证范围。','其他平台现已追加，验证范围和签名状态见文末。')+note})
 await preflight(github,context)
 core.notice('Appended missing assets without replacing any original asset: '+final.html_url)
}
module.exports={hash,validate,preflight,publish}
