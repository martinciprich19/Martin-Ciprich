# Finished-match statistics

Apply [055_live_match_scoring_rules.sql](../scripts/055_live_match_scoring_rules.sql)
after 052 and 053 before using the new match-start screens. Quick games prompt
before insertion, PIN games before activation, and QR games after the fourth
player is scanned. Cancelling does not create/activate a match. The selected
`scoring_type` is persisted atomically with creation/activation; Realtime and
reloads retain `advantage_team`. Existing matches keep `golden_point`.
In `advantage` mode, 40:40 goes to AD, an opposing point returns to deuce,
and a second consecutive point wins the game. Golden Point ends the game
on the next point at 40:40. Undo restores advantage; reset clears it.
Rules cannot change after play begins. Break chances are counted only on an actual receiving game point;
deuce alone is not a break chance in advantage mode. Service games count only
game-ending points. New official statistics snapshots include the scoring mode.

Apply [056_live_match_tiebreak.sql](../scripts/056_live_match_tiebreak.sql)
after 055. At 6:6 in every set, both scoring modes automatically switch to a
numeric tiebreak: first to at least 7 with a two-point lead, finishing the set
7:6 or 6:7. `is_tiebreak` is generated from games; `tiebreak_score` stores both
point counters and the first server. The first player serves one point, then
players in the existing four-player service order serve two points each.
The next set starts with the server following the first tiebreak server.
Regular-game teammate rotation is unchanged. Manual server selection is disabled
during tiebreaks; reset restores its first server, undo restores the whole state.
Tiebreak points count toward totals, streaks and the actual server's point
statistics, but not break chances or service-game hold percentages.
Migration 056 converts existing visible 0/15/30/40 at 6:6 into 0/1/2/3, adds
one for any advantage and clears the ordinary game score. Earlier deuce rallies
and original service order cannot be recovered; affected recordings are marked
incomplete. Gemy, sets and already recorded counters are not erased. This
conversion runs only when the new column is first added; reruns retain live
tiebreak points. Existing historical extended sets remain valid.

The personal player QR code is shown near the top of Overview, not in the
Profile tab. "Enlarge QR code" opens a responsive modal with the same profile
URL, white scan margin, close button and native Escape/focus handling.
The installed app starts at `/profile?view=overview`; signed-out users are
redirected to login by the existing authentication guard.

Apply [053_extended_match_statistics.sql](../scripts/053_extended_match_statistics.sql)
after 052 before running the updated app. Service games won/lost are recorded
for the team serving the game-ending point (manual changes use the current server),
both match-wide and per set, and restored by undo. Hold serve is service games won
divided by all service games, not points won on serve. Older games remain unknown.
Official QR results receive an immutable `matches.live_statistics` snapshot
in the same transaction as the final point. Existing linked finished results
are backfilled only from recorded counters; no capability hashes are copied.
The official match modal reuses the full match/set comparison and serving-player
cards, including points, return points, streaks, break chances/conversions/misses
and hold serve. Manual results without live records display an unavailable notice.

The profile's own-serve card sums won/lost points for the participant's exact
team/player slot across all confirmed/approved results with complete recordings.
It uses a database aggregate (not a limited client page or an average of match
percentages), respects RLS and refreshes after confirmation. Pending, rejected,
unrecorded and partially recorded matches are excluded.
Zero opportunities is a dash; 0 wins out of positive opportunities is 0%.
Apply [054_profile_serve_return_statistics.sql](../scripts/054_profile_serve_return_statistics.sql)
after 053 for the cards inside the match-statistics grid: "Úspešnosť vlastného
podania" uses individual serve points; "Úspešnosť súperovho podania" uses points
won by the participant's pair on opponents' serve. The latter is opposing
players' serve points lost divided by their total serve points, not the opposing
team's serve success or personal receiving attribution. Both rates are weighted
across all fully recorded confirmed matches.
Two separate cards, "Vyhraté body z podania" and "Vyhraté body zo súperovho
podania", display the corresponding won-point counts as large values. Counts
are no longer small ratios beneath percentage rates. Explanations remain in
card tooltips; all four cards share loading and error/retry handling.
The "Recorded matches" coverage line is not displayed in these cards.
This presentation uses the existing aggregate RPC without a new migration.
Individual rally winners and individual receiving points are not tracked by
the team buttons: only the actual server's won/lost points are attributed to
an individual. Team total points must not be presented as personal rally wins.

The live scoreboard shows the serve draw only before the initial server is
chosen. The draw cannot be repeated or undone; point undo and manual server
selection remain available. There is no persistent synchronization badge.
Removing the draw row gives its space to the flexible team panels; score digits
and player cards scale with their available height. Save errors remain visible.

