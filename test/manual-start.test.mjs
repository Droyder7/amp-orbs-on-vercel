import assert from 'node:assert/strict'
import { beforeEach, afterEach, mock, test } from 'node:test'
import { POST } from '../api/manual-start-provider.ts'

let savedEnv
beforeEach(() => {
	savedEnv = { ...process.env }
	Object.assign(process.env, {
		VERCEL_ENV: 'production', AMP_PROVIDER_API_SECRET: 'test-manual-secret',
		VERCEL_CONTROL_TOKEN: 'test-control-secret', DAEMON_PROJECT_ID: 'prj_test',
	})
	mock.method(globalThis, 'fetch', async () => Response.json({ ok: true }))
	mock.method(console, 'log', () => {})
	mock.method(console, 'error', () => {})
})
afterEach(() => { process.env = savedEnv; mock.restoreAll() })

function request(authorization = 'Bearer test-manual-secret', method = 'POST') {
	return new Request('https://example.test/api/manual-start-provider', { method, headers: { authorization } })
}

test('missing, incorrect and same-length incorrect bearer tokens never reach Vercel', async () => {
	for (const token of ['', 'Bearer wrong', 'Bearer test-manual-secreX', 'test-manual-secret', 'Bearer test-control-secret']) {
		const response = await POST(request(token))
		assert.equal(response.status, 401)
		assert.equal(response.headers.get('cache-control'), 'no-store')
	}
	assert.equal(globalThis.fetch.mock.callCount(), 0)
})

test('disabled endpoint and non-POST requests never scale', async () => {
	assert.equal((await POST(request('', 'GET'))).status, 405)
	delete process.env.AMP_PROVIDER_API_SECRET
	assert.equal((await POST(request())).status, 503)
	assert.equal(globalThis.fetch.mock.callCount(), 0)
})

test('authenticated repeated starts request one instance and return accepted, not readiness', async () => {
	for (let i = 0; i < 2; i++) {
		const response = await POST(request())
		assert.equal(response.status, 202)
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
	assert.equal((await POST(request())).status, 502)
	assert.equal(globalThis.fetch.mock.callCount(), 0)
	process.env.VERCEL_ENV = 'production'
	globalThis.fetch.mock.mockImplementation(async () => new Response('test-control-secret', { status: 403 }))
	const response = await POST(request())
	assert.equal(response.status, 502)
	assert.deepEqual(await response.json(), { error: 'Could not start the provider' })
})
