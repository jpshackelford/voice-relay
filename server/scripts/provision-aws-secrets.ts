/**
 * Provision (or rotate) AWS credentials for a Voice Relay user as OpenHands
 * user-level secrets. Implements the operational machinery described in
 * voice-relay issue #298.
 *
 * The script writes three secrets to the OpenHands account identified by the
 * supplied `OPENHANDS_API_KEY`:
 *
 *   - AWS_ACCESS_KEY_ID
 *   - AWS_SECRET_ACCESS_KEY
 *   - AWS_DEFAULT_REGION
 *
 * Every sandbox that user starts inherits these as environment variables, so
 * `aws s3 sync` etc. work out of the box from the agent server's bash
 * endpoint. The credentials MUST be scoped (via IAM) to the user's S3 prefix
 * — see docs/runbooks/aws-secrets-provisioning.md.
 *
 * Usage:
 *
 *   tsx server/scripts/provision-aws-secrets.ts \
 *     --user-id <voice-relay-user-id> \
 *     --openhands-api-key <user-key> \
 *     --aws-access-key-id <key> \
 *     --aws-secret-access-key <secret> \
 *     --aws-default-region us-west-2
 *
 * Any value-bearing flag can be replaced with its env-var equivalent:
 *
 *   OPENHANDS_API_KEY, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
 *   AWS_DEFAULT_REGION, VOICE_RELAY_USER_ID
 *
 * Re-running with the same arguments produces the same end state — the three
 * secrets exist with the supplied values. If a secret already exists the
 * script rotates it (DELETE then POST) because OpenHands' PUT endpoint only
 * updates name/description, not value (verified against the production
 * OpenAPI spec on 2026-05-24).
 *
 * Secret values are never logged. Only secret names and HTTP status codes
 * appear on stdout/stderr.
 */

const DEFAULT_BASE_URL = 'https://app.all-hands.dev';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BACKOFF_MS = 500;

/** Names of the three secrets the script provisions. Order is stable so that
 * the test suite can pin expectations. */
export const AWS_SECRET_NAMES = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_DEFAULT_REGION',
] as const;

export type AwsSecretName = (typeof AWS_SECRET_NAMES)[number];

/** Minimal HTTP surface this script depends on. Mockable in tests. */
export interface HttpResponseLike {
  status: number;
  ok: boolean;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export interface HttpClient {
  fetch(url: string, init: RequestInit): Promise<HttpResponseLike>;
}

/** Parsed CLI arguments. All `string | undefined` so missing required args
 * can be reported precisely. */
export interface ProvisionOptions {
  voiceRelayUserId?: string;
  openhandsApiKey?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsDefaultRegion?: string;
  baseUrl?: string;
  maxRetries?: number;
  retryBackoffMs?: number;
  dryRun?: boolean;
}

export interface SecretMeta {
  name: string;
  description?: string | null;
}

interface SecretPage {
  items: SecretMeta[];
  next_page_id?: string | null;
}

/** Per-secret outcome reported by `provisionAwsSecrets`. */
export type SecretAction = 'created' | 'rotated' | 'unchanged' | 'failed';

export interface SecretResult {
  name: AwsSecretName;
  action: SecretAction;
  status?: number;
  /** Error message; populated only when action === 'failed'. */
  error?: string;
}

export interface ProvisionResult {
  results: SecretResult[];
  ok: boolean;
}

const isRetryableStatus = (status: number): boolean =>
  status === 408 || status === 429 || status === 502 || status === 503 || status === 504;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Thin wrapper around `fetch` that retries 5xx-ish responses with linear
 * backoff and fails fast on 4xx. Returns the response object so the caller
 * can inspect status / body.
 */
async function requestWithRetry(
  http: HttpClient,
  url: string,
  init: RequestInit,
  maxRetries: number,
  backoffMs: number
): Promise<HttpResponseLike> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const res = await http.fetch(url, init);
      if (res.ok) return res;
      if (!isRetryableStatus(res.status)) return res;
      if (attempt === maxRetries) return res;
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries) {
        throw err;
      }
    }
    await sleep(backoffMs * attempt);
  }
  // Unreachable in practice — the loop always returns or throws — but the
  // type checker can't see that.
  throw lastError ?? new Error('requestWithRetry exhausted without response');
}

/**
 * Page through `GET /api/v1/secrets/search` and collect every secret name
 * the authenticated user owns. We only care about names; descriptions are
 * returned but values never are.
 */
