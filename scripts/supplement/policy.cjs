const VERSION = '1.0.238-fix'
const SOURCE = 'b72b9b6e2feb7b5e352afd6b47c2f41fce3bfcf1'
const RELEASE_ID = 416434182
const TAG = 'v'+VERSION
const original = [
 ['BUILD_INFO.json',653430197,458,'0ea7c8355905eb5f35cad5f5acc2ea8efa086b1725decd9f64946e8095cde8a6'],
 ['SHA256SUMS.txt',653430179,200,'4663e4826d7a5e0f0e93c6c92d2755f80e731f00e59614ff871fe6baf3ae6c93'],
 ['SIGNATURE_INFO.txt',653430203,769,'9350ab83b354d90da4f9b656a554577cd8a6c655215a26298e733f6abe924ff0'],
 [`tabby-${VERSION}-macos-arm64.dmg`,653429981,163416579,'79ff2d5a6b6cfbd8bef370f455ba9fb1955d0704d24a18f2d2dc7bd40d9c31e1'],
 [`tabby-${VERSION}-macos-arm64.zip`,653429790,158492927,'84bba035769c3fcba4b306b11a3695927da84fa2b82cc5ee09d6a9415bb2dc3c'],
].map(([name,id,size,sha256])=>({name,id,size,sha256}))
const matrix = [
 {platform:'macos',arch:'x86_64',extensions:['dmg','zip']},
 ...['x64','arm64'].map(arch=>({platform:'windows',arch,extensions:['exe','zip']})),
 ...['x64','arm64','armv7l'].map(arch=>({platform:'linux',arch,extensions:['AppImage','deb','rpm','pacman','tar.gz']})),
]
function namesFor (platform,arch) {
 if(platform==='macos')return [`tabby-${VERSION}-macos-${arch}.dmg`,`tabby-${VERSION}-macos-${arch}.zip`]
 if(platform==='windows')return [`tabby-${VERSION}-setup-${arch}.exe`,`tabby-${VERSION}-portable-${arch}.zip`]
 return matrix.find(x=>x.platform===platform&&x.arch===arch).extensions.map(ext=>`tabby-${VERSION}-linux-${arch}.${ext}`).concat(arch==='x64'?['tabby-web.tar.gz']:[])
}
const products=matrix.flatMap(m=>namesFor(m.platform,m.arch))
const metadata=['SHA256SUMS-additional.txt','BUILD_INFO-additional.json']
function assertIdentity (release,tagSHA) {
 if(release.id!==RELEASE_ID||release.tag_name!==TAG||release.name!==TAG||release.draft||release.prerelease||release.target_commitish!==SOURCE||tagSHA!==SOURCE)throw Error('Published release/tag identity changed')
 for(const old of original){const a=release.assets.find(x=>x.name===old.name);if(!a||a.id!==old.id||a.size!==old.size||a.digest!=='sha256:'+old.sha256)throw Error('Original release asset changed: '+old.name)}
 if(release.assets.some(x=>!original.some(o=>o.name===x.name)&&![...products,...metadata].includes(x.name)))throw Error('Unexpected release asset; stop')
}
function selectedNative(file,platform,arch){
 const normalized=file.replace(/\\/g,'/'),base=normalized.split('/').pop()
 const nativePlatform=platform==='macos'?'darwin':platform==='windows'?'win32':'linux'
 const nativeArch=arch==='x86_64'?'x64':arch==='armv7l'?'arm':arch
 const prefix=`russh.${nativePlatform}-${nativeArch}`
 if(base.startsWith('russh.'))return base.startsWith(prefix+'.')||base.startsWith(prefix+'-')
 const prebuild=normalized.match(/\/prebuilds\/([^/]+)\//)
 if(prebuild)return prebuild[1]===`${nativePlatform}-${nativeArch}`&&!base.includes('musl')
 return true
}
module.exports={VERSION,SOURCE,RELEASE_ID,TAG,original,matrix,namesFor,products,metadata,assertIdentity,selectedNative}
