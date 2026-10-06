import { createClient } from '@/lib/supabase/client'

export type ChatMessage = { id: string; senderId: string; receiverId: string; content: string; createdAt: string; isRead: boolean }

function toId(value: string | number) {
  const id = typeof value === 'number'
    ? Number.isSafeInteger(value) ? String(value) : ''
    : value.trim()
  if (!/^[1-9]\d*$/.test(id)) throw new Error('Neplatné ID hráča.')
  return id
}

export async function fetchMessages(myId: string | number, friendId: string | number): Promise<ChatMessage[]> {
  const me = toId(myId)
  const friend = toId(friendId)
  const { data, error } = await createClient()
    .from('messages')
    .select('id, sender_id, receiver_id, content, created_at, is_read')
    .or(`and(sender_id.eq.${me},receiver_id.eq.${friend}),and(sender_id.eq.${friend},receiver_id.eq.${me})`)
    .order('created_at', { ascending: true })
    .limit(200)
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: String(row.id),
    senderId: String(row.sender_id),
    receiverId: String(row.receiver_id),
    content: String(row.content ?? ''),
    createdAt: String(row.created_at),
    isRead: Boolean(row.is_read),
  }))
}

export async function fetchUnreadMessageCount(userId: string | number): Promise<number> {
  const { count, error } = await createClient()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('receiver_id', toId(userId))
    .neq('sender_id', toId(userId))
    .eq('is_read', false)
  if (error) throw error
  return count ?? 0
}

export async function fetchUnreadMessagesBySender(userId: string | number): Promise<Record<string, number>> {
  const { data, error } = await createClient()
    .from('messages')
    .select('sender_id')
    .eq('receiver_id', toId(userId))
    .neq('sender_id', toId(userId))
    .eq('is_read', false)
  if (error) throw error

  return (data ?? []).reduce<Record<string, number>>((counts, row) => {
    const senderId = String(row.sender_id)
    counts[senderId] = (counts[senderId] ?? 0) + 1
    return counts
  }, {})
}

// The notification for the receiver is created by a database trigger.
export async function sendMessage(myId: string | number, friendId: string | number, content: string) {
  const { error } = await createClient().from('messages').insert({ sender_id: toId(myId), receiver_id: toId(friendId), content: content.trim() })
  if (error) throw error
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('communications-updated'))
}