export async function listSecretNames(
  http: HttpClient,
  baseUrl: string,
  apiKey: string,
  maxRetries: number,
  backoffMs: number
): Promise<Set<string>> {
  const names = new Set<string>();
  let pageId: string | null | undefined;
  let safety = 0;
  do {
    const url = new URL('/api/v1/secrets/search', baseUrl);
    url.searchParams.set('limit', '100');
    if (pageId) url.searchParams.set('page_id', pageId);
    const res = await requestWithRetry(
      http,
      url.toString(),
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      },
      maxRetries,
      backoffMs
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `listSecrets failed: HTTP ${res.status}${body ? ` body=${body.slice(0, 200)}` : ''}`
      );
    }
    const page = (await res.json()) as SecretPage;
    for (const item of page.items ?? []) {
      if (item?.name) names.add(item.name);
    }
    pageId = page.next_page_id ?? null;
    safety += 1;
    // Safety valve: 100 pages × 100 items/page = 10,000 secrets max. A user
    // hitting this almost certainly has a configuration/loop bug on the OH
    // side; bail loudly rather than spin forever.
    if (safety > 100) {
      throw new Error('listSecrets: pagination did not terminate after 100 pages');
    }
  } while (pageId);
  return names;
}

interface MutationContext {
  http: HttpClient;
  baseUrl: string;
  apiKey: string;
  maxRetries: number;
  backoffMs: number;
  dryRun: boolean;
}

async function createSecret(
  ctx: MutationContext,
  name: AwsSecretName,
  value: string,
  description: string
): Promise<HttpResponseLike | null> {
  if (ctx.dryRun) return null;
  const url = new URL('/api/v1/secrets', ctx.baseUrl).toString();
  return requestWithRetry(
    ctx.http,
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ name, value, description }),
    },
    ctx.maxRetries,
    ctx.backoffMs
  );
}

