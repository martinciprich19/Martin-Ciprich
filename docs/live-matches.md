# Prebiehajúce zápasy

The `/live-matches` page lists matches that are actively scored in the RIVA Padel app. It refreshes every 15 seconds and can filter the list by region and arena. Selecting a match opens a read-only spectator view with the players, live score, and match statistics. Score controls remain available only through the regular scoring view.

## Database setup

Apply `scripts/067_public_live_matches.sql` in the Supabase SQL Editor after the existing live-match migrations. The migration ensures `arenas.region` and `arenas.is_active` exist, copying the existing `active` values when that legacy column is present, then adds `get_public_live_matches()`, a restricted public RPC that returns only the names and current score of started matches that are not finished, ended early, or paused. Its arena ID uses the deployed `bigint` type. Arena metadata comes from the linked challenge arena or an exact match between a QR match's arena name and an active partner arena.

Quick games without an arena and QR matches whose arena name is not registered remain visible, but have no region/arena filter value. Populate `arenas.region` for partner arenas in Supabase to make regional filtering available for older arena records.
