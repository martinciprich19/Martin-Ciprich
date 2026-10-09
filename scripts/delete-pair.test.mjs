import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('./040_delete_my_pair.sql', import.meta.url), 'utf8')
const userId = '11111111-1111-4111-8111-111111111111'

async function database() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql as
      $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql as
      $$ select jsonb_build_object('email', current_setting('test.email', true)) $$;
    create table proffiles (id bigint primary key, email text);
    create table pairs (
      id uuid primary key,
      player_1_id bigint references proffiles(id),
      player_2_id bigint references proffiles(id)
    );
    create table player_requests (id bigint primary key, challenger_1_id bigint, challenger_2_id bigint);
    create table matches (id bigint primary key, player1_id bigint, player1_partner_id bigint);
    insert into proffiles values
      (10, 'Member@test.invalid'), (20, 'partner@test.invalid'), (30, 'other@test.invalid');
    insert into pairs values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 10, 20),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 20, 30);
    insert into player_requests values (1, 10, 20);
    insert into matches values (1, 10, 20);
    grant delete on pairs to anon, authenticated;
  `)
  await db.exec(migration)
  await db.exec(migration)
  return db
}

for (const email of ['member@test.invalid', 'partner@test.invalid']) {
  test(`either member can permanently delete a pair (${email}) without deleting other data`, async () => {
    const db = await database()
    try {
      await db.exec(`set test.uid = '${userId}'; set test.email = '${email}'; set role authenticated`)
      await db.query('select delete_my_pair($1)', ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'])
      await db.exec('reset role')
      assert.deepEqual((await db.query('select id::text from pairs')).rows, [
        { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      ])
      assert.equal((await db.query('select count(*)::int as count from player_requests')).rows[0].count, 1)
      assert.equal((await db.query('select count(*)::int as count from matches')).rows[0].count, 1)
      await assert.rejects(db.query('select delete_my_pair($1)', ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']), /nie si jej členom/)
    } finally {
      await db.close()
    }
  })
}

test('anonymous, non-member, missing-profile and invalid requests cannot delete pairs', async () => {
  const db = await database()
  try {
    await assert.rejects(db.query('select delete_my_pair($1)', ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']), /Prihlásenie/)
    await db.exec(`set test.uid = '${userId}'; set test.email = 'other@test.invalid'`)
    await assert.rejects(db.query('select delete_my_pair($1)', ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']), /nie si jej členom/)
    await db.exec("set test.email = 'missing@test.invalid'")
    await assert.rejects(db.query('select delete_my_pair($1)', ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']), /Profil/)
    await db.exec("set test.email = 'member@test.invalid'")
    for (const id of [null, '', 'invalid', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']) {
      await assert.rejects(db.query('select delete_my_pair($1)', [id]), /nie si jej členom/)
    }
    assert.equal((await db.query('select count(*)::int as count from pairs')).rows[0].count, 2)
    await db.exec('set role authenticated')
    await assert.rejects(db.query('delete from pairs'), /permission denied/)
    await db.exec('reset role; set role anon')
    await assert.rejects(db.query('select delete_my_pair($1)', ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']), /permission denied/)
  } finally {
    await db.close()
  }
})

test('deletion also supports numeric pair identifiers without numeric coercion in the client', async () => {
  const db = await database()
  try {
    await db.exec(`
      drop table pairs;
      create table pairs (id bigint primary key, player_1_id bigint, player_2_id bigint);
      insert into pairs values (9007199254740993, 10, 20);
      set test.uid = '${userId}'; set test.email = 'member@test.invalid';
    `)
    await db.query('select delete_my_pair($1)', ['9007199254740993'])
    assert.equal((await db.query('select count(*)::int as count from pairs')).rows[0].count, 0)
  } finally {
    await db.close()
  }
})
