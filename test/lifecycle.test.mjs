import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { scaleProvider } from '../lib/scale-provider.ts'
import { POST as start } from '../api/start-provider.ts'
import { POST as stop } from '../api/stop-provider.ts'

let requests
let savedEnv
beforeEach(() => {
	savedEnv = { ...process.env }
	Object.assign(process.env, {
		VERCEL_ENV: 'production', VERCEL_CONTROL_TOKEN: 'test-control-secret',
		DAEMON_PROJECT_ID: 'prj_test', DAEMON_TEAM_ID: 'team_test',
	})
	requests = []
	mock.method(globalThis, 'fetch', async (url, options) => {
		requests.push({ url: new URL(url), ...options })
		return Response.json({ ok: true })
	})
	mock.method(console, 'log', () => {})
})
afterEach(() => {
	process.env = savedEnv
	mock.restoreAll()
})

function event(name) {
	return new Request('https://example.test', {
		method: 'POST',
		headers: {
			'ce-specversion': '1.0', 'ce-type': 'com.vercel.schedule.v1beta',
			'ce-source': `/schedule/default/${name}`, 'ce-id': 'run_test',
			'ce-vssscheduleid': 'sched_test', 'ce-vssschedulename': name,
			'ce-vssnamespace': 'default', 'ce-vssscheduledat': '2026-11-14T11:30:00Z',
			'ce-vssschedulesource': 'static', 'ce-vssexpression': name === 'amp-provider-start' ? '0 17 * * *' : '0 5 * * *',
		},
	})
}

test('start/start/stop/stop repeats absolute production overrides', async () => {
	for (const count of [1, 1, 0, 0]) await scaleProvider(count)
	assert.deepEqual(requests.map(r => JSON.parse(r.body)), [{ iad1: 1 }, { iad1: 1 }, { iad1: 0 }, { iad1: 0 }])
	for (const r of requests) {
		assert.equal(r.method, 'PUT')
		assert.equal(r.url.origin, 'https://api.vercel.com')
		assert.equal(r.url.pathname, '/v1/projects/prj_test/daemons/amp-orb-provider/instances')
		assert.equal(r.url.searchParams.get('target'), 'production')
		assert.equal(r.url.searchParams.get('teamId'), 'team_test')
		assert.equal(r.headers.Authorization, 'Bearer test-control-secret')
		assert.equal(r.headers['Content-Type'], 'application/json')
		assert.ok(r.signal instanceof AbortSignal)
		assert.equal(r.redirect, 'error')
	}
})

test('team is optional and project identifier is encoded', async () => {
	delete process.env.DAEMON_TEAM_ID
	process.env.DAEMON_PROJECT_ID = 'project/with space'
	await scaleProvider(1)
	assert.equal(requests[0].url.searchParams.has('teamId'), false)
	assert.equal(requests[0].url.pathname, '/v1/projects/project%2Fwith%20space/daemons/amp-orb-provider/instances')
})

test('rejects missing credentials, invalid counts and non-production before fetching', async () => {
	await assert.rejects(scaleProvider(2), /zero or one/)
	for (const key of ['VERCEL_CONTROL_TOKEN', 'DAEMON_PROJECT_ID']) {
		const original = process.env[key]
		delete process.env[key]
		await assert.rejects(scaleProvider(1), /Missing/)
		process.env[key] = original
	}
	for (const environment of ['preview', 'development', '']) {
		process.env.VERCEL_ENV = environment
		await assert.rejects(scaleProvider(0), /only allowed in production/)
	}
	assert.equal(requests.length, 0)
})

test('HTTP, transport, timeout and unconfirmed responses fail without leaking details', async () => {
	for (const status of [401, 403, 404, 429, 500]) {
		globalThis.fetch.mock.mockImplementation(async () => new Response('test-control-secret', { status }))
		await assert.rejects(scaleProvider(0), { message: `Daemon scaling failed: HTTP ${status}` })
	}
	for (const error of [new Error('test-control-secret'), new DOMException('test-control-secret', 'TimeoutError')]) {
		globalThis.fetch.mock.mockImplementation(async () => { throw error })
		await assert.rejects(scaleProvider(0), { message: 'Daemon scaling request failed or timed out' })
	}
	for (const body of [{ ok: false }, {}, null, { ok: 'true' }]) {
		globalThis.fetch.mock.mockImplementation(async () => Response.json(body))
		await assert.rejects(scaleProvider(0), /not confirmed/)
	}
	globalThis.fetch.mock.mockImplementation(async () => new Response('test-control-secret'))
	await assert.rejects(scaleProvider(0), { message: 'Daemon scaling returned invalid JSON' })
})

test('private schedule handlers scale in both directions and propagate failures', async () => {
	assert.equal((await start(event('amp-provider-start'))).status, 200)
	assert.equal((await stop(event('amp-provider-stop'))).status, 200)
	assert.deepEqual(requests.map(r => JSON.parse(r.body)), [{ iad1: 1 }, { iad1: 0 }])
	globalThis.fetch.mock.mockImplementation(async () => new Response(null, { status: 403 }))
	await assert.rejects(stop(event('amp-provider-stop')), /HTTP 403/)
})

test('malformed schedule requests do not scale', async () => {
	for (const handler of [start, stop]) {
		assert.equal((await handler(new Request('https://example.test', { method: 'POST' }))).status, 400)
	}
	assert.equal(requests.length, 0)
})

test('configuration connects both private functions to daily IST schedules with zero defaults', async () => {
	const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'))
	assert.deepEqual(config.daemons['amp-orb-provider'].instances, { iad1: 0 })
	assert.deepEqual(config.daemons['orb-image'].instances, { iad1: 0 })
	assert.equal(Object.keys(config.schedules).length, 2)
	for (const [action, hour] of [['start', 17], ['stop', 5]]) {
		assert.deepEqual(config.schedules[`amp-provider-${action}`], {
			schedule: `0 ${hour} * * *`, timezone: 'Asia/Kolkata', function: `api/${action}-provider`,
		})
		assert.deepEqual(config.functions[`api/${action}-provider.ts`].experimentalTriggers, [{ type: 'schedule/v1beta' }])
		assert.equal(config.functions[`api/${action}-provider.ts`].maxDuration, 30)
	}
})