League matches (QR registration or challenge/PIN) show profile avatars next to
names on the live court, final result and player-stat cards. Quick games retain
text-only names and numbered stat cards. Apply
[051_live_match_player_avatars.sql](../scripts/051_live_match_player_avatars.sql)
after 048. The RPC resolves real participant IDs, never names; it exposes only
ordered avatar URLs to QR participants, challenge participants, or an activated
PIN scoreboard. Players without a photo use the existing initial avatar.
Photo load failures have an explicit retry notice and do not block scoring.

Apply [052_qr_matches_without_login.sql](../scripts/052_qr_matches_without_login.sql)
after 048, 050 and 051 to scan all four players without logging into the scanner.
Scanning identifies profiles, not account authentication. The creating browser
can also use "Zadať manuálne" inside any empty player card.
Manual search pauses the camera and queries only profile IDs, display names and
avatars after at least two characters (300 ms debounce, at most 20 results).
Names, surnames and nicknames use the existing `proffiles.full_name` display-name
field; there is no separate nickname column. Stale queries are aborted/ignored,
selected profiles are excluded, and errors offer retry. The dropdown supports
arrow keys, Enter and Escape. Search expands inside the selected card and closes
after selection. Manual selection fills that exact slot, even out of order;
QR scans fill the first empty slot. Removing the last player undoes the most
recent assignment without shifting teams. Both inputs share the duplicate guard
and open the scoring-rules dialog only once all four slots are filled.
"Skenovať znova" returns to camera input without losing the roster.
No new SQL migration or authentication bypass is added; existing profile RLS
and match creation/approval checks still apply.
The creating browser
stores a random device capability in localStorage before creation; only its hash
is stored in the database. Score writes include the capability in a request
header, never the match URL. Other devices can view these scoreboards and avatars
but cannot score them without that capability (or the existing organizer account).
Reloading in the same browser preserves scoring access; clearing site storage
loses the device key. The first scanned participant is the legacy `qr_created_by`
reference, not a claim that they logged in or approved the match.
Finishing submits a pending result with **zero approvals**; ELO still requires
all four players to approve in their own authenticated profiles.
Existing login-created QR matches retain their participant/organizer access.

QR setup loads the existing arena directory. Focusing the arena input or opening
its dropdown shows available arenas; typing filters names, cities and addresses
without case/accent sensitivity. Arrow keys and Enter select an option; Escape
closes the list. Custom arena names remain supported. Loading errors include a
retry action and do not block manual entry. No database migration is needed.

The camera viewfinder covers the central 70% of the shorter video dimension.
The scanner's crop and custom overlay share the same coordinates, including
portrait/landscape streams, object-cover scaling and mirrored front cameras.
Only that crop is decoded (no whole-frame fallback). Accepted player profiles
animate into their slots, flash a confirmation and vibrate briefly where supported.
Unknown or duplicate profiles do not produce success feedback. Reduced-motion
preferences disable arrival animations. After the fourth scan, a 450 ms confirmation
precedes automatic match creation; closing the scanner cancels that timer.

Apply [050_live_match_set_statistics.sql](../scripts/050_live_match_set_statistics.sql)
after 048 to persist per-set statistics. The filter defaults to **Entire match**;
**Set 1 / Set 2 / Set 3** switches both team and player stats. Set streaks restart
at each set boundary, while the match-wide streak can span sets. Set start/end
timestamps and counters are saved with every point and included in undo.
Game reset retains recorded points, just like match-wide counters.
Old completed sets and sets already in progress at upgrade show an explicit
unavailable message; their breakdown cannot be reconstructed. Later sets can
still be tracked independently. No totals are fabricated for missing sets.

The finished live match uses a two-team comparison with centered labels and
mirrored lime/blue bars, followed by separate serving-stat cards for all four
players. On small screens the player groups stack; the team comparison retains
both columns. The result screen scrolls independently of the fixed live court.

All values cover the entire match, not a single set. Set chips and duration
remain visible in the result summary. Existing save/approval states and the
warning for partially recorded historical matches are preserved.

- Serve success = recorded serve points won / all recorded serve points.
- Team return points won = the opposing team's recorded serve points lost.
- Total-point share = team points won / both teams' total points won.
- Break conversion = converted / (converted + missed). A chance is a rally
  where the receiving team has 40 before the point, including 40–40.
- Longest streak and each player's serve counters use existing persisted stats.
- No opportunities is displayed as a dash, not a claimed 0% success rate.
- Bars compare relative values; rates compare percentages, not sample sizes.
  A colored larger value is not necessarily better (e.g. serve points lost).

Untracked winners, errors, net points and first/second serves
are not inferred or displayed.

Validate calculations with `node --test scripts/match-statistics.test.mjs
scripts/live-match-scoring.test.mjs`; use the production build to check the UI.
