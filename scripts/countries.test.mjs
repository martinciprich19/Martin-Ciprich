import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

const source = stripTypeScriptTypes(readFileSync(new URL('../lib/countries.ts', import.meta.url), 'utf8'))
const countries = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

test('national subdivisions have unique canonical codes and all twelve Dutch provinces', () => {
  assert.equal(countries.SUBDIVISIONS.SK.length, 8)
  assert.equal(countries.SUBDIVISIONS.NL.length, 12)
  for (const country of ['SK', 'NL']) {
    const subdivisions = countries.SUBDIVISIONS[country]
    assert.equal(new Set(subdivisions.map(({ code }) => code)).size, subdivisions.length)
    for (const { code, name } of subdivisions) {
      assert.equal(countries.subdivisionCode(country, name), code)
    }
  }
  assert.equal(countries.subdivisionCode('NL', 'Bratislavský kraj'), null)
  assert.equal(countries.subdivisionCode('SK', 'Noord-Holland'), null)
})

test('Dutch browser defaults and registration language are distinct from league browsing', () => {
  assert.equal(countries.browserCountry(['nl-NL', 'en']), 'NL')
  assert.equal(countries.browserCountry(['sk-SK']), 'SK')
  assert.equal(countries.COUNTRY_DEFAULT_LANGUAGE.NL, 'nl')
  assert.equal(countries.COUNTRY_DEFAULT_LANGUAGE.SK, 'sk')
  assert.equal(countries.isAppLanguage('nl'), true)
  assert.equal(countries.isAppLanguage('de'), false)
  assert.equal(countries.isCountryCode('BE'), false)
})
