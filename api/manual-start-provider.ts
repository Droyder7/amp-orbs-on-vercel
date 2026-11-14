import { scaleProvider } from '../lib/scale-provider.ts'

export async function GET(request: Request): Promise<Response> {
	const headers = { 'Cache-Control': 'no-store' }
	if (request.method !== 'GET') {
		return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'GET' } })
	}
	try {
		await scaleProvider(1)
	} catch {
		console.error('Manual provider start failed')
		return Response.json({ error: 'Could not start the provider' }, { status: 502, headers })
	}
	return Response.json({ ok: true, daemon: 'amp-orb-provider', instances: 1, status: 'requested' }, { status: 202, headers })
}
