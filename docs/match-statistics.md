# Finished-match statistics

## Bluetooth HID clickers during play

On the live match screen, Bluetooth camera shutters that send keyboard/media
keydown events use the same scoring actions and voice announcements as the UI:

- Team 1: `VolumeUp`, `AudioVolumeUp`, `Space` (including the standard
  single-space key value), or the existing `A` shortcut.
- Team 2: `VolumeDown`, `AudioVolumeDown`, `MediaPlayPause`, `Enter`, or `L`.
- `Z` undoes a change; `M` resets the current game/tiebreak.

Clicker keys (including F13/F14 in Windows helper mode) wait **350 ms** before
adding a point. A second press of the **same team's clicker** within that window
cancels the pending addition and removes that team's last recorded point instead.
The opponent's later points remain and the scoring engine rebuilds games, sets,
serve rotation, statistics and point history. The two clickers have independent
double-click windows. Duplicate signals less than 60 ms apart and held-key repeats
are ignored. The helper must be restarted after this update: older versions
discarded the second press within 400 ms.
Point-removal announcements for both teams in Slovak and English are explicitly
allowed by the speech endpoint and use the same configured scoring voice and
delivery settings as point additions (not the separate match-winner voice).
Slovak synthesis uses `eleven_flash_v2_5` with explicit `language_code: "sk"`
for all announcements, including point removals and winners. English retains
`eleven_multilingual_v2`. Audio and in-flight requests are cached separately
by language and voice. Multilingual v2 does not support forcing a language.
The configured voice IDs and delivery settings are unchanged; a native Slovak
source voice may still be necessary to eliminate an accent. Language selection
alone cannot guarantee native pronunciation.

`A`/`L` still add points immediately with their shared 400 ms guard. `Z`/`M`
retain undo/reset behavior and cancel pending clicks. Accepted clicker actions
wait in order for an in-flight save; changing mode, losing focus/visibility,
interacting with page controls, pausing or unmounting cancels pending actions.
Accepted points highlight the team's score card for 300 ms and
start the existing voice announcement pipeline (subject to mute, configured
voice service latency and browser audio permissions). Scoring still requires
edit permission, an activated match and the initial serve selection; it is
disabled during pause/end confirmation, pauses and after completion.
Input fields, editable content and dialogs are excluded. Enter/Space retain
native behavior on focused buttons and links; media keys still work when a
score button has focus. Hidden pages do not score.

The listener logs `Stlačený kláves:` with key and code for device diagnostics.
Recognized enabled shortcuts call `preventDefault()`, including repeats and
presses rejected by the guard. This blocks page scrolling/default browser
actions, but cannot prevent OS volume changes or capture keys intercepted by
the OS. The match page must be foreground and focused. No Web Bluetooth pairing
is needed for HID clickers; pair them in the operating system. Devices sending
the same key cannot be distinguished by this listener.

New point-history entries include the serving team/player and original point
timestamp, so team-specific corrections survive reloads for matches with complete
history recorded by this version. Existing in-memory pre-point snapshots can
also supply a correction baseline for older matches. If legacy history lacks the
necessary baseline/timestamps or disagrees with the current score, correction
shows an error without changing the match; it never guesses or silently subtracts
the opponent's point. A team with no recorded points also gets an explicit error.
Completed/paused matches remain locked. These additional JSON fields need no SQL
migration beyond the existing point-history migration 059.

### Windows: checking whether two identical clickers can be distinguished

For a tablet without Windows, use the separate offline
[Android APK diagnostic](android-clicker-test.md). It tests native input-device
identity without changing the production website or any match.

Run the read-only [Raw Input diagnostic](../scripts/test-bluetooth-clickers.ps1)
from a PowerShell terminal at the repository root:

```powershell
powershell.exe -NoProfile -STA -File .\scripts\test-bluetooth-clickers.ps1
```

