// Control-plane credentials are separate from dispatch.mjs's OIDC authentication.
export async function scaleProvider(instances: 0 | 1): Promise<void> {
	if (instances !== 0 && instances !== 1) throw new Error('Expected zero or one provider instance')
	if (process.env.VERCEL_ENV !== 'production') {
		throw new Error('Provider scaling is only allowed in production')
	}
	const { VERCEL_CONTROL_TOKEN: token, DAEMON_PROJECT_ID: projectId, DAEMON_TEAM_ID: teamId } = process.env
	if (!token?.trim() || !projectId?.trim()) {
		throw new Error('Missing VERCEL_CONTROL_TOKEN or DAEMON_PROJECT_ID')
	}
	const url = new URL(`https://api.vercel.com/v1/projects/${encodeURIComponent(projectId)}/daemons/amp-orb-provider/instances`)
	url.searchParams.set('target', 'production')
	if (teamId) url.searchParams.set('teamId', teamId)

	let response: Response
	try {
		response = await fetch(url, {
			method: 'PUT',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ iad1: instances }),
			signal: AbortSignal.timeout(15_000),
			redirect: 'error',
		})
	} catch {
		// Don't propagate request objects or upstream errors that may contain secrets.
		throw new Error('Daemon scaling request failed or timed out')
	}
	if (!response.ok) throw new Error(`Daemon scaling failed: HTTP ${response.status}`)
	let result: unknown
	try {
		result = await response.json()
	} catch {
		throw new Error('Daemon scaling returned invalid JSON')
	}
	if (typeof result !== 'object' || result === null || !('ok' in result) || result.ok !== true) {
		throw new Error('Daemon scaling was not confirmed')
	}
	console.log(`Saved amp-orb-provider override: iad1=${instances}`)
}
