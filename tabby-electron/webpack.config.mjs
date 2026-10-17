import * as path from 'path'
import * as url from 'url'
const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

import config from '../webpack.plugin.config.mjs'

export default () => {
    const result = config({
        name: 'electron',
        dirname: __dirname,
    })
    // Native modules are loaded from the sealed packaged resources at runtime.
    // Webpack cannot evaluate createRequire(process.resourcesPath): its parser
    // otherwise replaces this dynamic call with undefined in production output.
    result.module.parser = { javascript: { createRequire: false } }
    return result
}
