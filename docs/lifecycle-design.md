# Provider lifecycle v1

## Problem and existing flow

The provider uses memory while it waits for Amp jobs. Amp sends spawn, pause, and delete jobs to `amp orb provider`, which invokes `provider/dispatch.mjs`. That program owns Sandbox and snapshot operations and authenticates with OIDC. The zero-instance `orb-image` daemon only publishes the base image during deployment.

## Usage and shape

The operator runs `amp-provider-start` or `amp-provider-stop` under Project > Schedules. Recurring runs request the same actions at 5 PM and 5 AM the following morning in Asia/Kolkata.

```ts
// api/start-provider.ts
await scaleProvider(1)
// api/stop-provider.ts
await scaleProvider(0)
// lib/scale-provider.ts
export async function scaleProvider(instances: 0 | 1): Promise<void>
```

Two private schedule handlers and a bearer-authenticated manual POST endpoint share one helper. The public endpoint uses a separate `AMP_PROVIDER_API_SECRET`, requests only one instance, and leaves schedule state unchanged. The helper hides project and team lookup from environment variables, production-only enforcement, API authentication, the fixed daemon and region, timeout, and confirmation parsing. It accepts only an absolute zero or one count, so retries converge on the same desired state. It resolves when Vercel confirms the override was saved, and throws a sanitized error otherwise. It does not wait for daemon readiness.

## Design decision and alternatives

The referenced conversation specified two private functions. A read-only design review also compared a single function routing on schedule names. Both isolate scheduling from the daemon. Two functions keep each action fixed in code and give each operation its own logs, without adding schedule-name routing to the application. A daemon-owned timer cannot wake the daemon from zero, so it cannot implement this lifecycle.

The provider and orb-image builds remain independent of the root function dependencies. The provider defaults to zero, but an existing Vercel scaling override takes precedence. Control API credentials are read only by the new helper; project environment variables are not assumed to be isolated from the daemon.

## Accepted limits and verification

V1 accepts a fixed daily cutoff without active-work detection or a drain protocol. It can interrupt dispatch and leaves running sandboxes untouched. Manual sessions started after the morning cutoff require manual shutdown. There is no retry schedule, expiry, or quota guard. These are v1.1 scope from the referenced design.

Local tests exercise the real schedule wrappers with a mocked API, repeated desired-state writes, production isolation, configuration mapping, and sanitized failure propagation. Type checking and a production dependency audit complement those tests. Deployment registration, daemon health, and an Amp pause/resume cycle require a linked project with Production credentials. See the README for that verification sequence.

## Sources

- [Schedule configuration](https://vercel.com/docs/schedules/configuration)
- [Private schedule handlers](https://vercel.com/docs/schedules/handle-runs)
- [Daemon scaling API](https://vercel.com/docs/rest-api/daemons/override-a-project-daemon-s-instance-counts)
- [Daemon scaling overrides](https://vercel.com/docs/daemons/managing-daemons)
