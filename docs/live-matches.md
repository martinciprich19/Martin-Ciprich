# Prebiehajúce zápasy

The `/live-matches` page lists matches that are actively scored in the RIVA Padel app. It refreshes every 15 seconds and can filter the list by region and arena. Selecting a match opens a read-only spectator view with the players, live score, and match statistics. Score controls remain available only through the regular scoring view.

## Database setup

Apply `scripts/067_public_live_matches.sql` in the Supabase SQL Editor after the existing live-match migrations. The migration ensures `arenas.region` and `arenas.is_active` exist, copying the existing `active` values when that legacy column is present, then adds `get_public_live_matches()`, a restricted public RPC that returns only the names and current score of started matches that are not finished, ended early, or paused. Its arena ID uses the deployed `bigint` type. Arena metadata comes from the linked challenge arena or an exact match between a QR match's arena name and an active partner arena.

Quick games without an arena and QR matches whose arena name is not registered remain visible, but have no region/arena filter value. Populate `arenas.region` for partner arenas in Supabase to make regional filtering available for older arena records.

## National-league backend

After the already-applied `068_national_leagues.sql`, apply the **entire**
`scripts/069_national_league_routing.sql` before accepting Dutch writes. Do not edit
or reapply an earlier migration as a substitute. Migration 069 is repeatable and
does not move existing Slovak records, rewrite RLS, or replace score/approval guards.

- `get_public_live_matches(p_country_code text default null)` replaces the no-argument
  signature with a single defaulted signature. Existing `.rpc('get_public_live_matches')`
  calls still return all countries. Pass `{ p_country_code: 'NL' }` or `'SK'` to filter.
  Returned rows include `country_code`; `arena_id` remains the deployed `bigint`.
  Venue-name lookup only searches the game's country.
- `fetchPlayerProfiles(country?)`, `fetchLeaguePlayers(country?)`, `fetchPairs(country?)`
  and `fetchArenas(country?)` accept a `CountryCode`. No argument preserves the legacy
  all-country directory. `fetchPlayerProfiles({ includeDeleted: true })` still works;
  `(country, { includeDeleted: true })` is also supported.
- Profiles expose/persist `country_code`, `preferred_language` and `subdivision_code`.
  Registration metadata hydration from 068 remains in place. Country browsing must
  never call `updatePlayerProfile` to change membership. Membership updates are
  rejected, including when a profile already has pairs or match history; transfers
  require a future audited administrative workflow, not an ordinary settings save.
- Pair/challenge/result/player-request inserts derive country from participants or
  request owner, even through existing RPCs that omit country. Official matches
  require four distinct registered members of one league. Mixed-league pairs/games,
  mismatched explicit country, and known foreign-country arenas are rejected.
  ID validation compares actual arena ID text, without assuming UUID IDs.
- Anonymous quick games can explicitly insert `country_code: 'NL'`. Omitted country
  inherits the signed-in member's country, or SK for legacy anonymous clients.
  The existing rematch RPC copies the source country for anonymous quick games;
  registered replays derive it from their roster. No rematch RPC argument changes
  are required.
- Personal history, pending approvals, invitations and notifications stay scoped
  to the account, not the browsing country. Overview rank uses membership country.

Backend regression checks:

```powershell
node --test scripts\national-league-data.test.mjs scripts\national-league-routing.test.mjs
```
