type SearchableArena = { name: string; city: string; address: string }

export function filterArenas<T extends SearchableArena>(arenas: T[], query: string): T[] {
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('sk').trim()
  const words = normalize(query).split(/\s+/).filter(Boolean)
  return arenas.filter((arena) => {
    const text = normalize(`${arena.name} ${arena.city} ${arena.address}`)
    return words.every((word) => text.includes(word))
  })
}
