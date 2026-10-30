import { ScoreboardView } from '@/components/scoreboard-view'

export default async function CourtScoreboardPage({
  params,
}: {
  params: Promise<{ courtId: string }>
}) {
  const { courtId } = await params
  if (!/^[1-9]\d*$/.test(courtId) || !Number.isSafeInteger(Number(courtId))) {
    return <InvalidCourtId />
  }

  return <ScoreboardView courtId={courtId} />
}

function InvalidCourtId() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#080d10] p-8 text-white">
      <p className="text-center text-xl font-bold">Neplatná adresa obrazovky. Skontroluj URL u správcu arény.</p>
    </main>
  )
}
