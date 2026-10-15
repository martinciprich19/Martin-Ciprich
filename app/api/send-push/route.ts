import { POST as sendPush } from '@/app/api/push/webhook/route'

export const runtime = 'nodejs'

export const POST = sendPush
