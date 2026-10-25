# Web Push (FCM)

## Deployment setup

1. Run [049_web_push_notifications.sql](../scripts/049_web_push_notifications.sql)
   in the Supabase SQL Editor after migration 036 (profile settings).
   `user_id` references `auth.users.id` (UUID), not
   the numeric `proffiles.id`. Tokens are private under RLS.
2. Create/register a **Web app** in Firebase project settings. Copy its API key,
   project ID, messaging sender ID and app ID into the public variables in
   [.env.push.example](../.env.push.example). Generate the public VAPID key under
   **Project settings > Cloud Messaging > Web Push certificates**.
3. Enable Firebase Cloud Messaging HTTP v1 and FCM Registration APIs.
4. Generate a service account key under **Project settings > Service accounts**.
   Configure `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` and
   `FIREBASE_PRIVATE_KEY` only on the server. The private key accepts literal
   newlines or escaped `\n`. Use the same Firebase project as the Web app.
5. Configure `SUPABASE_SERVICE_ROLE_KEY` only on the server. Never put service
   account keys, this key or the webhook secret into `NEXT_PUBLIC_*` variables.
   For local development, copy the example values into `.env.local` (ignored);
   on Vercel use environment settings. Redeploy after changing public variables.
6. For existing league alerts, create a Supabase **Database Webhook** for
   `public.notifications`, **INSERT**, method **POST**, URL
   `https://YOUR-APP-DOMAIN/api/send-push`. The existing `/api/push/webhook`
   remains a compatible alias; configure only one webhook to avoid duplicate sends. Add headers
   `Content-Type: application/json` and
   `Authorization: Bearer YOUR_PUSH_WEBHOOK_SECRET`. Set the same long random
   secret as `PUSH_WEBHOOK_SECRET` on the app server. No webhook is required for
   the test button. Only events inserted into `notifications` trigger this hook;
   other tables (e.g. chat rows without a notification) are not push sources.

Completed registered live matches insert a `match_result` notification for each
participant immediately with the final point (migration 063, after 062).
The same webhook delivers these as "Potvrď výsledok"; no separate kiosk-exit
request or additional webhook is needed. The in-app alert opens Results for
approval. Quick games and early termination without a result do not send alerts.

## Messages, friend requests, pair invitations and challenges

Run the entire [066_repair_activity_notifications.sql](../scripts/066_repair_activity_notifications.sql)
in Supabase SQL Editor with the existing league schema and migration 049 installed.
It includes the communication functionality from 064; 064 need not be run
separately. It replaces the older challenge notifier, which wrote numeric profile
IDs into the potentially UUID-typed legacy sender column. Do not rerun 021, 025
or 064 afterward: they would reinstall the older triggers.

Each new pending friend request, incoming message and pending pair invitation
inserts one private recipient notification. Each pending challenge notifies the
challenger's teammate and both opponents, but not its creator. These inserts
happen in the same transaction as the action. No browser-side notification insert is
needed. A failed notification insert rolls back the action and surfaces its
database error to the sender, rather than leaving an unnotified successful request.
Updates, invitation responses and read receipts do not produce new alerts.
Re-running the migration does not replay historical activities. Existing rows
are not deleted or backfilled, so testing requires new actions after installation.
The final SQL query should report four triggers, one per source table.

