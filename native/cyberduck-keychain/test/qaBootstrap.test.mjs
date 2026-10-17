import assert from 'node:assert/strict'
import test from 'node:test'
import { canBootstrapForQA } from '../../../scripts/qa-bootstrap-policy.mjs'

test('QA bootstrap requires explicit enabled V1 fuse and fails closed otherwise', () => {
    assert.equal(canBootstrapForQA({ version: '1', 0: 49 }), true)
    for (const wire of [undefined, {}, { version: '2', 0: 49 }, { version: '1', 0: 48 }, { version: '1', 0: 114 }, { version: '1', 0: 144 }, { version: '1', 0: true }, { version: '1', 0: '1' }]) {
        assert.equal(canBootstrapForQA(wire), false)
    }
})
