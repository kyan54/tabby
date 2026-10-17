import { setTimeout } from 'node:timers/promises'

// Build-time only. A failed staple remains a failure; retry only the observed
// CloudKit transport error, never notarization rejection or signature errors.
export async function retryStapleNetwork (operation, pause = () => setTimeout(15000)) {
    for (let attempt = 1; ; attempt++) {
        try {
            return await operation()
        } catch (error) {
            const message = error instanceof Error ? error.message : ''
            if (attempt >= 4 || !message.includes('code: 68') ||
                !message.includes('NSURLErrorDomain Code=-1005')) {
                throw error
            }
            console.info(`Retrying CloudKit staple transport (${attempt}/3).`)
            await pause()
        }
    }
}