If Windows blocks this local script due to execution policy, use a process-only
override (no persistent policy change; do not bypass a managed organization's
restrictions):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File .\scripts\test-bluetooth-clickers.ps1
```

Pair both clickers in Windows, then press only the first three times and only
the second three times. Compare the nonzero `Device` IDs and `Path` lines.
Each press can generate several reports, including release reports; compare
the set of sources for each physical clicker, not just two adjacent log rows.
Different sources prove that a native helper could distinguish them in this
session, not that browser keydown events can. Handles may change on reconnection.
If needed, switch one clicker off at a time to establish which reports belong to
which device. Identical/zero sources or no events are inconclusive, not proof
that the hardware can never be distinguished.

The window monitors Consumer Control HID reports and only volume/play keyboard
events. It installs no drivers, needs no administrator privileges, makes no
network requests, saves no files, and neither remaps nor suppresses input.
Close the match page while testing so clickers do not inadvertently add points.
Volume changes during the test are expected. Close the diagnostic window to
stop listening. Device paths can contain identifying information; do not publish
the full log. This tests Windows only, not compatibility with Android.

Compile validation without opening a listener:

```powershell
powershell.exe -NoProfile -File .\scripts\test-bluetooth-clickers.ps1 -CheckOnly
```

### Windows helper: two model 497764 shutters controlling one match

The [Windows helper launcher](../scripts/start-bluetooth-clickers.ps1) reuses the
Raw Input monitor and recognizes the exact three-byte HID reports observed with
these shutters: `02-01-00` press and `02-00-00` release. It does not guess the
meaning of arbitrary HID reports. It assigns different device paths to each
team, rejects assigning one path to both teams, ignores unknown sources and
held/repeated presses, and forwards each released press, including double-clicks.
The web page distinguishes single/double-clicks. Calibration never
sends a point. Device assignments exist only in memory: reassign after restarting
or reconnecting devices. Only one helper instance is allowed per Windows session.

Start from a PowerShell terminal in the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File .\scripts\start-bluetooth-clickers.ps1
```

1. Pair both shutters in Windows and close the old read-only diagnostic.
2. Open a **practice match** in Chrome/Edge, draw the serve, and enable
   **Windows pomocník pre dva rovnaké klikre** near the bottom of the match screen.
   This mode is not remembered after reload; always re-enable it before testing.
3. In the helper, click **1. Assign Team 1**, press and release only the first
   shutter. Repeat **2. Assign Team 2** with the other shutter.
4. Click **3. Vybrat okno zapasu**, select the browser window displaying the
   match, and click **Pouzit vybrane okno**. There is no countdown or RIVA-title
   requirement. The picker lists visible Chrome, Edge and Firefox windows,
   not VS Code. Click **Obnovit** if the browser was just opened. Use a dedicated
   browser window with only the match tab. Cancel leaves sending disabled.
5. Return to the helper, check **4. ENABLE sending**, then switch back to the
   match and click its heading. Leave the page foreground; minimize only the helper.
6. Test each shutter separately with more than 350 ms between presses and wait
   for each save. Verify exactly one point for the expected team; a release must
   not add a point. Check that the other screen receives the saved score via the
   existing Supabase Realtime connection.
   Then double-click one shutter (60–349 ms between presses): its team's last
   point must be removed, without first adding a temporary point. The other
   team's points must remain, even if it scored more recently.
   The page displays **Vstup Windows pomocníka / Windows helper input**, including
   the last key, a received-event counter and the reason it was accepted/ignored.
   Only volume events means the original shutter reached the page, but the
   helper's F13/F14 did not (check the console history too, since a later volume
   event can replace the latest diagnostic). A focus warning means click the match
   heading, not a text input or DevTools. F13/F14 work when the helper-mode checkbox
   itself retains focus; other inputs and all dialogs remain excluded.
   Accepted means passed to scoring, not saved.
7. Switch to another application: presses must log `SKIPPED` and must not score.
   Uncheck ENABLE or close the helper to stop.

If ENABLE immediately unchecks itself, the helper lists each missing prerequisite
in its status and log (Team 1, Team 2, pending assignment or target window).
Successfully assigned team buttons show `OK`; the target button shows
`Window selected` after successful capture. These settings must be completed
again after restarting the helper.
Each ignored HID press now has an explicit diagnostic: `SENDING OFF` means
enable sending; `UNASSIGNED DEVICE` means reassign both shutters after a device
identity change; `HELD` means Windows has not reported release; and
`UNSUPPORTED REPORT` means the report is not the supported shutter format.
Release reports alone are normal and do not produce an error.

