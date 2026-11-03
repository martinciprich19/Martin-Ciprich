export type ClickerInputStatus = 'received' | 'context' | 'media-ignored' | 'disabled' | 'repeat' | 'debounce' | 'accepted' | 'waiting' | 'undo'
type ClickerActions = {
  isEnabled: () => boolean
  isHelperMode?: () => boolean
  isBusy?: () => boolean
  onDiagnostic?: (key: string, code: string, status: ClickerInputStatus) => void
  onTeamAPoint: () => void
  onTeamBPoint: () => void
  onTeamUndo: (team: 'TEAM_A' | 'TEAM_B') => void
  onUndo: () => void
  onReset: () => void
  onError: (error: unknown) => void
}

export function createMatchClickerHandler(actions: ClickerActions) {
  let lastPointAt = -Infinity
  type Team = 'TEAM_A' | 'TEAM_B'
  const pending = new Map<Team, ReturnType<typeof setTimeout>>()
  const lastPress = new Map<Team, number>()
  const queue: (() => void)[] = []
  let retry: ReturnType<typeof setTimeout> | undefined
  const cancelPending = () => {
    for (const timer of pending.values()) clearTimeout(timer)
    pending.clear()
    lastPress.clear()
    queue.length = 0
    clearTimeout(retry)
    retry = undefined
  }
  const flush = () => {
    clearTimeout(retry)
    retry = undefined
    if (!actions.isEnabled() || document.visibilityState === 'hidden') {
      cancelPending()
      return
    }
    if (actions.isBusy?.()) {
      retry = setTimeout(flush, 50)
      return
    }
    try {
      queue.shift()?.()
    } catch (error) {
      cancelPending()
      actions.onError(error)
      return
    }
    if (queue.length) retry = setTimeout(flush, 50)
  }

  const handler = (event: KeyboardEvent) => {
    console.log('Stlačený kláves:', event.key, event.code)
    const key = event.key.toLowerCase()
    const helperMode = actions.isHelperMode?.() ?? false
    const diagnosticKey = ['f13', 'f14', 'volumeup', 'audiovolumeup', 'volumedown',
      'audiovolumedown', 'mediaplaypause', 'enter', ' ', 'space', 'a', 'l'].includes(key)
    const report = (status: ClickerInputStatus) => {
      if (helperMode && diagnosticKey) actions.onDiagnostic?.(event.key, event.code, status)
    }
    report('received')
    if (document.visibilityState === 'hidden' || event.defaultPrevented
      || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) {
      report('context')
      return
    }
    const target = event.target
    const helperKey = key === 'f13' || key === 'f14'
    const helperToggle = helperMode && helperKey && target instanceof HTMLElement
      && target.matches('input[type="checkbox"][data-match-clicker-helper]')
    if (target instanceof HTMLElement && (target.isContentEditable
      || target.closest('[role="dialog"], [role="textbox"], textarea, select')
      || (!helperToggle && target.closest('input')))) {
      report('context')
      return
    }

    if (helperKey && !helperMode) return
    if (helperMode && ['volumeup', 'audiovolumeup', 'volumedown', 'audiovolumedown',
      'mediaplaypause', 'enter', ' ', 'space'].includes(key)) {
      event.preventDefault()
      report('media-ignored')
      return
    }
    const spaceKey = key === ' ' || key === 'space' || event.code === 'Space'
    const activationKey = key === 'enter' || spaceKey
    // Keep normal keyboard activation of focused controls instead of adding a point.
    if (activationKey && target instanceof HTMLElement
      && target.closest('button, a, [role="button"], summary')) return

    const teamA = key === 'f13' || ['a', 'volumeup', 'audiovolumeup'].includes(key) || spaceKey
    const teamB = key === 'f14' || ['l', 'volumedown', 'audiovolumedown', 'mediaplaypause', 'enter'].includes(key)
    if (!teamA && !teamB && key !== 'z' && key !== 'm') return
    if (!actions.isEnabled()) {
      report('disabled')
      return
    }
    event.preventDefault()
    if (event.repeat) {
      report('repeat')
      return
    }

    if (teamA || teamB) {
      const now = performance.now()
      const clickerKey = key !== 'a' && key !== 'l'
      if (clickerKey) {
        const team: Team = teamA ? 'TEAM_A' : 'TEAM_B'
        if (now - (lastPress.get(team) ?? -Infinity) < 60) {
          report('debounce')
          return
        }
        lastPress.set(team, now)
        const timer = pending.get(team)
        if (timer !== undefined) {
          clearTimeout(timer)
          pending.delete(team)
          queue.push(() => {
            report('undo')
            actions.onTeamUndo(team)
          })
          flush()
        } else {
          report('waiting')
          pending.set(team, setTimeout(() => {
            pending.delete(team)
            queue.push(() => {
              report('accepted')
              if (teamA) actions.onTeamAPoint()
              else actions.onTeamBPoint()
            })
            flush()
          }, 350))
        }
        return
      }
      if (actions.isBusy?.()) {
        report('disabled')
        return
      }
      if (now - lastPointAt < 400) {
        report('debounce')
        return
      }
      lastPointAt = now
      report('accepted')
      if (teamA) actions.onTeamAPoint()
      else actions.onTeamBPoint()
    } else if (!actions.isBusy?.()) {
      cancelPending()
      if (key === 'z') actions.onUndo()
      else actions.onReset()
    }
  }
  return Object.assign(handler, { cancelPending })
}
