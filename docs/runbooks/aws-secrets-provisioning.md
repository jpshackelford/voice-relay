# Runbook: AWS Workspace Credentials via OpenHands User Secrets (Issue #298)

Voice Relay's workspace-persistence flow (issues #299 and #300) needs every
sandbox the user starts to be able to read and write a specific S3 prefix
holding their `/workspace` snapshots. This runbook covers the operational
procedure for getting AWS credentials into those sandboxes safely.

We use **OpenHands user-level secrets**. After provisioning:

- The user's OpenHands account has three secrets: `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, and `AWS_DEFAULT_REGION`.
- Every sandbox that user starts (across every conversation, every
  integration that uses their OpenHands account) inherits those secrets as
  environment variables.
- The `aws` CLI inside the sandbox works automatically for the user's S3
  prefix, and **only** for that prefix, because we scope the IAM credential
  before handing it to the user (see [IAM scoping](#iam-scoping)).

> **No source code that runs at request time changes here.** This issue
> ships only operational machinery: a provisioning script + this runbook.
> The runtime path that uses the credentials lives in #299 / #300.

## Prerequisites

Before running the script you need:

1. **AWS bucket** named `voice-relay-workspaces` (or whatever the prod
   bucket is) in the Voice Relay AWS account. Out of scope for this runbook
   to create.
2. **IAM credential scoped to one prefix.** Either an IAM user or a long-
   lived access-key on an assumed-role identity, restricted to the user's
   prefix. See [IAM scoping](#iam-scoping) for the exact policy template.
3. **Voice Relay user id** for the user being onboarded. The script uses
   this only for the secret description; the bucket prefix it implies is
   the operator's responsibility to enforce in the IAM policy.
4. **User-level OpenHands API key** for the same user. Voice Relay does
   **not** have a system-level admin key that can write secrets on behalf
   of every user — OpenHands secrets are intentionally per-user. The user
   must hand the operator their key (see [How users get a key](#how-users-get-an-openhands-api-key)),
   or the operator can run the script in the user's own OpenHands account
   using a self-service flow.
5. **Node 20+** with the repository checked out (you'll run via `tsx`).

## IAM scoping

The AWS credentials the script writes are **not** root credentials. Each
user gets an IAM principal with a policy that grants only:

- `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on
  `voice-relay-workspaces/<voice-relay-user-id>/*`
- `s3:ListBucket` on the bucket, conditioned on the prefix
- Nothing else

Example policy (paste into the IAM user / role attached to the access-key
pair you'll hand to the script):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "WorkspacePrefixObjects",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::voice-relay-workspaces/<USER_ID>/*"
    },
    {
      "Sid": "WorkspacePrefixList",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::voice-relay-workspaces",
      "Condition": {
        "StringLike": { "s3:prefix": ["<USER_ID>/*", "<USER_ID>/"] }
      }
    }
  ]
}
```

Replace `<USER_ID>` with the Voice Relay user id.

> **Why scoping matters.** OpenHands secrets are injected into *every*
> sandbox that user starts — including conversations not initiated by
> Voice Relay. Any tool / agent the user runs sees the AWS credentials in
> environment variables. With the policy above the worst a misbehaving
> tool can do is read/write that user's own prefix. Without the scoping
> the blast radius is the whole bucket. Do not skip this step.

## How users get an OpenHands API key

1. Sign in to https://app.all-hands.dev.
2. Click the user menu → **API Keys** → **New API Key**.
3. Copy the key into a secure place; OpenHands does not show it again.

## Provisioning a new user

From the repository root:

```bash
npm install --workspaces

tsx server/scripts/provision-aws-secrets.ts \
  --user-id <voice-relay-user-id> \
  --openhands-api-key <user-oh-key> \
  --aws-access-key-id AKIA... \
  --aws-secret-access-key wJalrXUtnFEMI/... \
  --aws-default-region us-west-2
```

Every flag also reads from an environment variable, which is the safer
form for shell history and CI:

| Flag                          | Environment variable      |
| ----------------------------- | ------------------------- |
| `--user-id`                   | `VOICE_RELAY_USER_ID`     |
| `--openhands-api-key`         | `OPENHANDS_API_KEY`       |
| `--aws-access-key-id`         | `AWS_ACCESS_KEY_ID`       |
| `--aws-secret-access-key`     | `AWS_SECRET_ACCESS_KEY`   |
| `--aws-default-region`        | `AWS_DEFAULT_REGION`      |
| `--base-url`                  | `OPENHANDS_BASE_URL`      |

So the idiomatic invocation is:

```bash
export OPENHANDS_API_KEY=...
export AWS_ACCESS_KEY_ID=AKIA...
export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/...
export AWS_DEFAULT_REGION=us-west-2
export VOICE_RELAY_USER_ID=<voice-relay-user-id>

tsx server/scripts/provision-aws-secrets.ts
```

Expected output on first run (no values are ever printed):

```text
[provision-aws-secrets] AWS_ACCESS_KEY_ID: created status=201
[provision-aws-secrets] AWS_SECRET_ACCESS_KEY: created status=201
[provision-aws-secrets] AWS_DEFAULT_REGION: created status=201
```

Exit code `0` means all three secrets are now in place.

### Dry-run

Add `--dry-run` to verify connectivity and existing state without writing
anything:

```bash
tsx server/scripts/provision-aws-secrets.ts --dry-run ...
```

Dry-run reports `unchanged` for every secret (whether or not it currently
exists).

## Rotating credentials

The same script rotates existing secrets — that is its **default
behaviour** for any secret already present in the user's account. The
OpenHands API's `PUT /api/v1/secrets/{id}` endpoint only updates a
secret's name/description (not its value), so the script issues
`DELETE` + `POST` for each existing entry. End state always matches the
input values.

```bash
# 90-day rotation: create a new AWS access-key pair in IAM, then run:
tsx server/scripts/provision-aws-secrets.ts \
  --user-id <voice-relay-user-id> \
  --openhands-api-key <user-oh-key> \
  --aws-access-key-id <new-key> \
  --aws-secret-access-key <new-secret> \
  --aws-default-region us-west-2
```

Output on rotate:

```text
[provision-aws-secrets] AWS_ACCESS_KEY_ID: rotated status=201
[provision-aws-secrets] AWS_SECRET_ACCESS_KEY: rotated status=201
[provision-aws-secrets] AWS_DEFAULT_REGION: rotated status=201
```

After rotation, **disable the old access-key pair in IAM** (don't delete
it immediately — leave it disabled for ~24h in case a sandbox started
before rotation is still running). Delete after the cool-down.

### Recommended cadence

- **Every 90 days** for routine rotation.
- **Immediately** if you suspect the key has been exposed (e.g., the user
  pasted env contents into a public conversation log or repo).

## Verifying the secrets land in a sandbox

Smoke test against a freshly-started sandbox in the target OpenHands
account:

```bash
# Start a new conversation in the OpenHands UI (or via API), then in the
# sandbox shell:
env | grep -E '^(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_DEFAULT_REGION)='
# Expect three lines. Values should be the ones you just provisioned.

aws sts get-caller-identity
# Should print the IAM user/role ARN scoped to this user.

aws s3 ls s3://voice-relay-workspaces/<USER_ID>/
# Should succeed. May be empty if the user hasn't persisted yet.

aws s3 ls s3://voice-relay-workspaces/some-other-user-id/
# Should fail with AccessDenied. If it succeeds, the IAM policy is
# over-permissive — STOP and fix the policy before proceeding.
```

Redact `aws sts get-caller-identity` output before pasting it anywhere; it
contains the IAM user ARN, which may be sensitive.

## Failure modes

| Symptom                                                | Likely cause                                                                                                | Resolution                                                                                                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Script exits 2 with `Missing required argument(s)`     | A required flag (or its env var fallback) wasn't supplied                                                   | Re-run with the missing flag                                                                                                                |
| Script exits 1 with `HTTP 401`                          | `OPENHANDS_API_KEY` is wrong, revoked, or belongs to a different account                                    | Have the user re-issue an API key (Settings → API Keys) and re-run                                                                          |
| Script exits 1 with `HTTP 400` and `Secret already exists` | Should not happen — the script DELETEs before POSTing. Indicates a race or partial prior run                | Re-run; the script will detect the existing secret and rotate it                                                                            |
| Script exits 1 with `HTTP 503` after 3 attempts        | OpenHands app server is degraded                                                                            | Wait 5 minutes and re-run. Check https://status.all-hands.dev                                                                               |
| In-sandbox `aws` returns `AccessDenied` on user prefix | IAM policy doesn't grant the right action, or the access-key was disabled                                   | Inspect the policy attached to the IAM user the script wrote; verify the access-key is still active                                          |
| In-sandbox `aws` works on *other* prefixes             | IAM scoping is missing or too broad                                                                         | Revoke the access-key immediately, fix the policy, rotate with the script                                                                   |

## Security checklist

When you run the script, double-check:

- [ ] You're using a **user-scoped IAM credential** (not the root or
      operator AWS credentials).
- [ ] The IAM policy grants only the four S3 actions listed in
      [IAM scoping](#iam-scoping), restricted to one prefix.
- [ ] You're invoking with `--openhands-api-key` (or `OPENHANDS_API_KEY`
      env var), **not** a system-level admin key.
- [ ] Secrets are passed via env vars or `--aws-secret-access-key` on the
      command line. **Do not check them into any repo.**
- [ ] Your shell history / CI logs do not capture the credentials. Use
      `read -s` interactively or pass them through a temp-file-based
      secret manager.
- [ ] The user understands these creds will be visible to every other
      integration that uses their OpenHands account, mitigated by IAM
      scoping.

## Out of scope for this issue

- Creating the IAM user / role / access-key in AWS. Done out-of-band by an
  operator with AWS console access.
- A UI for self-service provisioning. Future enhancement.
- Automatic key rotation on a schedule. Manual today; can be wired to a
  scheduled OpenHands automation or CI cron later.
- The runtime path that consumes the credentials (`aws s3 sync` from
  inside the sandbox). That's issue #299 (workspace restore) and #300
  (workspace snapshot).

## Reference

- Issue: https://github.com/jpshackelford/voice-relay/issues/298
- OpenHands platform notes: `docs/openhands-platform.md` § Secrets
- Architecture: `docs/architecture.md` § Phase 5 — Workspace persistence
- OpenHands API: `POST /api/v1/secrets`, `GET /api/v1/secrets/search`,
  `DELETE /api/v1/secrets/{secret_id}` (verified against production
  OpenAPI spec on 2026-05-24)
