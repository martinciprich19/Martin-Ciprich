# National leagues: Slovakia and the Netherlands

## Database rollout

Run these scripts in the Supabase SQL Editor, in order, before deploying the
country-aware application:

1. [068_national_leagues.sql](../scripts/068_national_leagues.sql): country and
   subdivision lookup data, profile preferences, legacy Slovak defaults.
2. [069_national_league_routing.sql](../scripts/069_national_league_routing.sql):
   country derivation and participant checks for league records, plus the
   country-aware public live-match RPC.

The first migration has already been applied by the project owner. The second
migration is a separate required database deployment; changing application files
does not apply SQL to Supabase.

## Country, language and membership

- Registration explicitly selects Slovakia or the Netherlands and a subdivision.
  Selecting a country defaults the language to Slovak or Dutch. The user can
  independently select English, Slovak or Dutch before submitting.
- The profile stores `country_code`, `preferred_language` and `subdivision_code`.
  Existing accounts remain in Slovakia.
- The league selector changes the directory being browsed, not membership or
  historical match country. Directory caches are partitioned by country.
- Rankings offer national, European and arena tabs. The national tab retains
  subdivision filtering. European rankings combine all supported national leagues
  (currently Slovakia and the Netherlands), sort players together by ELO and wins,
  and show each player's country. National subdivision filters do not restrict
  the European tab.
- Account settings and official match participants use the account's membership,
  even when another country's directory is open.
- Dutch provinces use canonical ISO codes, including `NL-FR` (Fryslân). The
  legacy `region` display column is retained for compatibility.

## External content

The public information, ranking, tournament and live-match pages read the verified
account session on the server. Signed-in visitors return to their account overview
through the logo and do not see login/registration prompts. Guests retain the
public homepage destination; kiosk navigation remains restricted to the match screen.

Supabase confirmation and recovery email templates are administered separately in
Supabase Authentication. Deploying this UI does not translate those hosted
templates. Use conditional templates based on registration metadata
(`preferred_language`) when configuring multilingual authentication emails.
Names, biographies, arena information and other user-authored content are not
automatically translated.

Existing arena records are initially assigned to Slovakia by migration 068.
An administrator must classify any existing Dutch venues with their correct
country and subdivision before they appear in the Dutch directory.
For the reviewed Flevopadel (Lelystad) and Zilinska arena (zilina) records, run
[070_classify_existing_arenas.sql](../scripts/070_classify_existing_arenas.sql).
It assigns Flevoland/NL and Zilina/SK respectively, leaves history untouched,
and clears only home/automatic venue links made incompatible by those assignments.
Names and cities must match exactly apart from case and surrounding whitespace;
missing or duplicate matches abort the transaction instead of guessing.
The existing match-announcer audio service supports Slovak and English;
Dutch written screens do not add a Dutch ElevenLabs voice configuration.
Pause/PIN emails use each recipient's saved language (Dutch, English or Slovak).

## Validation

Run the focused checks with:

```powershell
node --experimental-vm-modules --test scripts/countries.test.mjs scripts/league-provider.test.mjs scripts/national-leagues.test.mjs scripts/national-league-routing.test.mjs scripts/national-league-data.test.mjs scripts/localization.test.mjs scripts/match-pause-email.test.mjs scripts/auth-redirect.test.mjs scripts/auth-callback.test.mjs
```

In the browser, verify the Dutch registration form offers twelve provinces,
switching back restores eight Slovak regions, and language selection remains
independent of browsing country. Verify authenticated ranking and result entry
with real test accounts in each country after both migrations are applied.
