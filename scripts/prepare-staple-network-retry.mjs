import { appendFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

if (process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('This dependency wrapper is CI-only; local dependencies are not modified.')
}
const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('app-builder-lib/package.json'))
const filename = join(dirname(builderRequire.resolve('@electron/notarize')), 'staple.js')
const marker = '// Tabby bounded CloudKit transport retry'
if (!readFileSync(filename, 'utf8').includes(marker)) {
    const helper = new URL('./retry-staple-network.mjs', import.meta.url).href
    appendFileSync(filename, `\n${marker}\nconst tabbyOriginalStaple = exports.stapleApp;\nexports.stapleApp = async options => {\n    const { retryStapleNetwork } = await import(${JSON.stringify(helper)});\n    return retryStapleNetwork(() => tabbyOriginalStaple(options));\n};\n`)
}