The helper sends **F13 for Team 1 / F14 for Team 2** only while the selected
top-level window and its captured title are foreground. It never activates a
window. F13/F14 are recognized by the web only in helper mode; original
VolumeUp/VolumeDown/PlayPause/Enter/Space point inputs are ignored in that mode,
so a physical press cannot also score via the old VolumeUp mapping. A/L/Z/M
remain available. Do not enable sending until helper mode is enabled on the page.
Inputs in editors and dialogs remain excluded; click the match heading after
using setup controls. If a browser or VS Code intercepts F13/F14, use a separate
Chrome/Edge window and inspect the page's key log.
The helper now uses Win32 `SendInput` with checked key-down/key-up insertion,
not WinForms `SendKeys`. A successful `INJECTED` message means Windows accepted
both events, not that the intended page received them. Incomplete insertion
stops the helper and displays an error. Restart the helper after script updates.
The live page must have an `id` query parameter and show the scoreboard: the
`/match?mode=kiosk` start screen has no match key listener. Kiosk inactivity may
return to that screen while configuring; reopen a practice match if necessary,
enable helper mode again and recapture the target window.

This is foreground-window input forwarding, **not authenticated match pairing**.
The helper cannot inspect the browser URL, focused tab, match ID or save result.
It checks the window handle/title but cannot distinguish two pages with the same
title inside that window; keep only the intended match tab open. A `SENT` log
means input was forwarded, not that Supabase accepted a point. Existing scoring
permissions, loading/save guards, initial serve, pause/end and mute behavior apply.
Do not run the browser elevated when the helper is not elevated.

The helper does not block Windows volume changes and uses no driver, network,
Supabase credentials, persistent device identifiers or server connection. It
does not provide direct Android/iOS support or background/minimized-browser
scoring. Other devices can display the match via existing Realtime, but this
Windows host must remain active, connected and in Bluetooth range.

