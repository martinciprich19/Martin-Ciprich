import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

test('serve rotation migration preserves legacy games and wires all creation paths and rematches', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create table public.live_matches (
        id uuid primary key, scoring_type text default 'golden_point',
        set_format text default 'standard', third_set_format text default 'full_set',
        started_at timestamptz, team_a_game_score integer default 0, team_b_game_score integer default 0,
        team_a_games integer default 0, team_b_games integer default 0,
        team_a_sets integer default 0, team_b_sets integer default 0
      );
      insert into public.live_matches(id) values ('00000000-0000-0000-0000-000000000001'),
        ('00000000-0000-0000-0000-000000000002');
      create function public.guard_live_scoring_rules() returns trigger language plpgsql as $$ begin return new; end $$;
      create trigger guard_rules before update on public.live_matches for each row execute function public.guard_live_scoring_rules();
      create function public.activate_live_match_pin_with_settings(text,text,text,text)
        returns uuid language sql as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
      create function public.activate_live_match_pin_for_court(text,text,text,text,bigint)
        returns uuid language sql as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
      create function public.create_qr_device_match_with_settings(uuid,bigint,bigint,bigint,bigint,text,text,text,text,text)
        returns uuid language sql as $$ select $1 $$;
      create function public.create_qr_court_match_with_settings(uuid,bigint,bigint,bigint,bigint,text,text,text,text,text,bigint)
        returns uuid language sql as $$ select $1 $$;
      create function public.create_live_match_rematch(uuid,uuid,text,smallint[])
        returns uuid language sql as $$ select $2 $$;
    `)
    const migration = await readFile(new URL('./104_live_match_serve_rotation.sql', import.meta.url), 'utf8')
    await db.exec(migration)
    await db.exec(migration)
    const id = '00000000-0000-0000-0000-000000000001'
    const next = '00000000-0000-0000-0000-000000000002'
    assert.equal((await db.query('select serve_rotation from live_matches where id=$1', [id])).rows[0].serve_rotation, 'per_point')
    const calls = [
      "select public.activate_live_match_pin_with_settings('1234','golden_point','standard','full_set','per_game')",
      "select public.activate_live_match_pin_for_court('1234','golden_point','standard','full_set',1,'per_game')",
      `select public.create_qr_device_match_with_settings('${id}',1,2,3,4,'arena','token','golden_point','standard','full_set','per_game')`,
      `select public.create_qr_court_match_with_settings('${id}',1,2,3,4,'arena','token','golden_point','standard','full_set',1,'per_game')`,
    ]
    for (const call of calls) {
      await db.exec("update live_matches set serve_rotation='per_point' where id='00000000-0000-0000-0000-000000000001'")
      await db.exec(call)
      assert.equal((await db.query('select serve_rotation from live_matches where id=$1', [id])).rows[0].serve_rotation, 'per_game')
    }
    await assert.rejects(db.exec("select public.activate_live_match_pin_with_settings('1234','golden_point','standard','full_set','invalid')"), /Neplatne/)
    await db.query('select public.create_live_match_rematch($1,$2,$3,$4::smallint[])', [id, next, 'token', [0, 1, 2, 3]])
    assert.equal((await db.query('select serve_rotation from live_matches where id=$1', [next])).rows[0].serve_rotation, 'per_game')
    await db.query('update live_matches set started_at=now() where id=$1', [id])
    await assert.rejects(db.query("update live_matches set serve_rotation='per_point' where id=$1", [id]), /Pravidla/)
    assert.equal((await db.query('select public.live_statistics_snapshot(live_matches) as snapshot from live_matches where id=$1', [id])).rows[0].snapshot.serve_rotation, 'per_game')
    await db.exec('set role anon')
    await assert.rejects(db.query("select public.set_live_serve_rotation($1,'per_point')", [id]), /permission denied/)
  } finally { await db.close() }
})