async function deleteSecret(
  ctx: MutationContext,
  name: AwsSecretName
): Promise<HttpResponseLike | null> {
  if (ctx.dryRun) return null;
  const url = new URL(
    `/api/v1/secrets/${encodeURIComponent(name)}`,
    ctx.baseUrl
  ).toString();
  return requestWithRetry(
    ctx.http,
    url,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${ctx.apiKey}`,
        Accept: 'application/json',
      },
    },
    ctx.maxRetries,
    ctx.backoffMs
  );
}

/**
 * Apply the three AWS secrets to the OpenHands user identified by
 * `options.openhandsApiKey`. Returns one result per secret; `ok === true`
 * iff every secret ended in {created, rotated, unchanged}.
 *
 * Validation is performed up-front: missing required arguments throw
 * synchronously so callers (and the test suite) can `await
 * expect(...).rejects` cleanly.
 */
export async function provisionAwsSecrets(
  http: HttpClient,
  options: ProvisionOptions
): Promise<ProvisionResult> {
  const apiKey = options.openhandsApiKey;
  const accessKeyId = options.awsAccessKeyId;
  const secretAccessKey = options.awsSecretAccessKey;
  const region = options.awsDefaultRegion;
  const userId = options.voiceRelayUserId;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const backoffMs = options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
  const dryRun = options.dryRun ?? false;

  const missing: string[] = [];
  if (!apiKey) missing.push('--openhands-api-key');
  if (!accessKeyId) missing.push('--aws-access-key-id');
  if (!secretAccessKey) missing.push('--aws-secret-access-key');
  if (!region) missing.push('--aws-default-region');
  if (!userId) missing.push('--user-id');
  if (missing.length > 0) {
    throw new Error(`Missing required argument(s): ${missing.join(', ')}`);
  }

  // Cheap format sanity checks to catch typos / pasted whitespace before
  // burning an HTTP round-trip. Patterns are intentionally permissive: AWS
  // access key IDs are 20 chars beginning with AKIA / ASIA / AIDA, and
  // standard region slugs are like `us-west-2` / `us-gov-east-1`. The check
  // does NOT cover the secret access key (no fixed format) or attempt to
  // verify the credential is live — that happens implicitly on first use.
  if (!/^(AKIA|ASIA|AIDA)[A-Z0-9]{16}$/.test(accessKeyId!)) {
    throw new Error(
      '--aws-access-key-id does not match expected AWS format (20 chars starting AKIA/ASIA/AIDA)'
    );
  }
  if (!/^[a-z]{2}-[a-z]+(-[a-z]+)?-\d$/.test(region!)) {
    throw new Error(
      '--aws-default-region does not match expected AWS region format (e.g. us-west-2)'
    );
  }

  const valuesByName: Record<AwsSecretName, string> = {
    AWS_ACCESS_KEY_ID: accessKeyId!,
    AWS_SECRET_ACCESS_KEY: secretAccessKey!,
    AWS_DEFAULT_REGION: region!,
  };

  const description = `Voice Relay workspace S3 credential for user ${userId}. Managed by provision-aws-secrets.ts (issue #298). Do not edit by hand.`;

  const existing = await listSecretNames(http, baseUrl, apiKey!, maxRetries, backoffMs);

  const ctx: MutationContext = {
    http,
    baseUrl,
    apiKey: apiKey!,
    maxRetries,
    backoffMs,
    dryRun,
  };

  const results: SecretResult[] = [];
  for (const name of AWS_SECRET_NAMES) {
    const value = valuesByName[name];
    const alreadyExists = existing.has(name);
    try {
      if (alreadyExists) {
        // OH does not support updating a secret's value via PUT (PUT only
        // touches name/description). Rotate by deleting then re-creating.
        const delRes = await deleteSecret(ctx, name);
        if (delRes && !delRes.ok) {
          const body = await delRes.text().catch(() => '');
          results.push({
            name,
            action: 'failed',
            status: delRes.status,
            error: `DELETE failed: HTTP ${delRes.status}${body ? ` body=${body.slice(0, 200)}` : ''}`,
          });
          continue;
        }
        const createRes = await createSecret(ctx, name, value, description);
        if (createRes && !createRes.ok) {
          const body = await createRes.text().catch(() => '');
          results.push({
            name,
            action: 'failed',
            status: createRes.status,
            error: `POST (after rotate) failed: HTTP ${createRes.status}${body ? ` body=${body.slice(0, 200)}` : ''}`,
          });
          continue;
        }
        results.push({
          name,
          action: dryRun ? 'unchanged' : 'rotated',
          status: createRes?.status,
        });
      } else {
        const createRes = await createSecret(ctx, name, value, description);
        if (createRes && !createRes.ok) {
          const body = await createRes.text().catch(() => '');
          results.push({
            name,
            action: 'failed',
            status: createRes.status,
            error: `POST failed: HTTP ${createRes.status}${body ? ` body=${body.slice(0, 200)}` : ''}`,
          });
          continue;
        }
        results.push({
          name,
          action: dryRun ? 'unchanged' : 'created',
          status: createRes?.status,
        });
      }
    } catch (err) {
      results.push({
        name,
        action: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const ok = results.every((r) => r.action !== 'failed');
  return { results, ok };
}

interface ParsedCli {
  options: ProvisionOptions;
  help: boolean;
}

/**
 * Parse argv into a `ProvisionOptions` bag. Falls back to environment
 * variables for any flag that wasn't supplied on the command line. Exported
 * for testing.
 */
export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): ParsedCli {
  const args = argv.slice();
  const opts: ProvisionOptions = {};
  let help = false;

  const consumeValue = (flag: string): string => {
    const next = args.shift();
    if (next === undefined || next.startsWith('--')) {
      throw new Error(`Flag ${flag} requires a value`);
    }
    return next;
  };

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === undefined) break;
    switch (arg) {
      case '-h':
      case '--help':
        help = true;
        break;
      case '--user-id':
        opts.voiceRelayUserId = consumeValue(arg);
        break;
      case '--openhands-api-key':
        opts.openhandsApiKey = consumeValue(arg);
        break;
      case '--aws-access-key-id':
        opts.awsAccessKeyId = consumeValue(arg);
        break;
      case '--aws-secret-access-key':
        opts.awsSecretAccessKey = consumeValue(arg);
        break;
      case '--aws-default-region':
        opts.awsDefaultRegion = consumeValue(arg);
        break;
      case '--base-url':
        opts.baseUrl = consumeValue(arg);
        break;
      case '--max-retries':
        opts.maxRetries = Number.parseInt(consumeValue(arg), 10);
        break;
      case '--retry-backoff-ms':
        opts.retryBackoffMs = Number.parseInt(consumeValue(arg), 10);
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  // Env-var fallbacks. CLI values win.
  opts.voiceRelayUserId ??= env.VOICE_RELAY_USER_ID;
  opts.openhandsApiKey ??= env.OPENHANDS_API_KEY;
  opts.awsAccessKeyId ??= env.AWS_ACCESS_KEY_ID;
  opts.awsSecretAccessKey ??= env.AWS_SECRET_ACCESS_KEY;
  opts.awsDefaultRegion ??= env.AWS_DEFAULT_REGION;
  opts.baseUrl ??= env.OPENHANDS_BASE_URL ?? DEFAULT_BASE_URL;

  return { options: opts, help };
}

export const HELP_TEXT = `Usage: tsx server/scripts/provision-aws-secrets.ts [options]

Provision (or rotate) AWS credentials as OpenHands user-level secrets for a
Voice Relay user. Writes AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and
AWS_DEFAULT_REGION as user-scoped secrets that get injected into every
sandbox the user starts.

Required (CLI flag or environment variable):
  --user-id <id>                  Voice Relay user id (VOICE_RELAY_USER_ID)
  --openhands-api-key <key>       OH user-level API key (OPENHANDS_API_KEY)
  --aws-access-key-id <key>       AWS access key id (AWS_ACCESS_KEY_ID)
  --aws-secret-access-key <key>   AWS secret key (AWS_SECRET_ACCESS_KEY)
  --aws-default-region <region>   AWS region, e.g. us-west-2 (AWS_DEFAULT_REGION)

Optional:
  --base-url <url>                OH base URL (default https://app.all-hands.dev)
  --max-retries <n>               5xx retry attempts (default 3)
  --retry-backoff-ms <ms>         Linear backoff per retry (default 500)
  --dry-run                       Print plan, mutate nothing
  -h, --help                      Show this help

Secret values are NEVER printed. Output contains only secret names and
HTTP status codes.

SECURITY NOTE:
  CLI flag values are visible to anyone who can read /proc on this host
  (e.g. \`ps\`, \`top\`, your shell history file). For production use prefer
  the environment-variable form of every credential argument so secrets
  never appear on the command line. The five required args all have
  env-var equivalents (see "Required" above).

See docs/runbooks/aws-secrets-provisioning.md for the full runbook.`;

/**
 * Default real-world HTTP client. Wraps the global `fetch`.
 */
export const realHttpClient: HttpClient = {
  async fetch(url, init) {
    const res = await fetch(url, init);
    return {
      status: res.status,
      ok: res.ok,
      text: () => res.text(),
      json: () => res.json(),
    };
  },
};

interface CliRunDeps {
  http: HttpClient;
  argv: string[];
  env: NodeJS.ProcessEnv;
  stdout: NodeJS.WriteStream | { write: (chunk: string) => void };
  stderr: NodeJS.WriteStream | { write: (chunk: string) => void };
}

/**
 * Top-level CLI entrypoint, exported for the test harness. Returns the
 * process exit code rather than calling `process.exit` directly so tests can
 * capture stdout/stderr cleanly.
 */
export async function runCli(deps: CliRunDeps): Promise<number> {
  const write = (s: string) => deps.stdout.write(s);
  const writeErr = (s: string) => deps.stderr.write(s);

  let parsed: ParsedCli;
  try {
    parsed = parseArgs(deps.argv, deps.env);
  } catch (err) {
    writeErr(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    writeErr(HELP_TEXT + '\n');
    return 2;
  }
  if (parsed.help) {
    write(HELP_TEXT + '\n');
    return 0;
  }

  let outcome: ProvisionResult;
  try {
    outcome = await provisionAwsSecrets(deps.http, parsed.options);
  } catch (err) {
    writeErr(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  for (const r of outcome.results) {
    if (r.action === 'failed') {
      writeErr(
        `[provision-aws-secrets] ${r.name}: failed${r.status ? ` status=${r.status}` : ''}${r.error ? ` ${r.error}` : ''}\n`
      );
    } else {
      write(
        `[provision-aws-secrets] ${r.name}: ${r.action}${r.status ? ` status=${r.status}` : ''}\n`
      );
    }
  }

  return outcome.ok ? 0 : 1;
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /provision-aws-secrets\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  runCli({
    http: realHttpClient,
    argv: process.argv.slice(2),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
  }).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`Unhandled error: ${err?.stack ?? String(err)}\n`);
      process.exit(2);
    }
  );
}
