import assert from 'node:assert/strict'
import test from 'node:test'
import { getPairEloBand } from '../lib/pair-elo.ts'

test('pair ELO bands include their boundaries', () => {
  assert.equal(getPairEloBand(899), 'under-900')
  assert.equal(getPairEloBand(900), '900-1099')
  assert.equal(getPairEloBand(1099), '900-1099')
  assert.equal(getPairEloBand(1100), '1100-1299')
  assert.equal(getPairEloBand(1299), '1100-1299')
  assert.equal(getPairEloBand(1300), '1300-plus')
})
