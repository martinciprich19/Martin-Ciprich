export const PAIR_ELO_BANDS = [
  { value: 'under-900', label: 'Menej ako 900 ELO', min: Number.NEGATIVE_INFINITY, max: 899 },
  { value: '900-1099', label: '900–1099 ELO', min: 900, max: 1099 },
  { value: '1100-1299', label: '1100–1299 ELO', min: 1100, max: 1299 },
  { value: '1300-plus', label: '1300 a viac ELO', min: 1300, max: Number.POSITIVE_INFINITY },
] as const

export function getPairEloBand(elo: number): (typeof PAIR_ELO_BANDS)[number]['value'] | undefined {
  return PAIR_ELO_BANDS.find((band) => elo >= band.min && elo <= band.max)?.value
}