The migration requires numeric `notifications.user_id` profile IDs (the schema
used by the application's notification queries) and stops explicitly if the
recipient column is incompatible, rather than converting old data or broadcasting
private alerts. It populates both title/body and type/message, supporting legacy
required titles while keeping the application's existing notification format.
The trigger derives its challenge-link variable from the actual
`notifications.challenge_id` column type, preserving existing bigint, UUID or text
columns and their foreign keys. If an earlier version of 066 reported
`column "challenge_id" is of type bigint but expression is of type text` when
sending a request, rerun the entire updated 066 file, then send the request again.
The failed action was rolled back; rerunning the migration does not replay alerts.

These inserts use the same notifications INSERT webhook described above; no
additional webhook, Firebase credentials or e-mail service is needed. Each
recipient still needs to enable push on their own device. The profile receives
the in-app notification independently of push permissions. Message pushes contain
the sender's name, not the private chat text. `sender_profile_id` records numeric
profile IDs for conversation navigation and read receipts; nullable legacy
`sender_id` columns can remain UUID or numeric without changing existing data.
Per-source IDs prevent the installed triggers from inserting duplicate alerts.
The migration installs `notify_friend_request`, `notify_chat_message`,
`notify_pair_invitation` and `notify_pair_challenge_recipients_after_insert`; if
custom notification-writing triggers were installed outside this repository,
remove those redundant triggers before enabling the new ones.

### Checking automatic activity notifications

1. Deploy the updated app. Keep the existing single INSERT webhook on
   `public.notifications`; do not create webhooks on the four source tables.
   Supabase must be able to reach the deployed HTTPS URL, not `localhost`.
2. Use separate accounts/devices with push enabled. Send a new friend request,
   accept it, send a message, invite the friend into a pair, and create a challenge
   between two pairs.
3. Check `notifications`: the first three actions should create one row each for
   the recipient; a challenge creates three rows linked by `challenge_id`.
   `user_id` must be the recipient's numeric profile ID, never NULL for these
   actions; `sender_profile_id` identifies the sender.
4. Check notification INSERT webhook delivery logs if rows exist but no push
   arrives. A successful manually inserted global alert does not verify private
   recipient mapping: each recipient needs a saved device token associated with
   their auth account, a matching profile email, and push alerts enabled.
5. Open the alert to reach profile messages. Pair invitations use the existing
   invitations list with accept/decline controls; challenge alerts retain their
   participation controls. The profile badge counts each pending pair invitation
   only once, not again as a notification. Senders and unrelated accounts must not
   receive alerts.

Run the focused regression suite with:

```sh
node --experimental-vm-modules --test scripts/activity-notifications.test.mjs scripts/communication-notifications.test.mjs scripts/push-notifications.test.mjs
```

This covers source inserts/RPCs through private push-token resolution, both
UUID/numeric legacy sender columns, an installation without 064, required titles,
bigint/UUID challenge links with preserved foreign keys, repeat installation,
recipient isolation and transactional notification failures.
It does not contact production Supabase or FCM.

## User flow and verification

The mobile notification panel shows enable/disable controls without the generic
lock-screen explanation or a test-notification button. Installation requirements,
unsupported-browser warnings and action errors remain visible. The authenticated
test endpoint remains available for developer diagnostics, not as a user-facing
action.

### Local development without Firebase

When `NODE_ENV=development`, the hostname is `localhost`, `127.0.0.1` or `[::1]`,
and required public Firebase configuration is incomplete, the settings show
an explicitly labelled local test mode. Enabling requests browser notification
permission on click and saves a per-auth-user local opt-in. The test uses
`new Notification`, without FCM, token registration or the server test endpoint.
It is a permission/display test while the page is open, not automatic league
delivery or background/lock-screen push. Unsupported/blocked permissions and
storage/display failures are reported. Configured FCM, production and LAN hosts
never use this fallback. No fake Firebase credentials are needed.

Required public variables: `NEXT_PUBLIC_FIREBASE_API_KEY`,
`NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`,
`NEXT_PUBLIC_FIREBASE_APP_ID`, `NEXT_PUBLIC_FIREBASE_VAPID_KEY`.
`authDomain` and `storageBucket` are not required by this messaging-only client.
Restart dev after adding real values; public values require a rebuild for deployment.

- Use the banner in **Overview** or **Settings > Notifications**. Enabling is
  explicit: permission is never requested automatically.
- iPhone/iPad: iOS/iPadOS 16.4+, add to Home Screen and open from that icon
  **before** enabling. Android: use a Web Push capable browser.
- Production requires HTTPS. Localhost is allowed for desktop development;
  an HTTP LAN address is not sufficient for a phone.
- Send a test through the authenticated diagnostic endpoint, background the PWA/lock the phone, and verify a single system
  notification. Clicking opens the local profile messages page.
- Test sending is authenticated, same-origin and limited to once per minute
  per account with registered tokens. It only targets the signed-in account.
- Notifications also display in the foreground using the same service worker.
  Server messages are data-only so FCM does not display a duplicate notification.
- Disable removes this device's token. Normal profile logout disables this
  device before signing out. Other devices remain subscribed.
- A token refresh on authenticated app startup updates the saved registration;
  invalid FCM tokens are removed when sending. Explicitly enabling another
  account on a shared browser transfers that device's token to the new account.
- Webhook recipients are resolved from the stored notification (numeric profile
  or legacy auth UUID). Global notifications reach all subscribed accounts;
  persisted `settings.pushAlerts = false` opts an account out of league pushes.
  Explicit enabling sets this preference to true; background refresh does not.
- OS notification permissions, Focus/Do Not Disturb, battery restrictions and
  notification-preview settings govern lock-screen display. Delivery is not
  guaranteed if the browser is force-stopped or the device is offline.

The service worker uses `onBackgroundMessage`, the replacement for the legacy
`setBackgroundMessageHandler`. Firebase SDK 12 is pinned for the requested
registration-token workflow; the worker CDN version must match the client.
The npm and pnpm overrides pin gRPC 1.14.6 to avoid the advisories in Firebase's
older transitive gRPC dependency. Both lockfiles include this override.
No offline cache is added, so authenticated pages are not cached by this worker.

Run `npm run test:push`, TypeScript checking and `npm run build` after changes.
Actual FCM delivery needs real configured credentials and a supported device;
automated local tests do not prove lock-screen delivery.

The authenticated test endpoint returns HTTP 503 with `PUSH_CONFIG_MISSING`
and missing environment variable names (never values) before reserving tokens.
Malformed/non-RSA `FIREBASE_PRIVATE_KEY` returns `PUSH_PRIVATE_KEY_INVALID`
before reservation. The server accepts PEM newlines or escaped `\n`, not a full
JSON object, truncated key or JSON wrapping quotes. Copy the entire `private_key`
value from a newly generated service-account key into the production environment
and redeploy. Never send the private key in chat or commit it; revoke exposed keys.
Creating `user_push_tokens` alone is insufficient: migration 049 also installs
`register_push_token` and `reserve_push_test`. Recognized missing-schema errors
return `PUSH_SCHEMA_MISSING`. Registration derives the auth UUID on the server;
test reservation reads only that authenticated user's tokens. No local
notification is reported as a successful Firebase delivery.
