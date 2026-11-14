import { handleSchedule } from '@vercel/schedules'
import { scaleProvider } from '../lib/scale-provider.ts'

export const POST = handleSchedule(async (metadata) => {
	console.log('Starting Amp provider', { schedule: metadata.name, executionId: metadata.executionId })
	await scaleProvider(1)
})
