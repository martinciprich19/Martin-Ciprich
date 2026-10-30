import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(new URL('./070_classify_existing_arenas.sql', import.meta.url), 'utf8')

async function fixture() {
  const db = new PGlite()
  await db.exec(`
    create table league_subdivisions(country_code text, code text, name text, primary key(country_code, code));
    insert into league_subdivisions values ('NL','NL-FL','Flevoland'),('SK','SK-ZI','Žilinský kraj');
    create table arenas(
      id bigint primary key, name text, city text, country_code text, subdivision_code text, region text,
      foreign key(country_code, subdivision_code) references league_subdivisions(country_code, code)
    );
    insert into arenas values
      (1,'Flevopadel','Lelystad','SK',null,null),
      (2,'Zilinska arena','zilina','SK',null,null),
      (3,'Untouched arena','Other city','SK',null,null);
    create table proffiles(
      id bigint primary key, country_code text, home_venue_id bigint, auto_venue_id bigint, elo_rating integer
    );
    insert into proffiles values (1,'SK',1,2,1234),(2,'NL',1,1,1400),(3,'SK',3,null,1000);
    create table matches(id bigint primary key, country_code text, arena_id bigint);
    insert into matches values (1,'SK',1);
    create function guard_profile() returns trigger language plpgsql as $$
    begin
      if new.country_code is distinct from old.country_code then raise exception 'Membership changed'; end if;
      if exists(select 1 from arenas a where a.id in (new.home_venue_id,new.auto_venue_id)
        and a.country_code <> new.country_code) then raise exception 'Foreign home venue'; end if;
      return new;
    end $$;
    create trigger guard_profile before update on proffiles for each row execute function guard_profile();
  `)
  return db
}

test('explicit arena classification is repeatable and preserves membership, ELO and historical matches', async () => {
  const db = await fixture()
  try {
    await db.exec(migration)
    await db.exec(migration)
    assert.deepEqual((await db.query('select country_code, subdivision_code, region from arenas order by id')).rows, [
      { country_code: 'NL', subdivision_code: 'NL-FL', region: 'Flevoland' },
      { country_code: 'SK', subdivision_code: 'SK-ZI', region: 'Žilinský kraj' },
      { country_code: 'SK', subdivision_code: null, region: null },
    ])
    assert.deepEqual((await db.query('select * from proffiles order by id')).rows, [
      { id: 1, country_code: 'SK', home_venue_id: null, auto_venue_id: 2, elo_rating: 1234 },
      { id: 2, country_code: 'NL', home_venue_id: 1, auto_venue_id: 1, elo_rating: 1400 },
      { id: 3, country_code: 'SK', home_venue_id: 3, auto_venue_id: null, elo_rating: 1000 },
    ])
    assert.deepEqual((await db.query('select * from matches')).rows, [{ id: 1, country_code: 'SK', arena_id: 1 }])
  } finally { await db.close() }
})

test('missing or ambiguous assignments abort without changing any arena', async () => {
  const db = await fixture()
  try {
    await db.exec("update arenas set name='Renamed' where id=2")
    await assert.rejects(db.exec(migration), /Expected exactly one arena/)
    await db.exec('rollback')
    assert.equal((await db.query('select country_code from arenas where id=1')).rows[0].country_code, 'SK')
    await db.exec("update arenas set name='Zilinska arena' where id=2; insert into arenas values(4,'Flevopadel','Lelystad','SK',null,null)")
    await assert.rejects(db.exec(migration), /found 2/)
    await db.exec('rollback')
    assert.equal((await db.query('select country_code from arenas where id=1')).rows[0].country_code, 'SK')
  } finally { await db.close() }
})

test('SQL Editor statement-by-statement execution does not depend on temporary tables', async () => {
  const db = await fixture()
  try {
    const block = migration.match(/do \$\$[\s\S]*?\n\$\$;/)?.[0]
    assert.ok(block)
    await db.exec(block)
    await db.exec(block)
    const result = await db.query('select country_code from arenas where id=1')
    assert.equal(result.rows[0].country_code, 'NL')
    assert.doesNotMatch(migration, /create temporary table/i)
  } finally { await db.close() }
})
