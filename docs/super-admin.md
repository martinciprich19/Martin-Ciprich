# Super Admin

The global dashboard is available at `/super-admin`. The page verifies the authenticated user's trusted Supabase `app_metadata.role`; all database actions independently enforce the same role in PostgreSQL. Do not copy this role into user-editable `user_metadata`.

## Database setup

Apply `scripts/079_super_admin_console.sql` in the Supabase SQL Editor after the app's arena, kiosk, and notification migrations (including `071_arena_admin_access.sql`, `076_authorized_kiosk_devices.sql`, `078_live_match_push_notifications.sql`, and `066_repair_activity_notifications.sql`). Migration 079 checks that the current arena schema uses the bigint arena IDs required by migration 071.

Grant the role only to the trusted platform owner, using the Supabase SQL Editor with the owner's actual login email:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || '{"role":"super_admin"}'::jsonb
where lower(email) = lower('owner@example.com');

select email, raw_app_meta_data ->> 'role' as role
from auth.users
where lower(email) = lower('owner@example.com');
```

Verify the update affected exactly the intended account. The user must sign out and back in to receive the updated role claim. Never expose a service-role key or add a role-changing action to the app.

## Available now

- View all arenas, activate/pause them, and create a club.
- Paused arenas are excluded from player arena searches and selection lists (including registration and home-club selection) on the next data refresh. Admin panels retain access to paused arenas. This visibility change does not itself revoke kiosk authorization or stop an ongoing match.
- Assign or remove Arena Admin access for an existing Supabase Auth account by email.
- Review authorized kiosk registrations and revoke a device.
- With migration 084 (after 081), both admin device lists show the latest heartbeat.
  Devices report every ~20 seconds; lists refresh every 15 seconds. Online means a
  signal within 90 seconds; no signal yet is unknown, and an older signal means
  no connection, not proof of hardware failure. Android 1.11 additionally reports
  battery, charging and APK version; browsers report presence only. Readings are
  device-reported and carry the server's last-seen timestamp, not a security
  attestation. RLS restricts reads to the appropriate arena manager/Super Admin.
- With migrations 080 and 081, use **Kurty a priradenie tabletu → Tablety a monitory kurtov** to claim a target device's one-time code from the admin device. Select its court and role (tablet or scoreboard); no admin login on the target is required. The same controls are available to assigned Arena Admins; the Android app retains native clicker input. See [tablet setup](./riva-android-app.md#assign-this-android-installation-to-a-court).
- Send a global in-app announcement. If the existing `notifications` database webhook and push configuration are active, it also sends a push to users who opted in.
- Review an append-only audit log for Super Admin actions.
- With migration 085 (after 079 and 072), **Statistiky zapasov** counts live
  matches by court and arena over rolling 24-hour, 7-day, one-month and one-year
  periods ending at the database's displayed calculation time. It refreshes every
  minute and includes quick games and rematches once per live match ID. Matches
  must have started and finished normally; early-ended and unfinished games,
  games without a court and manually entered results without a court live-match
  record are excluded. Paused courts/arenas retain their totals. A finished score
  counts even before final result approval; corrections can therefore change
  totals on refresh. Access is independently restricted to Super Admin by the RPC.

## Not yet implemented

Remote commands and acknowledgements, network diagnostics, restarts/updates are
not implemented. Billing and license controls, feature-flag enforcement, player
merging/ELO changes, and official result dispute workflows also need product rules
and database support before they can safely be managed here.

Run the focused database test with `npm run test:super-admin`.

## Clicker rental accounting

Apply `scripts/086_clicker_rentals.sql` after 080 and deploy the web app. No new
APK is required. Arena Admins record the handover of one **whole clicker set**
in **Správa arény → Prenájmy klikrov**, selecting an active court and 90 or 120
minutes and confirming the handover. Players do nothing extra; rematches never
create a rental. This is a staff-entered ledger, not proof of physical use or a
payment integration. Unrecorded rentals cannot be inferred reliably from matches.

The database fixes the price at EUR 2.00 / EUR 2.50 and the platform owner's 50%
share at EUR 1.00 / EUR 1.25 respectively. Prices, court/arena names, server time
and the staff user ID are stored with each record. No client-supplied price,
backdating, direct edits or deletes are permitted. Deletion of a referenced
arena/court is restricted; deactivate it instead. Retrying a request with the
same UUID is idempotent.

**Super Admin → Prenájmy klikrov** shows counts for each duration, customer
revenue and the platform owner's share by arena and court. The selected calendar
month uses Europe/Bratislava, including daylight-saving changes, and attributes
the entire rental to its recorded handover time. Summaries cover the full month;
history is paginated in batches of 100. This is a settlement basis, not an invoice
or a record of money already paid. Existing matches do not backfill rentals.

Only Super Admin can void an incorrect record, with a mandatory reason. The
record, original staff ID, void actor, reason and timestamps remain stored.
Voiding removes the charge from its original month, including closed past
months; there is no settlement locking or paid-status workflow. Arena staff
must request corrections from the platform owner. Report access is checked in
the database, independently of the UI; managers can only view their own arenas.

Validate with `node --test scripts/clicker-rentals.test.mjs`.
