import assert from 'node:assert/strict'
import test from 'node:test'
import { retryStapleNetwork } from '../../../scripts/retry-staple-network.mjs'

const networkError = () => new Error('Failed to staple your application with code: 68; NSURLErrorDomain Code=-1005')
test('CloudKit transport retry eventually preserves successful staple result', async () => {
    let calls = 0, pauses = 0
    const result = await retryStapleNetwork(async () => {
        if (++calls < 3) throw networkError()
        return 'stapled'
    }, async () => { pauses++ })
    assert.equal(result, 'stapled')
    assert.equal(calls, 3)
    assert.equal(pauses, 2)
})
test('persistent staple network failure still rejects after four attempts', async () => {
    let calls = 0
    await assert.rejects(retryStapleNetwork(async () => { calls++; throw networkError() }, async () => {}))
    assert.equal(calls, 4)
})
test('notarization rejection and unrelated errors never retry or become success', async () => {
    for (const error of [new Error('Notarization rejected'), new Error('Failed to staple your application with code: 65'), new Error('Failed to staple your application with code: 68; missing record')]) {
        let calls = 0
        await assert.rejects(retryStapleNetwork(async () => { calls++; throw error }, async () => assert.fail('must not delay')), e => e === error)
        assert.equal(calls, 1)
    }
})
