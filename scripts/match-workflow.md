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