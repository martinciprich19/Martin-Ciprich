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
- Assign or remove Arena Admin access for an existing Supabase Auth account by email.
- Review authorized kiosk registrations and revoke a device.
- Send a global in-app announcement. If the existing `notifications` database webhook and push configuration are active, it also sends a push to users who opted in.
- Review an append-only audit log for Super Admin actions.

## Not yet implemented

The current kiosk registration schema has no heartbeat or command acknowledgement, so it cannot report online status, app version, battery/network state, or execute remote restarts/updates. Billing and license controls, feature-flag enforcement, player merging/ELO changes, and official result dispute workflows also need product rules and database support before they can safely be managed here.

Run the focused database test with `npm run test:super-admin`.
