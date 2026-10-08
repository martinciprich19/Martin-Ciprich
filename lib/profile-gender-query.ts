type QueryResult = { data: unknown; error: { code: string; message: string } | null }

let hasWarned = false

export async function withProfileGender<T extends QueryResult>(
  run: (columns: string) => PromiseLike<T>,
  columns: string,
): Promise<T> {
  const result = await run(columns)
  if (!result.error || !['42703', 'PGRST204'].includes(result.error.code) || !result.error.message.includes('gender')) return result
  if (!hasWarned) {
    console.warn('Profile gender is unavailable. Apply scripts/028_profile_gender.sql to enable gender-based player accents.')
    hasWarned = true
  }
  return run(columns.split(',').map((column) => column.trim()).filter((column) => column !== 'gender').join(', '))
}