Validate calibration/report parsing and construct the helper UI without starting
input capture or sending keys:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File .\scripts\start-bluetooth-clickers.ps1 -SelfTest
node --test scripts\match-clicker.test.mjs
```

Actual device input, key delivery to the intended browser and successful saving
require the practice-match test above; automated checks cannot establish radio
range or physical device behavior.

## Match rules and statistics

Apply [055_live_match_scoring_rules.sql](../scripts/055_live_match_scoring_rules.sql)
after 052 and 053 before using the new match-start screens. Quick games prompt
before insertion, PIN games before activation, and QR games after the fourth
player is scanned. Cancelling does not create/activate a match. The selected
`scoring_type` is persisted atomically with creation/activation; Realtime and
reloads retain `advantage_team`. Existing matches keep `golden_point`.
In `advantage` mode, 40:40 goes to AD, an opposing point returns to deuce,
and a second consecutive point wins the game. Golden Point ends the game
on the next point at 40:40. Undo restores advantage; reset clears it.
Quick-game settings also offer four optional nicknames, grouped into two teams.
Names are trimmed and saved in the existing live-match name columns; blank inputs
keep the default player names. Nicknames appear in scores, statistics and rematches.
Cancelling setup or resetting the kiosk clears the entered nicknames.
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

Apply [059_live_match_point_history.sql](../scripts/059_live_match_point_history.sql)
after 058 to store each point's winning team, score, set/game position and
game/set result. Finished live-match statistics include the ordered point log.
The post-match statistics show a collapsible point-by-point timeline, filterable
by the selected set. Undo restores the prior timeline; resetting a game or
tiebreak adds a reset marker. Matches already in progress when migration 059
runs are marked incomplete, and older points are never inferred from totals.
Matches created after the migration record their full point history.

Finished-match statistics remain visible until a player clicks a return button,
including in kiosk mode. There is no post-match countdown or inactivity reset.
The end-match button clears the QR device token and preserves kiosk mode on return.
The next-match action creates a separate game with the same four players, arena
and rules, zero scores/statistics and a new serve draw; it does not modify the
finished match. Before creating it, the organizer can choose any of the three
possible pairings of the four players. Both actions are disabled while the final
result is saving or the next game is being created. Inactivity resets during
unfinished matches and match setup are unchanged.

## Immediate result notifications and next match

Apply [063_match_completion_and_rematch.sql](../scripts/063_match_completion_and_rematch.sql)
after 062. It expects the current league notifications schema (numeric
`user_id`, `type`, `message`, `is_read`, as used by challenge alerts).
Result reminders are system notifications without a sender, supporting nullable
`sender_id` columns of either UUID or numeric type without converting stored IDs.
It adds a private rematch relation and the server RPC `create_live_match_rematch`.
Approval membership comparisons support both `bigint[]` and legacy `text[]`
without changing stored approval IDs or their column type.
Do not replay earlier scoring migrations afterward; they replace the completion
trigger with earlier behavior.

Apply [065_rematch_team_selection.sql](../scripts/065_rematch_team_selection.sql)
after 063 to enable the three possible team pairings before starting a rematch.
The migration replaces the three-argument rematch RPC with a slot-validated
four-argument version; each completed match can still have only one successor,
and retries must use the same player arrangement.

On the winning point, registered QR and activated challenge/PIN games immediately
create a pending official result and one `match_result` notification for each of
the four participants, including the submitting player. Notifications and the
winning point commit in the same transaction: a notification failure rolls back
the final point and displays the save error for retry. Notifications do not wait
for "Hrať ďalší zápas" or "Ukončiť zápas", nor for all four approvals. Approval
still uses the existing results workflow; ELO changes only after all four agree.
Quick games and manually terminated unfinished games have no approval alerts.
The migration also reminds unapproved players of existing pending results.
Re-running it or updating the pending result does not duplicate reminders.

Profile notification counts subscribe to notification inserts in Realtime. The
new "Potvrď výsledok" alert opens the results tab where the player can confirm
or reject. Phone/lock-screen delivery uses the existing notifications INSERT
webhook and FCM setup documented in [web-push.md](./web-push.md); in-app
notifications alone do not guarantee a system push on an unconfigured device.

The final statistics screen offers "Hrať ďalší zápas" and "Ukončiť zápas", with
no automatic navigation. A rematch requires the previous registered result and
all four persisted notifications, but not their approval or FCM delivery.
Legacy results also accept existing approvals in place of a redundant reminder.
It is
authorized using the existing match device/organizer permissions. It creates only
one successor per finished match; the session keeps its UUID and device token so
retries after a lost response return the same successor instead of duplicating
games. A PIN challenge rematch is a new device-controlled registered game with
the same participants, not a reuse of the challenge's unique activation PIN.
Every newly completed rematch sends its own four approval notifications.

Team selection requires
[065_rematch_team_selection.sql](../scripts/065_rematch_team_selection.sql)
after migration 063. If "Hrať ďalší zápas" reports `PGRST202`, run the entire
065 script in the Supabase SQL Editor; migration 063 alone provides only the
older three-argument RPC. Migration 065 also refreshes the PostgREST schema
cache. Retry the button afterward. Rematch failures are displayed beside the
buttons below the statistics, not just at the top of the results screen.

## Pausing and resuming a match

If QR creation returns `PGRST202` for `create_qr_device_match_with_settings`,
run the entire [061_repair_qr_match_setup.sql](../scripts/061_repair_qr_match_setup.sql)
in the SQL Editor instead of merely reloading the PostgREST schema. This
consolidated repair installs current rule-setting RPCs, tiebreak formats, point
history and pause/resume support in one transaction. It requires the base QR
schema through 052 and statistics migrations 053/054, checks the base QR creation
function, and can run with or without 055-060 already installed. It deliberately
uses the latest format constraints instead of replaying the obsolete 056/057
constraints, which reject existing super tiebreaks or seven-game matches.
The final query lists the creation, pause and resume RPCs. No matches are deleted.

Apply [060_live_match_pause.sql](../scripts/060_live_match_pause.sql) after 059.
The top-right "Prerušiť zápas" button confirms the pause and locks scoring in the
database, including other tabs and Bluetooth input. It preserves the same match
row: points, set/game state, advantage, tiebreak, server, rules and all statistics.
The pause screen has no inactivity reset. A unique four-digit resume PIN
is displayed; old points are not reconstructed. `status` is generated from the
saved lifecycle timestamps (`in_progress`, `paused`, `finished`); `resume_pin`
mirrors the active PIN and is not granted to public scoreboard queries. Only the
pause/resume RPCs modify pause metadata. Nothing is submitted to ELO until
the match is completed and approved as before.

Apply [062_persistent_match_pin.sql](../scripts/062_persistent_match_pin.sql)
after 060 or the consolidated 061 repair. Do not replay 060/061 after 062, since
they restore the earlier single-use behavior. A previously consumed PIN cannot
be recovered; pause that match once more to allocate its persistent PIN.

On `/kiosk`, choose "Pokračovať v zápase" instead of "Nová výzva". Resuming
issues a random device capability and retains the rules without showing match
setup again. The same PIN remains reserved for the match after resuming, including
when reopening an already active match or pausing again. There is no expiry timer.
A new resume device replaces the previous resume capability. The most recently
resumed device can still manage a subsequently paused match.
Quick games only show
the PIN because no registered participants are attached. Active-match elapsed time
excludes pauses. Undo history in memory is cleared on pause; the recorded point
timeline and all persisted state are retained.

The adjacent "Ukončiť zápas" button asks for irreversible confirmation. It saves
the existing score and timeline, marks `ended_early_at` and `finished_at`, stops
the clock, and closes the match without a winner, official result or ELO change.
The saved statistics remain visible until manual return, with no inactivity reset.
The same action is available on the paused screen. Database guards reject further
score/statistic changes even from stale tabs. Both manual termination and normal
scoring completion release the PIN; all future resume attempts, including retries
with a previously valid device token, reject it. Normal completed-match approval
and ELO behavior is unchanged. Repeated pauses reuse the email outbox, so already
submitted PIN messages are not resent unnecessarily.

### Server configuration for resume and email

Use [.env.match-email.example](../.env.match-email.example) as the template.
Set `SUPABASE_SERVICE_ROLE_KEY` on the Next.js server for PIN resumption and mail
queue access. Also set `RESEND_API_KEY` and `MATCH_EMAIL_FROM` (a sender on a domain
verified in Resend) for email delivery. Restart the development server after
changing environment values; configure the same secrets in production. Never use
a `NEXT_PUBLIC_` prefix for these keys or put them in SQL/client code.

Pause creates a durable private email outbox for the registered participants'
`proffiles.email` addresses, including challenge participants. The browser never
receives recipients' email addresses. The server submits one private message per
address to Resend. Already submitted jobs are skipped on retry; each job uses a
stable provider idempotency key. A missing configuration/provider failure is shown
explicitly with a retry button; it never discards the saved match or its PIN.
There is no background mail worker: keep the pause screen open until submission
finishes, or reopen the paused match and use "Zobraziť PIN a odoslať e-maily".
Provider acceptance is not an inbox delivery guarantee; monitor bounces in Resend.
The `/api/pause-match` endpoint uses the `resend` SDK, and accepts `matchId`,
`pinCode`, and optional `playersEmails`, plus the private pause receipt
(`pauseId`, `dispatchToken`). It verifies the receipt, match and PIN in the
database and derives recipients from the outbox, not an untrusted client list.
Provided addresses must belong to the stored recipients. After successful
submission a confirmation shows the PIN; acknowledging it returns to `/match`
(preserving kiosk mode). On failure the pause/PIN screen remains open for retry.
Quick games deliberately remain on the PIN screen until manual return so players
can save their PIN without an email. PINs are generated and reserved atomically
in PostgreSQL rather than with `Math.random()` in the browser.

Resume attempts are limited in PostgreSQL to five per ten minutes per server-
hashed client IP. Deploy behind a trusted proxy that overwrites `X-Forwarded-For`
and does not permit direct untrusted access to the Next.js origin. A four-digit
PIN is a short bearer credential; share it only with the four participants.
PINs for new challenges and paused matches have separate namespaces, selected by
the kiosk tabs. The SQL file is rerunnable and does not remove existing matches.

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

QR league registration requests the front-facing camera on Android and iOS,
including kiosk mode and scanner retries. Camera access requires HTTPS and user
permission. If no front camera is available, the scanner library falls back to
an available camera. Verify on physical Android and iOS devices.

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
