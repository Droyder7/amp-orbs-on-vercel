import { timingSafeEqual } from 'node:crypto'
import { scaleProvider } from '../lib/scale-provider.ts'

export async function POST(request: Request): Promise<Response> {
	const headers = { 'Cache-Control': 'no-store' }
	if (request.method !== 'POST') {
		return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'POST' } })
	}
	const secret = process.env.AMP_PROVIDER_API_SECRET
	if (!secret?.trim()) {
		return Response.json({ error: 'Manual start is not configured' }, { status: 503, headers })
	}
	const actual = Buffer.from(request.headers.get('authorization') ?? '')
	const expected = Buffer.from(`Bearer ${secret}`)
	if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
		return Response.json({ error: 'Unauthorized' }, { status: 401, headers })
	}
	try {
		await scaleProvider(1)
	} catch {
		console.error('Manual provider start failed')
		return Response.json({ error: 'Could not start the provider' }, { status: 502, headers })
	}
	return Response.json({ ok: true, daemon: 'amp-orb-provider', instances: 1, status: 'requested' }, { status: 202, headers })
}
