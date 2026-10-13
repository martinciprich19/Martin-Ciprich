# Match announcements

Match announcements use the Slovak ElevenLabs voice (`2bNrEsM0omyhLiEyOwqY`)
or English voice (`wAGzRVkxKEs8La0lmdrE`) through
`POST /api/match-speech`, with `eleven_multilingual_v2`, stability `0.95`,
similarity boost `0.75`, speed `0.80` and style exaggeration `0` for slower,
more even announcements with less expressive variation.
Slovak/English selection controls both spoken text and the server-selected voice.
Requests without a language retain the Slovak voice for older clients. Unsupported
language values are rejected. The audio cache is separated by voice and text.
The browser receives MP3 audio, not the provider API key.
Text is trimmed before allowlist validation, cache lookup and synthesis;
unrecognized invisible characters are rejected rather than sent to ElevenLabs.
All accepted announcements end with a period. Slovak points use
"Bod pre tím jedna." and "Bod pre tím dva." (including game-winning variants)
to encourage declarative intonation. Other Slovak team-wording variants are
rejected; reload clients already open during an update.
The final point replaces the point/game announcement with the winning team and
both player names, for example "Zápas vyhral tím jedna. Víťazná dvojica: Martin
a Peter.". The scoring device waits for a successful save; spectators announce
the transition to a finished match through Realtime. Loading an already finished
match does not replay it. Mute and language selection still apply.
Winner announcements use the dedicated ElevenLabs voice `z2Zs6alQTcDzcMWLuK0e`
in both languages, without a synthesized fanfare. Ordinary Slovak and English
announcer voices are unchanged. It does not run at the end of an ordinary set or while loading a saved result.
Both the scoring device's successful save and a spectator's unfinished-to-finished
Realtime transition use the same once-per-mounted-match celebration guard.
SpeechSynthesis remains the device fallback; Slovak/English text and names are
preserved. Mute, navigation and language changes cancel speech.
No external sound file, dependency or SQL migration is required.
The server verifies winner text against the finished match and its roster in
Supabase rather than allowing arbitrary name-bearing synthesis.
Standalone Slovak scores `0`, `15`, `30`, `40` are normalized to "Nula.",
"Pätnásť.", "Tridsať.", "Štyridsať."; "Zhoda." and "Výhoda." are also accepted.
These standalone inputs accept an omitted final period and gain one before
synthesis. Other phrases must already end with a period. Standalone game
announcements use "Gem pre tím jedna." or "Gem pre tím dva.".
This does not add standalone playback to the scoreboard or change its scoring
rules (no 45-point score). With migration 055, advantage-mode point announcements
also identify advantage or a return to deuce; undo can announce the restored
advantage. Golden Point and ordinary point phrases remain unchanged. Punctuation and stability
encourage consistent delivery but cannot guarantee falling intonation.
With migration 056, a tiebreak-winning point announces the tiebreak and set,
unless it finishes the match (the existing winning-pair announcement takes
priority). Tiebreak reset and undo have distinct localized phrases.

Configure `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` (Slovak) and optionally
`ELEVENLABS_VOICE_ID_EN` (English, defaults to `wAGzRVkxKEs8La0lmdrE`) in `.env.local` and in
the production server environment. Optionally override the winner voice with
`ELEVENLABS_VOICE_ID_WINNER` (defaults to `z2Zs6alQTcDzcMWLuK0e`).
Restart the development server after changing
these values. Never prefix the secret key with `NEXT_PUBLIC_`; rotate any key
that has been shared in a chat or exposed in browser bundles. The voice must be
available to that ElevenLabs account and the key needs text-to-speech permission.

Mute sends no speech request, aborts pending browser requests, stops both audio
and browser speech, and releases blob URLs. A newer announcement, language
change or navigation cancels the previous playback so stale responses cannot
play. Aborting the browser request cannot undo provider usage already started
on the server. Repeated phrases are cached in server memory and simultaneous
requests for one phrase share synthesis.

The endpoint accepts only existing match-announcement phrases, checks same-origin
requests and uses Supabase RLS to check scoreboard visibility. It has a bounded
audio cache, at most four concurrent distinct syntheses and 60 new syntheses per
minute per server process. These limits/cache reset on server restart and are
not a distributed billing limit. Configure provider usage limits and production
rate limiting for an internet-facing deployment. No database migration is needed.

API, network, timeout, invalid-audio and playback failures explicitly switch to
the existing local-language browser voice and show fallback status. Missing
local voices or playback errors are reported; Slovak never falls back to English.
Non-success provider responses log `ElevenLabs API error:`, HTTP status and
response body in the server terminal. Catch logs include the error name/message.
Provider HTTP failures return HTTP 502 with JSON `error` containing the complete
original response text, `provider: "ElevenLabs"` and `providerStatus` containing
the upstream status (for example 403). The error body is not truncated or parsed;
only occurrences of the configured secret are redacted. These responses are
not cached. Network/internal failures still return the generic fallback error.
The configured API key is redacted from these diagnostics. Missing configuration
logs only whether the key is present and the voice ID is valid, not their values.
Each request logs a 12-character SHA256 key fingerprint, never a key prefix.
Same-origin validation uses the HTTP Host header with the request protocol,
so LAN binding to `0.0.0.0` does not reject a browser using `localhost`.
Browsers may require user interaction before playing audio, especially for
read-only spectators. Real delivery and voice availability require a live account.

Tests: `node --experimental-vm-modules --test scripts/match-audio.test.mjs
scripts/match-speech.test.mjs`.
