import assert from 'node:assert/strict'
import { beforeEach, afterEach, mock, test } from 'node:test'
import { GET } from '../api/manual-start-provider.ts'

let savedEnv
beforeEach(() => {
	savedEnv = { ...process.env }
	Object.assign(process.env, {
		VERCEL_ENV: 'production',
		VERCEL_CONTROL_TOKEN: 'test-control-secret', DAEMON_PROJECT_ID: 'prj_test',
	})
	mock.method(globalThis, 'fetch', async () => Response.json({ ok: true }))
	mock.method(console, 'log', () => {})
	mock.method(console, 'error', () => {})
})
afterEach(() => { process.env = savedEnv; mock.restoreAll() })

function request(method = 'GET') {
	return new Request('https://example.test/api/manual-start-provider', { method })
}

test('non-GET requests never scale', async () => {
	assert.equal((await GET(request('POST'))).status, 405)
	assert.equal(globalThis.fetch.mock.callCount(), 0)
})

test('public repeated starts request one instance and return accepted, not readiness', async () => {
	for (let i = 0; i < 2; i++) {
		const response = await GET(request())
		assert.equal(response.status, 202)
		assert.equal(response.headers.get('cache-control'), 'no-store')
		assert.deepEqual(await response.json(), { ok: true, daemon: 'amp-orb-provider', instances: 1, status: 'requested' })
	}
	assert.equal(globalThis.fetch.mock.callCount(), 2)
	for (const call of globalThis.fetch.mock.calls) {
		assert.deepEqual(JSON.parse(call.arguments[1].body), { iad1: 1 })
		assert.equal(call.arguments[1].headers.Authorization, 'Bearer test-control-secret')
	}
})

test('preview execution cannot scale and upstream failure responses stay generic', async () => {
	process.env.VERCEL_ENV = 'preview'
	assert.equal((await GET(request())).status, 502)
	assert.equal(globalThis.fetch.mock.callCount(), 0)
	process.env.VERCEL_ENV = 'production'
	globalThis.fetch.mock.mockImplementation(async () => new Response('test-control-secret', { status: 403 }))
	const response = await GET(request())
	assert.equal(response.status, 502)
	assert.deepEqual(await response.json(), { error: 'Could not start the provider' })
})
