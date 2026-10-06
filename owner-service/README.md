# Owner refresh service

Small Cloudflare Worker for the site's owner sign-in and refresh controls. The scrape and Pages publication still run on GitHub. This Worker requires the account's **Workers Free** plan; do not enable paid plans, paid bindings, or automatic upgrades. If free service limits are reached, owner refresh requests fail and the saved public site remains available.

## Setup

1. Confirm **Workers plans → Free → Current plan** in the Cloudflare account. This is separate from a domain's plan. Confirmed by the owner's screenshot on 6 October 2026.
2. Review `wrangler.toml` and run `npx wrangler@4 deploy --dry-run`. Deploy with `npx wrangler@4 deploy`. The dedicated `PUSH_DEVICES` KV binding uses Workers Free quotas. No paid plan, logging, or automatic upgrades are configured.
3. Run `python owner-service/register_app.py` from the repository root with outbound HTTPS access to `api.github.com`; a sandboxed helper without network access cannot exchange GitHub's setup code. Open its loopback URL. Review the private GitHub app configuration, create it as **Arthur-Freedom**, then install it on **Only select repositories → bali-cinema-map**. The app needs Actions read/write and Metadata read. Creation/installation grants new security-sensitive access and needs the owner's action or confirmation. If credentials already exist, the helper shows the existing app's installation link instead of creating another app.
4. The helper stores the client ID and secret only in ignored `owner-service/.local/github-app.json`. Pass them to `wrangler secret put GITHUB_CLIENT_ID` and `wrangler secret put GITHUB_CLIENT_SECRET` through stdin, without printing them. Generate at least 32 random bytes, base64url encoded, for `SESSION_SECRET`, and upload through stdin as well. Do not put secrets in `wrangler.toml`, the static bundle, Git, screenshots, or logs. Stop local static development servers before handling credentials.
5. Set the public `owner-refresh-config.json` `serviceUrl` to the deployed Worker origin only after setup is verified. Publish the static files and test the actual owner sign-in, one refresh, automatic reload, and sign-out. Keep the service URL empty until configured, so the existing GitHub workflow link remains usable.

## Security and behavior

- GitHub App user authorization uses OAuth state, PKCE, a short-lived HttpOnly cookie, and a fixed callback. The token is further restricted to the cinema repository ID.
- Identity is checked against GitHub numeric user ID `18115558`, including immediately before dispatch. User access tokens preserve owner attribution for the workflow's existing owner-only gate.
- The browser receives an AES-GCM encrypted session in a URL fragment, clears the fragment before third-party scripts run, and keeps the opaque token in this tab's session storage for at most one hour. Raw GitHub tokens and refresh tokens never enter the public site; refresh tokens are discarded.
- API routes require the site's exact origin and the encrypted bearer session. They only dispatch `pages.yml` on `main`, reuse an active run, and permit status reads for that workflow and branch. GitHub permission checks remain in effect. Sign-out revokes the GitHub user token.
- No arbitrary GitHub proxy, personal access token, refresh-token storage, Worker logging, or webhook processing is used. A dedicated private KV namespace stores owner-opted-in push subscriptions.
- The site polls progress, then loads a snapshot whose refresh timestamp is at least the run creation time. It preserves the current movie and filters. Failed refreshes and delayed CDN updates do not erase the current listings.

Run `node --test owner-service/worker.test.mjs` (or `node owner-service/worker.test.mjs` when Windows child-process restrictions prevent `--test`). The tests cover OAuth state, PKCE, identity, session tampering/expiry, CORS, fixed dispatch scope, duplicate suppression, status scope, sanitized failures, and token revocation.

The private GitHub app can be uninstalled to revoke access. Removing the public service URL disables onsite controls; the original GitHub workflow remains available. Rotate `SESSION_SECRET` to invalidate all encrypted sessions.

## Personal movie notifications

Open **New-movie alerts** on the site, sign in as the owner, choose **Enable movie alerts**, and allow browser notifications. On Android, Chrome supports this without installing an app. The manifest also supports Home Screen installation; on iPhone/iPad this is required for push. **Send test** dispatches the owner-only `push-test.yml` workflow for this device. **Turn off on this device** unsubscribes in the browser even after the owner session expires. Signing out alone preserves the opted-in alerts.

`PUSH_DEVICES` is a dedicated Cloudflare KV namespace, limited by the application to ten owner devices. Registrations require a valid owner session and a fresh GitHub identity check. Subscription endpoints and encryption keys remain private in KV, never in Git, Pages, artifacts, or logs. Only recognized HTTPS browser push hosts are accepted, with validated subscription key lengths. Requests are limited to 8 KB. The new registration's timestamp is its initial notification cursor, preventing a backlog of existing films.

Generate a persistent P-256 VAPID key pair. Set `VAPID_PUBLIC_KEY` in Worker vars and store the private key (base64url DER) only in GitHub Actions secret `VAPID_PRIVATE_KEY`. Configure the same random 32-byte base64url `PUSH_DISPATCH_SECRET` in Worker secrets and GitHub Actions secrets. This separately authenticates the fixed internal device-list and acknowledgement routes. Keep all keys out of command arguments and logs. Existing key pairs must be reused; replacing the public key requires devices to subscribe again.

After a successful Pages deployment and archive job, GitHub Actions sends one encrypted Web Push message per subscribed device for currently listed movies first observed after its last acknowledged notification. It verifies that the matching snapshot is publicly available before sending. The cursor advances only when the push provider accepts the message; temporary failures retry at a later successful refresh, and expired subscriptions (HTTP 404/410) are removed. A provider accepting a message is not proof it was displayed: device connectivity, Android notification settings, browser permissions and the 24-hour delivery TTL still apply. A crash between sending and acknowledging can cause a retry; deterministic notification tags replace matching notifications on the device. Tests do not advance real discovery cursors.

The service worker handles only notifications and notification clicks. It does not intercept fetches or cache schedules. `?new=ID,ID` opens the exact group of new titles named in a push. The normal website notice stores an acknowledgement timestamp locally; first visits initialize it without a backlog. Detailed source/price history remains excluded from Pages.

These alerts use standard GitHub public-repository runners, browser push services, and the existing Workers Free plan. KV Free currently includes 100,000 reads and 1,000 writes/deletes/list operations per day; over-limit operations fail rather than incur charges. Do not upgrade the account or enable paid bindings. See [Cloudflare KV pricing](https://developers.cloudflare.com/kv/platform/pricing/).
