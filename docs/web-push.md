# Web Push (FCM)

## Notification category switches

Apply migration `090_push_notification_preferences.sql` after 049 and 036 and
then apply `091_acceptance_notifications.sql` after 066 and 090. Deploy the web changes. The three profile notification switches save immediately
through an authenticated, own-profile RPC that merges just the selected key.
Failed saves keep the old switch value and display an error. Category changes
apply account-wide to all registered Android and browser devices.

The existing JSON keys are retained for compatibility despite their `email`
prefix; they now control Firebase push, not email delivery:

- `emailChallenges`: `challenge_request`, `pair_challenge` and
  `challenge_team_accepted` (default enabled).
- `emailMessages`: `message`, `new_message`, `direct_message` (default enabled).
- `emailTournaments`: tournament invitation/event and league `news` types
  including Super Admin `system_announcement` broadcasts (default disabled,
  explicit opt-in required).

`push_notification_tokens`, used by the shared Android/Web Firebase webhook,
checks these settings on the server before returning tokens. The master
`pushAlerts=false` overrides all categories. A category switch does not request
OS permission or register a device: users still enable **Notifikacie na mobile**
on each device. In-app inbox rows and badges are independent and are not deleted
or hidden by push category switches.

Friend requests, pair invitations and match-result/finished/paused alerts
remain controlled by the master push setting only; the
three category switches do not claim to control them. Existing already-delivered
or in-flight pushes cannot be recalled. Do not rerun migration 049 after 090
without reapplying 090 and 091, as 049 reinstalls the older recipient resolver.
Migration 091 creates one private notification when a pending friend request is
accepted, for the original requester. Once both members of the challenged pair
accept, it notifies both members of the challenging pair. The latter is a
read-only notification, not another accept/decline action.
The tournament switch filters notifications when inserted; it does not create
a tournament invitation sender or replay announcements to newly opted-in users.

Validate with `node --test scripts/push-preferences.test.mjs`.

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

For the numeric challenge/arena schema, apply
[105_challenge_notification_duplicates.sql](../scripts/105_challenge_notification_duplicates.sql)
after 066 and 069. It removes the identified legacy
`handle_new_challenge_notification` trigger and replaces the numeric
`create_challenge` function that inserted a second set of notifications.
Each invited player then receives one linked notification. It removes only
recognizable historical duplicates when a matching canonical notification exists;
unlinked alerts that cannot be matched unambiguously are retained. The migration
stops if the expected numeric function or the canonical insert trigger is missing.
Previously delivered push messages cannot be recalled. Challenge notifications
with a valid link expose a detail view of both pairs, player profiles, time and
venue; unavailable details show an error and retry.

### Confirmed challenge PINs and emails

Deploy the application changes **before** running
[106_challenge_pin_delivery.sql](../scripts/106_challenge_pin_delivery.sql),
after 042, 066, 069 and 105. The migration targets the numeric challenge schema
and verifies the installed acceptance functions. It makes the numeric
`accept_challenge` call the authenticated, row-locked
`respond_to_pair_challenge` workflow that creates the live match and PIN.
Future challenges already marked `confirmed` by all four participants with no
live match are repaired once; older or incomplete challenges are not modified.

Each participant receives a separate `challenge_match_ready` notification
linked to the challenge. Its text does not contain the PIN; the app retrieves
it through a participant-authorized RPC and shows it in the notification and
challenge detail. One private email job per participant is recorded in the same
transaction. The authenticated notification INSERT webhook (`/api/send-push`)
submits each PIN email even when the recipient has no push device or has
disabled challenge push; the last confirming player's browser also attempts
dispatch. A challenge push opt-out still suppresses the push itself.

The server needs `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`RESEND_API_KEY`, and `MATCH_EMAIL_FROM` with a verified sender domain.
The existing notification webhook and `PUSH_WEBHOOK_SECRET` must be configured
for background delivery independent of the confirming browser. No scheduler is
assumed: if both webhook and browser delivery fail, unsent jobs remain pending.
Any participant can use **Retry pending emails** on the PIN notification or
detail. Failed attempts are logged without losing the PIN, and successfully
submitted jobs are not resent; Resend idempotency keys protect retries within
the provider's idempotency window. Resend acceptance does not guarantee inbox
delivery. Test with four real participant accounts, and check webhook/server
logs and Resend delivery status if email does not arrive.

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
npm run test:push
node --experimental-vm-modules --test scripts/activity-notifications.test.mjs scripts/communication-notifications.test.mjs
```

This covers source inserts/RPCs through private push-token resolution, both
UUID/numeric legacy sender columns, an installation without 064, required titles,
bigint/UUID challenge links with preserved foreign keys, repeat installation,
recipient isolation and transactional notification failures.
It does not contact production Supabase or FCM.

## Completed and paused matches

After migrations 066 and 077 are installed, run the entire
[078_live_match_push_notifications.sql](../scripts/078_live_match_push_notifications.sql)
in Supabase SQL Editor. It creates private notifications for every registered
participant when a match result is recorded, with a personalized win/loss and
score. This replaces the ordinary `match_result` push where both rows exist;
the in-app alert opens match results. Existing result-approval alerts remain
available when no completed-match alert exists.

The same migration sends a notification to each registered match participant
when a match is paused. It includes the resume PIN in the push and in-app alert,
as requested. Android or browser lock screens may display the PIN to anyone who
can see the device. Unregistered quick matches with no known player profiles do
not have notification recipients. Each pause event is sent once; resuming and
pausing again sends the new PIN.

Messages, friend requests, pair invitations and pair challenges are handled by
066 and delivered by the existing `public.notifications` INSERT webhook. 078
does not recreate historical notifications. Deploy the updated app, retain the
single webhook on `public.notifications`, and trigger new events to test. Each
recipient must have push enabled on their own device.

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
  **before** enabling. Android browsers need Web Push support; the RIVA Android
  app uses native Firebase Cloud Messaging instead.
- Production requires HTTPS. Localhost is allowed for desktop development;
  an HTTP LAN address is not sufficient for a phone.
- Send a test through the authenticated diagnostic endpoint, background the PWA/lock the phone, and verify a single system
  notification. Clicking opens the local profile messages page.
- Test sending is authenticated, same-origin and limited to once per minute
  per account with registered tokens. It only targets the signed-in account.
- Notifications also display in the foreground using the same service worker.
  Server messages are data-only so FCM does not display a duplicate notification.
- In the RIVA Android app, enabling requests Android notification permission and
  registers the native FCM token through the current Supabase login. Android
  displays that data message through its notification manager; tapping opens the
  profile. Android token refresh is synchronized on authenticated app startup.
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
# In-app notification badge

Opening the bell or the league notifications tab marks the player's notifications
as read, including applicable announcements, using `mark_notifications_as_read`.
The bell badge is hidden while the notifications tab is open; new notifications
are marked as read there as well. If the update fails, an error and retry button
are shown. Chat messages and pending invitations retain their separate unread or
pending state and are not accepted or read merely by opening notifications.
