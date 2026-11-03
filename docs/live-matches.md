# Prebiehajúce zápasy

The `/live-matches` page lists active and paused matches in the RIVA Padel app. It refreshes every 15 seconds and can filter the list by region and arena. Paused matches display an amber "Prerušený zápas" badge instead of the green live badge. Selecting a match opens a read-only spectator view with the players, live score, and match statistics. Score controls remain available only through the regular scoring view.

Apply the entire `scripts/074_public_paused_matches.sql` after migrations through
073, then deploy the updated UI. It replaces the existing country-aware RPC,
adds only `paused_at` to its public return shape and includes paused matches.
Finished and ended-early matches remain excluded, as do unstarted or
unactivated official matches. Country and arena filtering remain unchanged.
No resume PIN, ownership token or pause-email data is exposed or modified.
After resuming, the next refresh displays the green live badge again.

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

## Deployment troubleshooting

`PGRST202` for `get_public_live_matches(p_country_code)` means the country-aware
signature is not available in the exposed API schema. Check the applied database
definitions and migrations 067, 068 and 069 in order; a website deployment does
not execute SQL migrations. If the function already exists, reload PostgREST's
schema with `notify pgrst, 'reload schema';` before considering reapplication.
Do not rerun older migrations over later definitions without checking them.

QR arena selection uses the selected browsing league and the SWR key
`['arenas', country]`, with a fetcher passing only the country to `fetchArenas`.
Changing league resets the in-progress QR setup so an arena selected in the
previous country is not retained. The match detail dialog requests the
all-country directory using `() => fetchArenas()`. Do not pass `fetchArenas` directly as the
fetcher for the string SWR key `arenas`: SWR passes that key as the first argument,
which would incorrectly filter `country_code` by the literal value `arenas`.
