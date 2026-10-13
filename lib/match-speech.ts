import type { Language } from '@/components/language-provider'

export function getMatchVoice(voices: SpeechSynthesisVoice[], language: Language): SpeechSynthesisVoice | undefined {
  const locale = language === 'sk' ? 'sk-SK' : 'en-GB'
  return voices.find((voice) => voice.lang.toLowerCase() === locale.toLowerCase())
    ?? voices.find((voice) => voice.lang.toLowerCase().split(/[-_]/)[0] === language)
}

export function speakMatchAnnouncement(
  synthesis: SpeechSynthesis,
  utterance: SpeechSynthesisUtterance,
  language: Language,
): boolean {
  const voice = getMatchVoice(synthesis.getVoices(), language)
  if (!voice) return false
  synthesis.cancel()
  utterance.voice = voice
  utterance.lang = voice.lang
  synthesis.speak(utterance)
  return true
}
