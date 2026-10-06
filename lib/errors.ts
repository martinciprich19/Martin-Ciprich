export function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object') {
    const details = error as Record<string, unknown>
    if (typeof details.message === 'string' && details.message.trim()) return details.message
    if (typeof details.error_description === 'string' && details.error_description.trim()) return details.error_description
    try {
      const serialized = JSON.stringify(error)
      if (serialized && serialized !== '{}') return serialized
    } catch {
      return fallback
    }
  }
  return fallback
}
