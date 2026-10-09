# Match Results

Apply `027_match_results_approval_elo.sql` in the Supabase SQL editor before deploying the updated Matches view. It requires the existing matches/profile tables and migration 012 for doubles participant columns. Player IDs must reference the bigint IDs in `proffiles`.

- `submit_match_result` validates the authenticated participant and standard best-of-three scores, then inserts a `pending` result. Submitting is not an automatic approval.
- All four participants explicitly approve through `respond_to_match_result`. Any rejection closes the result as `rejected`, without rating/statistic changes.
- The fourth approval atomically sets `confirmed`, updates each player's rating, highest rating, matches played and wins, and stores both team rating deltas. Row locks and `elo_applied` prevent repeat processing.
- Team ratings are averages of the two current player ratings. Expected score uses `1 / (1 + 10^((opponentRating - ownRating) / 400))`; K is 32. Each teammate receives the same rounded delta; the opposing team receives its exact negative.
- Confirmed results and legacy `approved` results are included in profile history. Existing approved results are not recalculated. Older pending results without `result_sets` must be entered again; their aggregate totals cannot safely reconstruct individual sets.
- Participant RLS and Supabase Realtime expose results to all four players. The UI also polls every 15 seconds and refreshes on focus/reconnect.

Run `pnpm test:matches` for isolated PostgreSQL approval, RLS, score-validation and ELO tests. On Windows without pnpm in PATH, run `npx.cmd --yes pnpm@10 test:matches`. Tests do not connect to Supabase or modify live data.

The integration tests use a minimal schema. Before production deployment, test with your actual schema and any existing matches/profile triggers, policies or enum-based status columns.

## Player accents

Apply `028_profile_gender.sql` so public profiles, rankings, player searches, friends, chat headers and match details can display the gender saved during registration. Female avatars use pink (`#f472b6`); male and legacy profiles without a selection use lime (`#ccff00`). Photographs retain a colored ring. Missing-column compatibility emits a migration warning instead of preventing older deployments from loading players.

Run `node --test scripts/player-accent-installation.test.mjs scripts/profile-gender.test.mjs scripts/match-detail.test.mjs` to check accent colors, gender persistence, match participant mapping, schema compatibility and installation-platform detection. Installation help is available on the landing page and profile header; installed mode hides the profile install button and offers an already-installed explanation on the landing page. The iOS guide must also be checked on a physical iPhone/iPad in Safari.

## Appearance and app icons

The application always uses the dark theme; settings no longer offer a theme switch and previously saved `riva-theme` preferences are ignored. The shared logo, manifest icons (192 and 512 pixels), browser icon and Apple touch icon use the RIVA Padel Play Together artwork. New asset filenames avoid cached copies of the previous logo. Existing iOS Home Screen shortcuts may need to be removed and added again after deployment to refresh their icon.

Android/browser chrome uses the profile background color `#0b0f17` through viewport and manifest theme colors. The manifest launch background uses the same color. iOS standalone uses Apple's `black` status-bar style; iOS controls the exact system-bar shade rather than supporting an arbitrary CSS color.

Run `node --test scripts/dark-branding.test.mjs` to verify permanent dark styling, manifest configuration, icon dimensions and artwork consistency.

The compact logo assets remove only the artwork's excess dark margins, retaining the full symbol, RIVA Padel name and Play Together tagline. Artwork occupies over 80% of the square's width for better readability in the UI and Home Screen icons.

All authenticated profile tabs and public player profiles share a viewport-fixed, centered `cover` background. It fills the screen without letterboxing or stretching; image edges are cropped as necessary for the screen's aspect ratio. The background is independent of page length and covers the viewport when mobile browser toolbars expand or collapse.

## Legacy UUID pair invitations

For deployments whose `pair_invitations` uses UUID `id`, `sender_id` and `receiver_id` referencing `auth.users`, run `039_repair_uuid_pair_invitations.sql` in the Supabase SQL editor instead of rerunning 020. It preserves the original table as `pair_invitations_uuid_backup`, maps accounts to numeric profiles by case-insensitive email and transfers invitations without automatically accepting them. Missing/ambiguous profile mappings, unsupported statuses or duplicate pending pairs abort the transaction rather than discard data. Client access to the backup is revoked; existing pairs remain untouched. The RPC writes the accepting profile into `pairs.created_by`.

Run `node --test scripts/pair-invitations-repair.test.mjs` for isolated migration, repeat-run, rollback and acceptance tests. This does not verify the live database's additional constraints or triggers.

## My pairs

Apply `040_delete_my_pair.sql` in the Supabase SQL editor before using pair deletion. In the Challenge a pair tab, "My pairs" lists only pairs containing the signed-in profile. "Delete pair" requires confirmation and permanently deletes the pair for both members. The `delete_my_pair` RPC verifies membership in the database; direct client DELETE access is revoked. Existing challenges, invitations and match results are preserved. A new pair still requires a new invitation and acceptance.

Run `node --test scripts/delete-pair.test.mjs scripts/pair-invitations-repair.test.mjs` for isolated deletion, authorization, identifier compatibility and invitation regression tests. These tests do not modify the live database; apply the migration separately and verify any additional production constraints or triggers.