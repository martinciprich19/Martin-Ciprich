import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('./039_repair_uuid_pair_invitations.sql', import.meta.url), 'utf8')
const senderId = '11111111-1111-4111-8111-111111111111'
const receiverId = '22222222-2222-4222-8222-222222222222'
const invitationId = '33333333-3333-4333-8333-333333333333'

async function database() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql as
      $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql as
      $$ select jsonb_build_object('email', current_setting('test.email', true)) $$;
    create table public.proffiles (id bigint primary key, email text);
    create table public.friendships (user_id bigint, friend_id bigint, status text);
    create table public.pairs (
      id bigint generated always as identity primary key,
      player_1_id bigint not null references proffiles(id),
      player_2_id bigint not null references proffiles(id),
      created_by bigint not null references proffiles(id)
    );
    insert into auth.users values ('${senderId}', 'sender@test.invalid'), ('${receiverId}', 'receiver@test.invalid');
    insert into proffiles values (10, 'Sender@test.invalid'), (20, 'receiver@test.invalid');
    insert into friendships values (10, 20, 'accepted');
    create table public.pair_invitations (
      id uuid primary key, sender_id uuid not null references auth.users(id),
      receiver_id uuid not null references auth.users(id),
      status text not null, created_at timestamptz, updated_at timestamptz
    );
    insert into pair_invitations values (
      '${invitationId}', '${senderId}', '${receiverId}', 'pending', '2026-10-08', null
    );
    create function public.create_pair_invitation(p_invitee_id bigint)
    returns uuid language sql as $$ select '${invitationId}'::uuid $$;
  `)
  return db
}

test('UUID repair preserves invitations, is repeatable and requires recipient acceptance', async () => {
  const db = await database()
  try {
    await db.exec(migration)
    await db.exec(migration)
    const rows = (await db.query('select * from pair_invitations')).rows
    assert.equal(rows.length, 1)
    assert.equal(rows[0].inviter_id, 10)
    assert.equal(rows[0].invitee_id, 20)
    assert.equal(rows[0].status, 'pending')
    assert.equal(rows[0].legacy_invitation_id, invitationId)
    assert.equal((await db.query('select count(*)::int as count from pair_invitations_uuid_backup')).rows[0].count, 1)
    assert.equal((await db.query('select count(*)::int as count from pairs')).rows[0].count, 0)
    await db.exec(`set test.uid = '${senderId}'; set test.email = 'sender@test.invalid'`)
    await assert.rejects(db.query('select respond_to_pair_invitation($1, true)', [rows[0].id]), /Čakajúce pozvanie/)
    await db.exec(`set test.uid = '${receiverId}'; set test.email = 'receiver@test.invalid'`)
    await db.query('select respond_to_pair_invitation($1, true)', [rows[0].id])
    assert.deepEqual((await db.query('select player_1_id, player_2_id, created_by from pairs')).rows, [
      { player_1_id: 10, player_2_id: 20, created_by: 20 },
    ])
    assert.equal((await db.query('select status from pair_invitations')).rows[0].status, 'accepted')
    await assert.rejects(db.query('select respond_to_pair_invitation($1, true)', [rows[0].id]), /Čakajúce pozvanie/)
  } finally {
    await db.close()
  }
})

test('repair aborts without losing original data if an account has no profile', async () => {
  const db = await database()
  try {
    await db.exec('delete from proffiles where id = 20')
    await assert.rejects(db.exec(migration), /jednoznačný profil/)
    await db.exec('rollback')
    assert.equal((await db.query("select data_type from information_schema.columns where table_name = 'pair_invitations' and column_name = 'id'")).rows[0].data_type, 'uuid')
    assert.equal((await db.query('select count(*)::int as count from pair_invitations')).rows[0].count, 1)
    assert.equal((await db.query("select to_regclass('public.pair_invitations_uuid_backup') as backup")).rows[0].backup, null)
  } finally {
    await db.close()
  }
})
