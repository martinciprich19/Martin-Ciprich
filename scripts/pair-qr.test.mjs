import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

test('anonymous kiosk resolves only existing pairs with minimal player details', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create table public.proffiles (id bigint primary key, full_name text, email text);
      create table public.pairs (id uuid primary key, player_1_id bigint, player_2_id bigint);
      insert into public.proffiles values (1, 'Anna', 'private@example.test'), (2, 'Peter', 'private2@example.test');
      insert into public.pairs values ('123e4567-e89b-12d3-a456-426614174000', 1, 2);
    `)
    const migration = await readFile(new URL('./108_pair_qr.sql', import.meta.url), 'utf8')
    await db.exec(migration)
    await db.exec(migration)
    await db.exec('set role anon')
    const id = '123e4567-e89b-12d3-a456-426614174000'
    assert.deepEqual((await db.query('select public.get_qr_pair_players($1) as players', [id])).rows[0].players, [{ id: '1', name: 'Anna' }, { id: '2', name: 'Peter' }])
    await assert.rejects(db.query('select * from public.pairs'), /permission denied/)
    assert.equal((await db.query('select public.get_qr_pair_players($1) as players', ['missing'])).rows[0].players, null)
    await db.exec('reset role; delete from public.pairs; set role anon')
    assert.equal((await db.query('select public.get_qr_pair_players($1) as players', [id])).rows[0].players, null)
  } finally {
    await db.close()
  }
})

test('both pair screens expose a shared QR and the scanner resolves and undoes both slots', async () => {
  const [pairs, challenges, scanner, button] = await Promise.all([
    '../components/pairs-view.tsx', '../components/pair-challenge-view.tsx',
    '../components/riva-qr-scanner.tsx', '../components/pair-qr-button.tsx',
  ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')))
  assert.match(pairs, /isOwnPair[\s\S]*<PairQrButton/)
  assert.match(challenges, /showMyPairs[\s\S]*<PairQrButton/)
  assert.match(button, /riva:pair:\$\{pairId\}/)
  assert.match(scanner, /get_qr_pair_players/)
  assert.match(scanner, /assignQrPair\(playersRef\.current, pair\)/)
  assert.match(scanner, /for \(const index of indices\) next\[index\] = null/)
})
