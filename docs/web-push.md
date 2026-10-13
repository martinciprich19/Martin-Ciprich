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
   `https://YOUR-APP-DOMAIN/api/push/webhook`. Add headers
   `Content-Type: application/json` and
   `Authorization: Bearer YOUR_PUSH_WEBHOOK_SECRET`. Set the same long random
   secret as `PUSH_WEBHOOK_SECRET` on the app server. No webhook is required for
   the test button. Only events inserted into `notifications` trigger this hook;
   other tables (e.g. chat rows without a notification) are not push sources.

## User flow and verification

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
- Send a test, background the PWA/lock the phone, and verify a single system
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
Creating `user_push_tokens` alone is insufficient: migration 049 also installs
`register_push_token` and `reserve_push_test`. Recognized missing-schema errors
return `PUSH_SCHEMA_MISSING`. Registration derives the auth UUID on the server;
test reservation reads only that authenticated user's tokens. No local
notification is reported as a successful Firebase delivery.
