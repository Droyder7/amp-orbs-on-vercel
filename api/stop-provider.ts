import { handleSchedule } from '@vercel/schedules'
import { scaleProvider } from '../lib/scale-provider.ts'

export const POST = handleSchedule(async (metadata) => {
	console.log('Stopping Amp provider', { schedule: metadata.name, executionId: metadata.executionId })
	await scaleProvider(0)
})
