# Owner refresh service

Small Cloudflare Worker for the site's owner sign-in and refresh controls. The scrape and Pages publication still run on GitHub. This Worker requires the account's **Workers Free** plan; do not enable paid plans, paid bindings, or automatic upgrades. If free service limits are reached, owner refresh requests fail and the saved public site remains available.

## Setup

1. Confirm **Workers plans → Free → Current plan** in the Cloudflare account. This is separate from a domain's plan. Confirmed by the owner's screenshot on 6 October 2026.
2. Review `wrangler.toml` and run `npx wrangler@4 deploy --dry-run`. Deploy with `npx wrangler@4 deploy`. No storage, logging, or billable bindings are configured.
3. Run `python owner-service/register_app.py` from the repository root. Open its loopback URL. Review the private GitHub app configuration, create it as **Arthur-Freedom**, then install it on **Only select repositories → bali-cinema-map**. The app needs Actions read/write and Metadata read. Creation/installation grants new security-sensitive access and needs the owner's action or confirmation.
4. The helper stores the client ID and secret only in ignored `owner-service/.local/github-app.json`. Pass them to `wrangler secret put GITHUB_CLIENT_ID` and `wrangler secret put GITHUB_CLIENT_SECRET` through stdin, without printing them. Generate at least 32 random bytes, base64url encoded, for `SESSION_SECRET`, and upload through stdin as well. Do not put secrets in `wrangler.toml`, the static bundle, Git, screenshots, or logs. Stop local static development servers before handling credentials.
5. Set the public `owner-refresh-config.json` `serviceUrl` to the deployed Worker origin only after setup is verified. Publish the static files and test the actual owner sign-in, one refresh, automatic reload, and sign-out. Keep the service URL empty until configured, so the existing GitHub workflow link remains usable.

## Security and behavior

- GitHub App user authorization uses OAuth state, PKCE, a short-lived HttpOnly cookie, and a fixed callback. The token is further restricted to the cinema repository ID.
- Identity is checked against GitHub numeric user ID `18115558`, including immediately before dispatch. User access tokens preserve owner attribution for the workflow's existing owner-only gate.
- The browser receives an AES-GCM encrypted session in a URL fragment, clears the fragment before third-party scripts run, and keeps the opaque token in this tab's session storage for at most one hour. Raw GitHub tokens and refresh tokens never enter the public site; refresh tokens are discarded.
- API routes require the site's exact origin and the encrypted bearer session. They only dispatch `pages.yml` on `main`, reuse an active run, and permit status reads for that workflow and branch. GitHub permission checks remain in effect. Sign-out revokes the GitHub user token.
- No arbitrary GitHub proxy, personal access token, database, refresh-token storage, Worker logging, or webhook processing is used.
- The site polls progress, then loads a snapshot whose refresh timestamp is at least the run creation time. It preserves the current movie and filters. Failed refreshes and delayed CDN updates do not erase the current listings.

Run `node --test owner-service/worker.test.mjs` (or `node owner-service/worker.test.mjs` when Windows child-process restrictions prevent `--test`). The tests cover OAuth state, PKCE, identity, session tampering/expiry, CORS, fixed dispatch scope, duplicate suppression, status scope, sanitized failures, and token revocation.

The private GitHub app can be uninstalled to revoke access. Removing the public service URL disables onsite controls; the original GitHub workflow remains available. Rotate `SESSION_SECRET` to invalidate all encrypted sessions.
