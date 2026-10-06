export function validateMatchScore(form: Record<string, string>) {
  const errors: Record<number, string> = {}
  const sets: { team1Score: number; team2Score: number }[] = []

  const validateSet = (setNumber: number) => {
    const first = form[`set${setNumber}a`] ?? ''
    const second = form[`set${setNumber}b`] ?? ''
    if (first === '' || second === '') {
      errors[setNumber] = 'Vyplň skóre oboch dvojíc.'
      return null
    }
    const team1Score = Number(first)
    const team2Score = Number(second)
    const winnerScore = Math.max(team1Score, team2Score)
    const loserScore = Math.min(team1Score, team2Score)
    if (!Number.isInteger(team1Score) || !Number.isInteger(team2Score)
      || loserScore < 0
      || !((winnerScore === 6 && loserScore <= 4)
        || (winnerScore === 7 && (loserScore === 5 || loserScore === 6)))) {
      errors[setNumber] = 'Neplatný výsledok setu. Povolené: 6:0 až 6:4, 7:5 alebo 7:6 (aj opačne).'
      return null
    }
    const set = { team1Score, team2Score }
    sets.push(set)
    return team1Score > team2Score ? 1 : 2
  }

  const firstWinner = validateSet(1)
  const secondWinner = validateSet(2)
  const thirdSetEnabled = firstWinner !== null && secondWinner !== null && firstWinner !== secondWinner
  if (thirdSetEnabled) {
    validateSet(3)
  } else if (form.set3a || form.set3b) {
    errors[3] = 'Tretí set je povolený iba pri stave setov 1:1.'
  }

  return { errors, sets, thirdSetEnabled, isValid: Object.keys(errors).length === 0 }
}