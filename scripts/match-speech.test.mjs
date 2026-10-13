import assert from 'node:assert/strict'
import test from 'node:test'
import { getMatchVoice, speakMatchAnnouncement } from '../lib/match-speech.ts'

const slovak = { name: 'Slovak', lang: 'sk-SK' }
const british = { name: 'British English', lang: 'en-GB' }
const american = { name: 'American English', lang: 'en-US', default: true }

test('Slovak announcements never use the default English voice', () => {
  assert.equal(getMatchVoice([american, slovak], 'sk'), slovak)
  assert.equal(getMatchVoice([american, british], 'sk'), undefined)
  assert.equal(getMatchVoice([{ lang: 'cs-CZ' }], 'sk'), undefined)
})

test('English selection prefers British English and allows another English locale', () => {
  assert.equal(getMatchVoice([american, slovak, british], 'en'), british)
  assert.equal(getMatchVoice([slovak, american], 'en'), american)
  assert.equal(getMatchVoice([slovak], 'en'), undefined)
  const regional = { lang: 'SK_sk' }
  assert.equal(getMatchVoice([regional], 'sk'), regional)
})

test('Switching languages sets the exact voice and cancels previous announcements', () => {
  const spoken = []
  let cancellations = 0
  const synthesis = {
    getVoices: () => [american, slovak, british],
    cancel: () => { cancellations++ },
    speak: (utterance) => spoken.push(utterance),
  }
  const skUtterance = { text: 'Bod pre Tím 1. Skóre 15 ku 0.' }
  const enUtterance = { text: 'Point for Team 1. Score 15 to 0.' }
  assert.equal(speakMatchAnnouncement(synthesis, skUtterance, 'sk'), true)
  assert.equal(skUtterance.voice, slovak)
  assert.equal(skUtterance.lang, 'sk-SK')
  assert.equal(speakMatchAnnouncement(synthesis, enUtterance, 'en'), true)
  assert.equal(enUtterance.voice, british)
  assert.equal(enUtterance.lang, 'en-GB')
  assert.equal(cancellations, 2)
  assert.deepEqual(spoken, [skUtterance, enUtterance])
})

test('Missing or not-yet-loaded Slovak voice does not speak in English', () => {
  let voices = []
  const spoken = []
  const synthesis = {
    getVoices: () => voices,
    cancel: () => {},
    speak: (utterance) => spoken.push(utterance),
  }
  assert.equal(speakMatchAnnouncement(synthesis, {}, 'sk'), false)
  voices = [american]
  assert.equal(speakMatchAnnouncement(synthesis, {}, 'sk'), false)
  assert.equal(spoken.length, 0)
  voices = [american, slovak]
  assert.equal(speakMatchAnnouncement(synthesis, {}, 'sk'), true)
  assert.equal(spoken.length, 1)
})
