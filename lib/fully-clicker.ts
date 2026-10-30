export const FULLY_CLICKER_EVENT = 'riva-fully-clicker'
export const FULLY_CLICKER_STORAGE = 'riva-fully-clicker-code'

export function getFullyClickerActions(code: string): [string, string] {
  if (!/^[a-f0-9]{32}$/.test(code)) throw new Error('Zadaj platný 32-znakový kód z RIVA Fully Clicker.')
  return [`sk.rivapadel.clicker.${code}.TEAM_A`, `sk.rivapadel.clicker.${code}.TEAM_B`]
}

type FullyBroadcastApi = {
  bind: (event: string, callback: string) => void
  registerBroadcastReceiver: (action: string) => void
  unregisterBroadcastReceiver: (action: string) => void
}

export function getFullyBroadcastApi(value: unknown): FullyBroadcastApi | null {
  if (!value || typeof value !== 'object') return null
  const api = value as Partial<FullyBroadcastApi>
  return typeof api.bind === 'function'
    && typeof api.registerBroadcastReceiver === 'function'
    && typeof api.unregisterBroadcastReceiver === 'function' ? api as FullyBroadcastApi : null
}

export function connectFullyClicker(
  api: FullyBroadcastApi,
  code: string,
  onPress: (key: 'F13' | 'F14') => void,
  target: EventTarget = window,
) {
  const actions = getFullyClickerActions(code)
  const registered: string[] = []
  const receive = (event: Event) => {
    if (!(event instanceof CustomEvent)) return
    const index = actions.indexOf(event.detail)
    if (index !== -1) onPress(index === 0 ? 'F13' : 'F14')
  }
  const disconnect = () => {
    target.removeEventListener(FULLY_CLICKER_EVENT, receive)
    const errors: unknown[] = []
    for (const action of registered.splice(0)) {
      try { api.unregisterBroadcastReceiver(action) } catch (error) { errors.push(error) }
    }
    if (errors.length) throw new AggregateError(errors, 'Fully clicker receivers could not be removed.')
  }
  try {
    target.addEventListener(FULLY_CLICKER_EVENT, receive)
    api.bind('broadcastReceived',
      `window.dispatchEvent(new CustomEvent("${FULLY_CLICKER_EVENT}",{detail:"$action"}));`)
    for (const action of actions) {
      api.registerBroadcastReceiver(action)
      registered.push(action)
    }
  } catch (error) {
    try { disconnect() } catch (cleanupError) { console.error('Fully clicker cleanup failed:', cleanupError) }
    throw error
  }
  return disconnect
}
