function runtimeEnvironment(original){
 const env={...original}
 for(const key of ['RUST_TARGET_TRIPLE','ELECTRON_RUN_AS_NODE','TABBY_RELEASE_VERSION','NODE_PATH','NODE_OPTIONS','npm_config_node_gyp'])delete env[key]
 return env
}
module.exports={runtimeEnvironment}
