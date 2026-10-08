'use client'

import { AppBackground } from '@/components/app-background'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { RivaLogo } from '@/components/riva-logo'
import { InstallAppButton } from '@/components/install-app-button'
import { playerAccentColor } from '@/lib/player-accent'
import { useRouter } from 'next/navigation'
import {
  Activity,
  Bell,
  Building2,
  ExternalLink,
  Eye,
  MapPin,
  Search,
  Calendar,
  Check,
  Plus,
  Send,
  Trash2,
  ChevronRight,
  Crosshair,
  LayoutDashboard,
  Lock,
  LogOut,
  Mail,
  Phone,
  Save,
  UserCog,
  UserPlus,
  UserSearch,
  Menu,
  MessageSquare,
  Settings,
  Shield,
  Swords,
  Trophy,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import useSWR, { useSWRConfig } from 'swr'
import { fetchArenas, type Arena } from '@/lib/arenas'
import { ArenasView, ALL_CITIES } from '@/components/arenas-view'
import { useLanguage } from '@/components/language-provider'
import { PairChallengeView } from '@/components/pair-challenge-view'
import { PairsView } from '@/components/pairs-view'
import { PlayerMarketplaceView as FindPlayersView } from '@/components/player-marketplace-view'
import { RankingsView } from '@/components/rankings-view'
import { TournamentsView } from '@/components/tournaments-view'
import { fetchOverviewStats } from '@/lib/overview'
import { createPlayerProfile, DEFAULT_PLAYER_PREFERENCES, fetchPlayerPreferences, fetchPlayerProfile, fetchPlayerProfiles, refreshSeasonRatings, updatePlayerPreferences, updatePlayerProfile, type PlayerPreferences, type DominantHand, type Gender, deleteMyAccount } from '@/lib/profiles'
import { fetchIncomingRequests } from '@/lib/friendships'
import { removeProfileAvatar, saveProfileAvatar } from '@/lib/profile-avatar'
import { getErrorMessage } from '@/lib/errors'
import { RecentFormCard } from '@/components/recent-form-card'
import { MatchDetailModal, matchDetailKey } from '@/components/match-detail-modal'
import { fetchNotifications, markNotificationRead, type LeagueNotification } from '@/lib/notifications'
import { fetchUnreadMessagesBySender } from '@/lib/messages'
import { FriendsChat } from '@/components/friends-chat'
import { fetchIncomingPairInvitations, respondToPairInvitation, type PairInvitation, type PlayerPair } from '@/lib/pairs'
import { fetchParticipantMatches, fetchProfileMatches, isAwaitingResponseFrom, isCountedMatch, respondToMatchResult, submitMatchResult, type ProfileMatch } from '@/lib/profile-matches'
import { validateMatchScore } from '@/lib/match-score'
import { EMPTY_PLAYER_SLOT, MATCH_PLAYER_FIELDS, DUPLICATE_PLAYER_ERROR, normalizePlayerName, validateMatchPlayers, type MatchPlayerField, type MatchPlayerSlot, type MatchPlayerSlots } from '@/lib/match-players'
import { fetchUpcomingPairChallenges, respondToPairChallenge } from '@/lib/pair-challenges'

type MatchRecord = { id: string; databaseId?: string; date: string; arena: string; team1: { player1Id: string; player1Name: string; player2Id: string; player2Name: string; approved: boolean }; team2: { player1Id: string; player1Name: string; player2Id: string; player2Name: string; approved: boolean }; sets: { team1Score: number; team2Score: number }[]; winnerTeam: 1 | 2; eloDeltaTeam1: number; eloDeltaTeam2: number; status: 'PENDING' | 'APPROVED' | 'DISPUTED' | 'CANCELLED'; createdAt: string }
type Match = { id: string; date: string; arena: string; teammate: string; opponents: string; scores: string[]; approvedBy: number; status: 'PENDING' | 'APPROVED' | 'REJECTED' }
type Challenge = { id: string; senderId: string; senderName: string; receiverId: string; receiverName: string; arena: string; proposedDate: string; matchType: 'ranked' | 'friendly'; note?: string; status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED' | 'COMPLETED'; createdAt: string }
type Player = { player_id: string; profile_id: number | null; username: string; email: string; elo: number; career_elo: number; elo_season_start: string | null; highest_elo: number; matches_played: number; wins: number; win_rate: string; history: string[]; region: string; level: string; dominant_hand: DominantHand; home_venue_id: string | null; auto_venue_id: string | null; created_at: string | null }
type ProfileSettings = { displayName: string; email: string; phone: string; region: string; level: string; preferredSide: 'left' | 'right' | 'both'; dominantHand: 'right' | 'left' | 'both'; racketBrand: string; bio: string; emailChallenges: boolean; emailMatchApproval: boolean; emailMessages: boolean; emailTournaments: boolean; pushAlerts: boolean; rankingAlerts: boolean; showPhone: 'everyone' | 'accepted_only' | 'friends_only' | 'private' | 'never'; publicStats: boolean; allowDirectMessages: boolean; homeArenaId: string; preferredTimeSlots: string[] }
type OpponentPlayer = Player & { homeArena: string; availability: string }
type ChallengeTargetPair = { player1Id: string; player1Name: string; player2Id: string; player2Name: string }

const navItems = [
  { label: 'Prehľad', href: '/profile', icon: LayoutDashboard },
  { label: 'Môj profil', href: '/profile?view=profile', icon: UserRound },
  { label: 'Rebríčky', href: '/profile?view=rankings', icon: Trophy },
  { label: 'Nájsť hráčov', href: '#players', icon: UserSearch },
  { label: 'Vyzvať dvojicu', href: '#challenges', icon: Swords },
  { label: 'Výsledky', href: '#matches', icon: Crosshair },
  { label: 'Turnaje', href: '/profile?view=tournaments', icon: Shield },
  { label: 'Arény', href: '#arenas', icon: Users },
  { label: 'Správy', href: '#messages', icon: MessageSquare },
  { label: 'Nastavenia', href: '#settings', icon: Settings },
]

const bottomNavItems = [
  { label: 'Rankings', short: 'Rebríčky', tab: 'rankings', href: '/profile?view=rankings', icon: Trophy },
  { label: 'Players', short: 'Nájsť hráčov', tab: 'opponents', href: '/profile?view=opponents', icon: UserSearch },
  { label: 'Results', short: 'Výsledky', tab: 'matches', href: '/profile?view=matches', icon: Crosshair },
  { label: 'Messages', short: 'Správy', tab: 'messages', href: '/profile?view=messages', icon: MessageSquare },
  { label: 'My profile', short: 'Môj profil', tab: 'profile', href: '/profile?view=profile', icon: UserRound },
] as const

type ProfileTab = 'overview' | 'profile' | 'challenges' | 'matches' | 'arenas' | 'messages' | 'settings' | 'leaderboards' | 'opponents' | 'rankings' | 'tournaments'
const tabByLabel: Record<string, ProfileTab> = { 'Prehľad': 'overview', 'Môj profil': 'profile', 'Rebríčky': 'rankings', 'Nájsť hráčov': 'opponents', 'Vyzvať dvojicu': 'challenges', 'Výsledky': 'matches', 'Turnaje': 'tournaments', 'Arény': 'arenas', 'Správy': 'messages', 'Nastavenia': 'settings' }
const tabsFromUrl: ProfileTab[] = ['profile', 'challenges', 'matches', 'messages', 'settings', 'opponents', 'arenas', 'rankings', 'tournaments']

export default function ProfilePage() {
  const router = useRouter()
  const { language, setLanguage, t } = useLanguage()
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview')
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [opponentPlayers, setOpponentPlayers] = useState<OpponentPlayer[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [settings, setSettings] = useState<ProfileSettings>({ displayName: '', email: '', phone: '', region: '', level: '', dominantHand: 'right', bio: '', showPhone: 'accepted_only', homeArenaId: '', ...DEFAULT_PLAYER_PREFERENCES })
  const [settingsSection, setSettingsSection] = useState('profile')
  const [settingsToast, setSettingsToast] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [detailMatchId, setDetailMatchId] = useState<string | null>(null)
  const [challengeModalOpen, setChallengeModalOpen] = useState(false)
  const [challengeTargetPair, setChallengeTargetPair] = useState<ChallengeTargetPair | null>(null)
  const [showPairsView, setShowPairsView] = useState(false)
  const [challengeForm, setChallengeForm] = useState({ opponentId: '', opponentName: '', arena: '', proposedDate: '', matchType: 'ranked' as 'ranked' | 'friendly', note: '' })
  const [menuOpen, setMenuOpen] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [gender, setGender] = useState<Gender | null>(null)
  const [arenas, setArenas] = useState<Arena[]>([])
  const { isLoading: arenasLoading, error: arenasError, mutate: mutateArenas } = useSWR('arenas', fetchArenas, { onSuccess: setArenas })
  const [arenaRegion, setArenaRegion] = useState(ALL_CITIES)
  const [arenaSearch, setArenaSearch] = useState('')
  const isLeagueAdmin = false
  const [homeArenaId, setHomeArenaId] = useState<string | null>(null)
  const [matchRecords, setMatchRecords] = useState<MatchRecord[]>([])
  const [matchModalOpen, setMatchModalOpen] = useState(false)
  const [matchArena, setMatchArena] = useState('')
  const [matches, setMatches] = useState<Match[]>([])
  const [matchForm, setMatchForm] = useState({ date: '', arena: '', teammate: '', opponents: '', set1: '', set2: '', set3: '' })
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [player, setPlayer] = useState<Player>({
    player_id: '',
    profile_id: null,
    username: '',
    email: '',
    elo: 1000,
    career_elo: 1000,
    elo_season_start: null,
    highest_elo: 1000,
    matches_played: 0,
    wins: 0,
    win_rate: '0%',
    history: [],
    region: 'Žilinský kraj',
    level: 'Mierne pokročilý',
    dominant_hand: 'right',
    home_venue_id: null,
    auto_venue_id: null,
    created_at: null,
  })

  const { data: overview, isLoading: overviewLoading, mutate: mutateOverview } = useSWR(player.email ? ['overview', player.email] : null, ([, email]) => fetchOverviewStats(email), { revalidateOnFocus: true, revalidateOnReconnect: true, dedupingInterval: 0 })
  const { data: profileMatches = [], isLoading: profileMatchesLoading, error: profileMatchesError, mutate: mutateProfileMatches } = useSWR(player.profile_id !== null ? ['profile-matches', String(player.profile_id)] : null, ([, profileId]) => fetchProfileMatches(profileId), { revalidateOnFocus: true, revalidateOnReconnect: true, dedupingInterval: 0 })
  const { data: notifications = [], mutate: mutateNotifications } = useSWR(player.profile_id !== null ? ['notifications', player.profile_id] : null, ([, id]) => fetchNotifications(id), { refreshInterval: 15000, shouldRetryOnError: false })
  // Same key as MatchesView, so confirming/rejecting there updates the sidebar badge immediately.
  const { data: participantMatches = [], mutate: mutateParticipantMatches } = useSWR(player.profile_id !== null ? ['participant-matches', player.profile_id] : null, ([, id]) => fetchParticipantMatches(id), { refreshInterval: 15000, revalidateOnFocus: true, shouldRetryOnError: false })
  const pendingMatchApprovalCount = player.profile_id === null ? 0 : participantMatches.filter((match) => isAwaitingResponseFrom(match, player.profile_id as number)).length
  const { data: unreadMessagesBySender = {}, mutate: mutateUnreadMessagesBySender } = useSWR(player.profile_id !== null ? ['unread-messages-by-sender', player.profile_id] : null, ([, id]) => fetchUnreadMessagesBySender(id), { refreshInterval: 30000, shouldRetryOnError: false })
  const { data: incomingFriendRequests = [], mutate: mutateIncomingFriendRequests } = useSWR(player.profile_id !== null ? ['incoming-friend-requests', player.profile_id] : null, ([, id]) => fetchIncomingRequests(id), { refreshInterval: 30000, shouldRetryOnError: false })
  const { data: incomingPairInvitations = [], error: incomingPairInvitationsError, mutate: mutateIncomingPairInvitations } = useSWR(player.profile_id !== null ? ['incoming-pair-invitations', player.profile_id] : null, ([, id]) => fetchIncomingPairInvitations(id), { refreshInterval: 15000, revalidateOnFocus: true, shouldRetryOnError: false })
  const { data: upcomingMatches = [], isLoading: upcomingMatchesLoading, error: upcomingMatchesError, mutate: mutateUpcomingMatches } = useSWR(player.profile_id !== null ? ['upcoming-pair-challenges', player.profile_id] : null, ([, id]) => fetchUpcomingPairChallenges(id), { refreshInterval: 15000, revalidateOnFocus: true, revalidateOnReconnect: true, shouldRetryOnError: false })

  useEffect(() => {
    if (player.profile_id === null) return
    const supabase = createClient()
    const refreshCommunicationCounts = () => {
      void mutateUnreadMessagesBySender()
      void mutateIncomingFriendRequests()
      void mutateIncomingPairInvitations()
      void mutateNotifications()
      void mutateUpcomingMatches()
    }
    const refreshRealtimeCommunicationCounts = () => {
      refreshCommunicationCounts()
      window.dispatchEvent(new Event('communications-realtime-updated'))
    }
    const refreshMatchStats = () => {
      void mutateProfileMatches()
      void mutateParticipantMatches()
      void mutateOverview()
      window.dispatchEvent(new Event('proffiles-updated'))
    }
    const channel = supabase
      .channel(`communications-${player.profile_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `receiver_id=eq.${player.profile_id}` }, refreshRealtimeCommunicationCounts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, refreshRealtimeCommunicationCounts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pair_invitations', filter: `invitee_id=eq.${player.profile_id}` }, refreshRealtimeCommunicationCounts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'challenges', filter: `challenger_1_id=eq.${player.profile_id}` }, refreshRealtimeCommunicationCounts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'challenges', filter: `challenger_2_id=eq.${player.profile_id}` }, refreshRealtimeCommunicationCounts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'challenges', filter: `challenged_1_id=eq.${player.profile_id}` }, refreshRealtimeCommunicationCounts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'challenges', filter: `challenged_2_id=eq.${player.profile_id}` }, refreshRealtimeCommunicationCounts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `player1_id=eq.${player.profile_id}` }, refreshMatchStats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `player2_id=eq.${player.profile_id}` }, refreshMatchStats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `team1_player2_id=eq.${player.profile_id}` }, refreshMatchStats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `team2_player2_id=eq.${player.profile_id}` }, refreshMatchStats)
      // DELETE events can't be filtered by column, so listen to all deletions.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'matches' }, refreshMatchStats)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'proffiles', filter: `id=eq.${player.profile_id}` }, refreshMatchStats)
      .subscribe()
    window.addEventListener('communications-updated', refreshCommunicationCounts)
    return () => {
      window.removeEventListener('communications-updated', refreshCommunicationCounts)
      void supabase.removeChannel(channel)
    }
  }, [player.profile_id, mutateNotifications, mutateUnreadMessagesBySender, mutateIncomingFriendRequests, mutateIncomingPairInvitations, mutateUpcomingMatches, mutateProfileMatches, mutateParticipantMatches, mutateOverview])

  const unreadMessageCount = Object.values(unreadMessagesBySender).reduce((total, count) => total + count, 0)
  const unreadCommunicationCount = unreadMessageCount + incomingFriendRequests.length + incomingPairInvitations.length

  const unreadOtherNotificationCount = notifications.filter((notification) => !notification.read && !['friend_request', 'message', 'new_message', 'direct_message'].includes(notification.type)).length
  const unreadAlertCount = unreadCommunicationCount + unreadOtherNotificationCount
  const [messagesCategory, setMessagesCategory] = useState<'direct' | 'notifications'>('direct')
  const [communicationAlertsSeen, setCommunicationAlertsSeen] = useState(false)
  const previousUnreadAlertCount = useRef(0)
  const overviewName = player.username || overview?.displayName || 'Hráč'
  const memberSince = overview?.memberSince ? new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'sk-SK', { month: 'long', year: 'numeric' }).format(new Date(overview.memberSince)) : null

  useEffect(() => {
    if (unreadAlertCount > previousUnreadAlertCount.current) setCommunicationAlertsSeen(false)
    previousUnreadAlertCount.current = unreadAlertCount
  }, [unreadAlertCount])

  useEffect(() => {
    if (activeTab === 'messages' && messagesCategory === 'notifications') setCommunicationAlertsSeen(true)
  }, [activeTab, messagesCategory])

  useEffect(() => {
    const refreshProfile = () => {
      void mutateOverview()
      if (!player.email) return
      void fetchPlayerProfile(player.email).then((profile) => {
        if (!profile) return
        setAvatarUrl(profile.avatar_url)
        setGender(profile.gender)
        setPlayer((current) => ({ ...current, username: profile.full_name, email: profile.email, elo: profile.elo_rating, career_elo: profile.career_elo, elo_season_start: profile.elo_season_start, highest_elo: profile.highest_elo, matches_played: profile.matches_played, wins: profile.matches_won, region: profile.region, level: profile.level, dominant_hand: profile.dominant_hand, home_venue_id: profile.home_venue_id, auto_venue_id: profile.auto_venue_id }))
        setHomeArenaId(profile.home_venue_id || profile.auto_venue_id)
        setSettings((current) => ({ ...current, displayName: profile.full_name, email: profile.email, phone: profile.phone, region: profile.region, level: profile.level, dominantHand: profile.dominant_hand, bio: profile.bio, showPhone: profile.phone_visibility }))
      }).catch((error: unknown) => console.error('Obnovenie profilu zlyhalo:', getErrorMessage(error, 'Profil sa nepodarilo obnoviť.')))
    }
    window.addEventListener('proffiles-updated', refreshProfile)
    window.addEventListener('focus', refreshProfile)
    return () => {
      window.removeEventListener('proffiles-updated', refreshProfile)
      window.removeEventListener('focus', refreshProfile)
    }
  }, [mutateOverview, player.email])

  useEffect(() => {
    if (activeTab !== 'profile' || !player.email) return
    void fetchPlayerProfile(player.email).then((profile) => {
      if (profile) setPlayer((current) => ({ ...current, elo: profile.elo_rating, career_elo: profile.career_elo, elo_season_start: profile.elo_season_start, highest_elo: profile.highest_elo }))
    }).catch((error: unknown) => console.error('Obnovenie ELO zlyhalo:', getErrorMessage(error, 'ELO sa nepodarilo obnoviť.')))
  }, [activeTab, player.email])

  useEffect(() => {
    if (settingsToast) {
      setPlayer((current) => ({ ...current, username: settings.displayName, email: settings.email, region: settings.region, level: settings.level, home_venue_id: settings.homeArenaId || null }))
      setHomeArenaId(settings.homeArenaId || player.auto_venue_id || null)
    }
  }, [settingsToast, settings.displayName, settings.email, settings.region, settings.level, settings.homeArenaId, player.auto_venue_id])

  function openNotifications() {
    setCommunicationAlertsSeen(true)
    void mutateNotifications((current) => current?.map((notification) => ({ ...notification, read: true })), { revalidate: false })
    void createClient().rpc('mark_notifications_as_read').then(({ error }) => {
      if (error) {
        console.error('Notifikácie sa nepodarilo označiť ako prečítané:', error.message)
        return
      }
      void mutateNotifications()
    })

    const unreadNotification = notifications.find((notification) => !notification.read)
    const messageNotificationTypes = ['message', 'new_message', 'direct_message']

    if (unreadNotification?.type === 'friend_request' || (!unreadNotification && incomingFriendRequests.length > 0)) {
      setActiveConversationId(null)
      setMessagesCategory('direct')
    } else if (incomingPairInvitations.length > 0) {
      setActiveConversationId(null)
      setMessagesCategory('notifications')
    } else if (unreadNotification && messageNotificationTypes.includes(unreadNotification.type) && unreadNotification.senderId) {
      setActiveConversationId(unreadNotification.senderId)
      setMessagesCategory('direct')
    } else if (!unreadNotification && unreadMessageCount > 0) {
      const [senderId] = Object.entries(unreadMessagesBySender).sort((first, second) => second[1] - first[1])[0] ?? []
      setActiveConversationId(senderId ?? null)
      setMessagesCategory('direct')
    } else {
      setActiveConversationId(null)
      setMessagesCategory('notifications')
    }
    setActiveTab('messages')
  }

  function markRead(id: string) {
    void mutateNotifications((current) => current?.map((notification) => notification.id === id
      ? { ...notification, read: true }
      : notification), { revalidate: false })
    void markNotificationRead(id)
      .then(() => mutateNotifications())
      .catch((error: unknown) => {
        console.error('Notifikáciu sa nepodarilo označiť ako prečítanú:', getErrorMessage(error, 'Notifikáciu sa nepodarilo označiť ako prečítanú.'))
        void mutateNotifications()
      })
  }

  const countedProfileMatches = profileMatches.filter(isCountedMatch)
  const matchesFromHistory = !profileMatchesLoading && !profileMatchesError
  const matchTotal = matchesFromHistory ? countedProfileMatches.length : Math.max(0, player.matches_played)
  const matchWins = Math.min(matchTotal, Math.max(0, matchesFromHistory ? countedProfileMatches.filter((match) => match.result === 'win').length : player.wins))
  const matchStats = {
    total: matchTotal,
    wins: matchWins,
    losses: matchTotal - matchWins,
    winRate: matchTotal ? Math.round((matchWins / matchTotal) * 100) : 0,
    wonSets: countedProfileMatches.reduce((total, match) => total + match.sets_won, 0),
    lostSets: countedProfileMatches.reduce((total, match) => total + match.sets_lost, 0),
    wonGames: countedProfileMatches.reduce((total, match) => total + match.games_won, 0),
    lostGames: countedProfileMatches.reduce((total, match) => total + match.games_lost, 0),
    elo: player.elo,
  }


  function submitMatch(event: React.FormEvent) {
    event.preventDefault()
    const scores = [matchForm.set1, matchForm.set2, matchForm.set3].filter(Boolean)
    if (!matchForm.date || !matchForm.arena || !matchForm.teammate || !matchForm.opponents || scores.length < 2) return
    setMatches((current) => [...current, { id: crypto.randomUUID(), date: matchForm.date, arena: matchForm.arena, teammate: matchForm.teammate, opponents: matchForm.opponents, scores, approvedBy: 1, status: 'PENDING' }])
    setMatchForm({ date: '', arena: '', teammate: '', opponents: '', set1: '', set2: '', set3: '' })
    setMatchModalOpen(false)
  }

  function submitChallenge(event: React.FormEvent) {
    event.preventDefault()
    if (!challengeForm.opponentId || !challengeForm.proposedDate) return
    setChallenges((current) => [{ id: crypto.randomUUID(), senderId: player.player_id || 'current-user', senderName: player.username, receiverId: challengeForm.opponentId, receiverName: challengeForm.opponentName, arena: challengeForm.arena, proposedDate: challengeForm.proposedDate, matchType: challengeForm.matchType, note: challengeForm.note || undefined, status: 'PENDING', createdAt: new Date().toISOString() }, ...current])
    setChallengeModalOpen(false)
    setChallengeForm({ opponentId: '', opponentName: '', arena: '', proposedDate: '', matchType: 'ranked', note: '' })
  }

  const arenasWithHome = arenas.map((arena) => ({ ...arena, isHomeClub: arena.id === homeArenaId }))
  const visibleArenas = arenasWithHome
  function openConversation(participant: { id: string; name: string; elo?: number; region?: string }) {
    setActiveConversationId(participant.id)
    setActiveTab('messages')
    setMessagesCategory('direct')
  }

  function openArenaChallenge(arena: Arena) { setActiveTab('challenges'); setChallengeForm((current) => ({ ...current, arena: arena.name })) }
  function openArenaMatch(arena: Arena) { setMatchArena(arena.name); setActiveTab('matches'); setMatchModalOpen(true) }
  async function setHomeArena(id: string) {
    const previousHomeId = homeArenaId
    setHomeArenaId(id)
    setSettings((current) => ({ ...current, homeArenaId: id }))
    try {
      if (!player.email) throw new Error('Prihlásený profil nemá e-mail.')
      await updatePlayerProfile(player.email, { home_venue_id: id })
      window.dispatchEvent(new Event('proffiles-updated'))
    } catch (error: unknown) {
      setHomeArenaId(previousHomeId)
      setSettings((current) => ({ ...current, homeArenaId: previousHomeId ?? '' }))
      const message = getErrorMessage(error, 'Domovskú arénu sa nepodarilo uložiť.')
      console.error('Uloženie domovskej arény zlyhalo:', message)
      window.alert(message)
    }
  }
  function updateChallenge(id: string, status: Challenge['status']) { setChallenges((current) => current.map((challenge) => challenge.id === id ? { ...challenge, status } : challenge)) }

  function approveMatch() {
    // Results are confirmed only through the server workflow on the Matches tab.
    setActiveTab('matches')
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const view = params.get('view')
    setActiveTab(tabsFromUrl.includes(view as ProfileTab) ? (view as ProfileTab) : 'overview')
    const opponent = params.get('opponent')
    if (opponent) { setChallengeForm((current) => ({ ...current, opponentId: opponent, opponentName: opponent })); setChallengeModalOpen(true) }
    const participantId = params.get('participantId')
    if (participantId) setActiveConversationId(participantId)
    void createClient().auth.getUser().then(async ({ data }) => {
      const user = data.user
      if (!user) { window.location.replace('/auth/login?next=/profile'); return }
      if (!user.email_confirmed_at) {
        await createClient().auth.signOut({ scope: 'local' })
        window.location.replace(`/auth/login?verification=required&email=${encodeURIComponent(user.email ?? '')}`)
        return
      }
      if (!user.email) throw new Error('Prihlásený účet nemá e-mailovú adresu.')
      const { error: venueSyncError } = await createClient().rpc('refresh_my_auto_venue')
      if (venueSyncError) console.warn('Automatickú domovskú arénu sa nepodarilo obnoviť:', getErrorMessage(venueSyncError, 'Obnovenie arény zlyhalo.'))
      await refreshSeasonRatings().catch((seasonError: unknown) => console.warn('Sezónne ELO sa nepodarilo obnoviť:', getErrorMessage(seasonError, 'Obnovenie sezóny zlyhalo.')))
      let profile = await fetchPlayerProfile(user.email)
      if (!profile) {
        const metadata = user.user_metadata ?? {}
        await createPlayerProfile({
          full_name: metadata.display_name?.trim() || metadata.full_name?.trim() || '',
          email: user.email,
          phone: '',
          elo_rating: 1000,
          highest_elo: 1000,
          matches_played: 0,
          matches_won: 0,
          avatar_url: null,
          region: metadata.region ?? '',
          level: metadata.level ?? '',
          dominant_hand: metadata.dominant_hand ?? 'right',
          gender: metadata.gender === 'male' || metadata.gender === 'female' ? metadata.gender : null,
          home_venue_id: metadata.home_venue_id ?? null,
        })
        profile = await fetchPlayerProfile(user.email)
      }
      if (!profile) return
      setPlayer((current) => ({
        ...current,
        player_id: user.id,
        profile_id: profile.id,
        username: profile.full_name,
        email: profile.email,
        elo: profile.elo_rating,
        career_elo: profile.career_elo,
        elo_season_start: profile.elo_season_start,
        highest_elo: profile.highest_elo,
        matches_played: profile.matches_played,
        wins: profile.matches_won,
        region: profile.region,
        level: profile.level,
        dominant_hand: profile.dominant_hand,
        home_venue_id: profile.home_venue_id,
        auto_venue_id: profile.auto_venue_id,
        created_at: profile.created_at,
      }))
      setAvatarUrl(profile.avatar_url)
      setGender(profile.gender ?? (user.user_metadata?.gender === 'female' ? 'female' : user.user_metadata?.gender === 'male' ? 'male' : null))
      setHomeArenaId(profile.home_venue_id || profile.auto_venue_id)
      setSettings((current) => ({ ...current, displayName: profile.full_name, email: profile.email, phone: profile.phone, region: profile.region, level: profile.level, dominantHand: profile.dominant_hand, homeArenaId: profile.home_venue_id ?? '', bio: profile.bio, showPhone: profile.phone_visibility }))
      const preferences = await fetchPlayerPreferences(profile.email).catch((preferencesError: unknown) => {
        console.error('Načítanie nastavení zlyhalo:', getErrorMessage(preferencesError, 'Nastavenia sa nepodarilo načítať.'))
        return null
      })
      if (preferences) setSettings((current) => ({ ...current, ...preferences }))
    }).catch((error: unknown) => {
      const message = getErrorMessage(error, 'Profil sa nepodarilo načítať.')
      console.error('Načítanie profilu zlyhalo:', message)
    })
  }, [])

  async function handleAvatarChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const nextAvatarUrl = await saveProfileAvatar(file)
      setAvatarUrl(nextAvatarUrl)
      window.dispatchEvent(new Event('spl-avatar-updated'))
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Profilovú fotku sa nepodarilo uložiť.')
      console.error('Uloženie profilovej fotky zlyhalo:', message)
      window.alert(message)
    }
  }

  async function removeAvatar() {
    try {
      await removeProfileAvatar()
      setAvatarUrl(null)
      window.dispatchEvent(new Event('spl-avatar-updated'))
      if (avatarInputRef.current) avatarInputRef.current.value = ''
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Profilovú fotku sa nepodarilo odstrániť.')
      console.error('Odstránenie profilovej fotky zlyhalo:', message)
      window.alert(message)
    }
  }

  async function handleLogout() {
    await createClient().auth.signOut()
    router.push('/auth/login')
  }

  return (
    <main className="relative isolate min-h-[100svh] bg-[#0b0f17] text-white" style={{ '--profile-avatar-color': playerAccentColor(gender) } as React.CSSProperties}>
      <AppBackground />
      <div className="flex min-h-[100svh]">
        <aside className={`fixed inset-y-0 left-0 z-30 flex w-[264px] flex-col border-r border-white/[0.07] bg-[#111722] px-5 py-6 lg:static lg:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="flex items-center justify-between px-2">
            <Link href="/profile" className="flex items-center gap-3" onClick={() => { setMenuOpen(false); setActiveTab('overview') }}>
<RivaLogo />
            </Link>
            <button className="text-white/50 lg:hidden" onClick={() => setMenuOpen(false)} aria-label="Zavrieť menu"><X size={20} /></button>
          </div>

          <nav className="mt-10 flex-1 space-y-1" aria-label="Hlavná navigácia">
            {navItems.map(({ label, href, icon: Icon }) => (
              <Link key={label} href={href} onClick={() => { setMenuOpen(false); setActiveTab(tabByLabel[label]) }} className={`group flex items-center justify-between rounded-xl px-3 py-3 text-sm font-medium ${(tabByLabel[label] === activeTab) ? 'bg-[#ccff00] font-bold text-[#10150d]' : 'text-white/55 hover:bg-white/[0.05] hover:text-white'}`}>
                <span className="flex items-center gap-3"><Icon size={18} strokeWidth={(tabByLabel[label] === activeTab) ? 2.5 : 1.8} /><span>{t(label)}</span></span>
                {label === 'Správy' && unreadCommunicationCount > 0 ? <span aria-label={t(`${unreadCommunicationCount} neprečítaných`, `${unreadCommunicationCount} unread`)} className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black text-white">{unreadCommunicationCount > 99 ? '99+' : unreadCommunicationCount}</span> : null}
                {label === 'Výsledky' && pendingMatchApprovalCount > 0 ? <span aria-label={t(`${pendingMatchApprovalCount} zápasov čaká na potvrdenie`, `${pendingMatchApprovalCount} matches awaiting confirmation`)} title={t('Zápasy čakajúce na tvoje potvrdenie', 'Matches awaiting your confirmation')} className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black text-white">{pendingMatchApprovalCount > 99 ? '99+' : pendingMatchApprovalCount}</span> : null}
              </Link>
            ))}
          </nav>

          <button onClick={handleLogout} className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-white/45 hover:bg-white/[0.05] hover:text-white"><LogOut size={18} />{t('Odhlásiť sa', 'Log out')}</button>
        </aside>

        {menuOpen ? <button className="fixed inset-0 z-20 bg-black/60 lg:hidden" onClick={() => setMenuOpen(false)} aria-label="Zavrieť navigáciu" /> : null}

        <section className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-2 border-b border-white/[0.07] bg-[#0b0f17]/85 px-3 backdrop-blur md:static md:h-[76px] md:bg-transparent md:px-8 md:backdrop-blur-none lg:px-10">
            <button className="flex h-11 w-11 items-center justify-center rounded-lg text-white/70 lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Otvoriť menu"><Menu size={22} /></button>
            <Link href="/profile" onClick={() => setActiveTab('overview')} className="md:hidden" aria-label="RIVA Padel — Prehľad"><RivaLogo size="sm" /></Link>
            <div className="hidden text-xs text-white/35 sm:block">RIVA / <span className="text-white/70">{activeTab === 'profile' ? 'MÔJ PROFIL' : activeTab === 'challenges' ? t(showPairsView ? 'DVOJICE' : 'VYZVAŤ DVOJICU') : activeTab === 'matches' ? t('VÝSLEDKY', 'RESULTS') : activeTab === 'arenas' ? 'ARÉNY' : activeTab === 'messages' ? t('SPRÁVY', 'MESSAGES') : activeTab === 'settings' ? 'NASTAVENIA' : activeTab === 'opponents' ? t('NÁJSŤ HRÁČOV') : activeTab === 'rankings' ? t('REBRÍČKY', 'RANKINGS') : activeTab === 'tournaments' ? t('TURNAJE', 'TOURNAMENTS') : 'PREHĽAD'}</span></div>
            <div className="ml-auto flex items-center gap-2 md:gap-4">
              <InstallAppButton compact />
              <button type="button" onClick={openNotifications} className={`relative flex h-11 w-11 items-center justify-center rounded-full border md:h-9 md:w-9 border-white/10 bg-white/[0.04] transition-colors hover:text-white ${activeTab === 'messages' && messagesCategory === 'notifications' ? 'text-[#ccff00]' : 'text-white/55'}`} aria-label={unreadAlertCount > 0 ? t(`Správy a notifikácie, ${unreadAlertCount} neprečítané`, `Messages and notifications, ${unreadAlertCount} unread`) : t('Správy a notifikácie', 'Messages and notifications')} title={t('Správy a notifikácie', 'Messages and notifications')}>
                <Bell size={18} />
                {unreadAlertCount > 0 && !communicationAlertsSeen ? <span aria-live="polite" className={`absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-black text-white ${incomingPairInvitations.length ? 'animate-pulse' : ''}`}>{unreadAlertCount > 9 ? '9+' : unreadAlertCount}</span> : null}
              </button>
              <div className="hidden h-7 w-px bg-white/10 sm:block" />
              <div className="flex items-center gap-2"><AvatarPreview src={avatarUrl} initials={player.username.slice(0, 2)} size="sm" /><span className="hidden text-sm font-semibold sm:block">{player.username}</span></div>
            </div>
          </header>

          {activeTab === 'matches' ? <div className="mx-auto flex max-w-[1280px] justify-end px-4 pt-4 md:px-8 lg:px-10"><button type="button" onClick={() => setMatchModalOpen(true)} className="rounded-lg bg-[#ccff00] px-4 py-2.5 text-xs font-black text-[#10150d]">Zadať výsledok</button></div> : null}
          <div key={activeTab} className="mx-auto max-w-[1280px] px-4 pb-28 pt-6 md:px-8 md:py-8 lg:px-10 lg:py-10">
            {activeTab === 'rankings' ? <RankingsView onChallenge={(opponent) => { setChallengeForm((current) => ({ ...current, opponentId: opponent.id, opponentName: opponent.name })); setActiveTab('challenges') }} onMessage={(opponent) => openConversation(opponent)} /> : activeTab === 'tournaments' ? <TournamentsView /> : activeTab === 'opponents' ? <FindPlayersView currentPlayerId={player.profile_id === null ? undefined : String(player.profile_id)} currentPlayerAvatarUrl={avatarUrl} defaultRegion={player.region} onMessage={(opponent) => openConversation(opponent)} /> : activeTab === 'settings' ? <SettingsView language={language} setLanguage={setLanguage} t={t} onSaveEmail={(email) => setPlayer((current) => ({ ...current, email }))} settings={settings} setSettings={setSettings} section={settingsSection} setSection={setSettingsSection} arenas={arenas} toast={settingsToast} setToast={setSettingsToast} deleteModalOpen={deleteModalOpen} setDeleteModalOpen={setDeleteModalOpen} /> : activeTab === 'messages' ? <MessagesView category={messagesCategory} setCategory={setMessagesCategory} notifications={notifications} pairInvitations={incomingPairInvitations} pairInvitationsError={incomingPairInvitationsError} onMarkRead={markRead} myProfileId={player.profile_id} activeFriendId={activeConversationId} setActiveFriendId={setActiveConversationId} onChallenge={(friend) => { setChallengeForm((current) => ({ ...current, opponentId: friend.id, opponentName: friend.name })); setChallengeModalOpen(true); setActiveTab('challenges') }} /> : activeTab === 'arenas' ? <ArenasView arenas={visibleArenas} totalCount={arenas.length} isLoading={arenasLoading} loadError={Boolean(arenasError)} isAdmin={isLeagueAdmin} region={arenaRegion} setRegion={setArenaRegion} search={arenaSearch} setSearch={setArenaSearch} onChallenge={openArenaChallenge} onMatch={openArenaMatch} onSetHome={setHomeArena} onSaved={(saved) => { setArenas((current) => [...current.filter((item) => item.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name))); void mutateArenas() }} onDeleted={(id) => { setArenas((current) => current.filter((item) => item.id !== id)); void mutateArenas() }} /> : activeTab === 'matches' ? <MatchesView matches={matchRecords} setMatches={setMatchRecords} initialArena={matchArena} modalOpen={matchModalOpen} setModalOpen={setMatchModalOpen} onMatchSaved={() => mutateProfileMatches()} onOpenMatch={setDetailMatchId} /> : activeTab === 'challenges' ? showPairsView ? <PairsView currentPlayerId={player.profile_id === null ? null : String(player.profile_id)} onBack={() => setShowPairsView(false)} onChallenge={(pair: PlayerPair) => { setChallengeTargetPair({ player1Id: pair.player_1_id, player1Name: pair.player_1.full_name, player2Id: pair.player_2_id, player2Name: pair.player_2.full_name }); setShowPairsView(false) }} /> : <PairChallengeView userId={player.profile_id === null ? '' : String(player.profile_id)} userName={player.username} arenas={arenas} initialArena={challengeForm.arena} onOpenPairs={() => setShowPairsView(true)} initialChallengedPair={challengeTargetPair} onInitialPairApplied={setChallengeTargetPair} /> : activeTab === 'profile' ? <ProfileView player={player} phone={settings.phone} avatarUrl={avatarUrl} avatarInputRef={avatarInputRef} handleAvatarChange={handleAvatarChange} removeAvatar={removeAvatar} matches={matches} profileMatches={profileMatches} profileMatchesLoading={profileMatchesLoading} profileMatchesError={profileMatchesError} matchStats={matchStats} matchModalOpen={matchModalOpen} setMatchModalOpen={setMatchModalOpen} matchForm={matchForm} setMatchForm={setMatchForm} submitMatch={submitMatch} approveMatch={approveMatch} onOpenMatch={setDetailMatchId} /> : <>
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <div><p className="text-xs font-bold uppercase tracking-[0.22em] text-[#ccff00]">{t('Vitaj späť v RIVA Padel', 'Welcome back to RIVA Padel')}</p><h1 className="mt-3 text-2xl font-black tracking-tight md:text-4xl">{t('Ahoj', 'Hi')}, {overviewName}! <span aria-hidden="true">👋</span></h1><div className="mt-3 flex flex-wrap items-center gap-2">{memberSince ? <p className="text-sm text-white/45">{t('Členom od', 'Member since')}: {memberSince}</p> : null}{player.region ? <span className="rounded-full border border-[#ccff00]/25 bg-[#ccff00]/10 px-3 py-1 text-[11px] font-semibold text-[#ccff00]">{player.region}</span> : null}{player.level ? <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] font-semibold text-white/65">{player.level}</span> : null}</div></div>
              <button type="button" onClick={() => setActiveTab('matches')} className="group inline-flex items-center gap-2 self-start rounded-lg border border-spl-border bg-slate-800/90 px-4 py-2.5 text-xs font-bold text-white/65 hover:border-[#ccff00]/50 hover:text-white sm:self-auto">{t('Zobraziť moje zápasy', 'View my matches')} <span className="transition-colors group-hover:text-[#ccff00]">&gt;</span></button>
            </div>

            <section id="profile" className="mt-8 flex flex-col gap-5 rounded-2xl border border-white/[0.08] bg-[#111722] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"><div className="flex items-center gap-4"><AvatarPreview src={avatarUrl} initials={player.username.slice(0, 1)} /><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Môj profil</p><p className="mt-1 font-bold">{player.username}</p><p className="mt-1 text-xs text-white/40">{player.region} · {player.level}</p></div></div></section>

            <div className="mt-6 grid gap-3 md:mt-9 md:grid-cols-2 md:gap-4 xl:grid-cols-4">
              <StatCard label={t('ELO rating', 'ELO rating')} value={overviewLoading ? '–' : `${overview?.elo ?? 1000}`} suffix="ELO" detail={t('Tvoje aktuálne hodnotenie', 'Your current rating')} icon={<Crosshair size={19} />} />
              <StatCard label={t('Rebríček', 'Ranking')} value={overview?.rank ? `${overview.rank}.` : '–'} suffix={t('Celoslovensky', 'Nationwide')} detail={overview?.rank ? t('Aktuálna pozícia', 'Current position') : t('Zobrazí sa po prvom zápase', 'Shown after your first match')} icon={<Trophy size={19} />} onClick={() => { setActiveTab('leaderboards'); router.push('/rankings') }} />
              <StatCard label={t('Zápasy / Výhry', 'Matches / Wins')} value={`${overview?.matchesPlayed ?? 0} / ${overview?.wins ?? 0}`} suffix="" detail={t('Celková bilancia', 'Overall record')} icon={<Swords size={19} />} onClick={() => setActiveTab('matches')} />
              <StatCard label={t('Úspešnosť', 'Win rate')} value={`${overview?.winRate ?? 0}%`} suffix="" detail={t('Úspešnosť zápasov', 'Match success rate')} icon={<Crosshair size={19} />} />
            </div>

            <div className="mt-8 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
              <section id="matches" className="rounded-2xl border border-white/[0.08] bg-[#111722] p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">{t('Najbližšie', 'Upcoming')}</p><h2 className="mt-2 text-xl font-bold">{t('Nasledujúce zápasy', 'Upcoming matches')}</h2></div>
                  <button type="button" onClick={() => setActiveTab('challenges')} className="shrink-0 text-xs font-bold text-[#ccff00]">{t('Výzvy', 'Challenges')} <ChevronRight className="inline" size={14} /></button>
                </div>
                {upcomingMatchesLoading ? <p role="status" className="py-10 text-sm text-white/45">{t('Načítavam zápasy…', 'Loading matches…')}</p>
                  : upcomingMatchesError ? <p role="alert" className="py-6 text-sm text-red-300">{getErrorMessage(upcomingMatchesError, t('Naplánované zápasy sa nepodarilo načítať.', 'Could not load upcoming matches.'))}</p>
                  : upcomingMatches.length ? <ul className="mt-6 divide-y divide-white/10">
                    {upcomingMatches.map((match) => {
                      const participantName = (profile: typeof match.challenger_1) => (Array.isArray(profile) ? profile[0] : profile)?.full_name?.trim() || t('Hráč', 'Player')
                      const arena = arenas.find((item) => item.id === String(match.arena_id))
                      return <li key={match.id} className="space-y-2 py-4 first:pt-0">
                        <p className="break-words text-sm font-bold">{participantName(match.challenger_1)} &amp; {participantName(match.challenger_2)} <span className="text-white/40">vs</span> {participantName(match.challenged_1)} &amp; {participantName(match.challenged_2)}</p>
                        <p className="flex items-center gap-2 text-xs text-white/60"><Calendar size={14} className="shrink-0" /><time dateTime={match.match_date}>{new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'sk-SK', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(match.match_date))}</time></p>
                        <p className="flex items-center gap-2 text-xs text-white/60"><MapPin size={14} className="shrink-0" />{arena ? `${arena.name} · ${arena.city}` : t('Aréna', 'Arena')}</p>
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-300"><Check size={14} />{t('Potvrdené', 'Confirmed')}</span>
                      </li>
                    })}
                  </ul> : <div className="mt-8 flex min-h-[210px] flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.015] text-center"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#ccff00]/10 text-[#ccff00]"><Swords size={22} /></div><p className="mt-4 text-sm font-semibold text-white/75">Zatiaľ žiadne naplánované zápasy</p><p className="mt-2 max-w-xs text-xs leading-relaxed text-white/35">Prijmi výzvu od hráča alebo vytvor nový zápas.</p><button type="button" onClick={() => setActiveTab('opponents')} className="mt-5 rounded-lg bg-[#ccff00] px-4 py-2.5 text-xs font-black text-[#10150d] hover:bg-[#d9ff4d]">{t('Nájsť hráčov')}</button></div>}
              </section>
              <section id="recent-matches" className="rounded-2xl border border-white/[0.08] bg-[#111722] p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">{t('Prehľad', 'Activity overview')}</p><h2 className="mt-2 text-xl font-bold">{t('Nedávne zápasy', 'Recent matches')}</h2></div>
                  <button type="button" onClick={() => setActiveTab('matches')} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white/35 hover:bg-white/5 hover:text-white" aria-label={t('Zobraziť všetky zápasy', 'View all matches')} title={t('Zobraziť všetky zápasy', 'View all matches')}><ChevronRight size={18} /></button>
                </div>
                {profileMatchesLoading ? <p role="status" className="py-10 text-sm text-white/45">{t('Načítavam zápasy…', 'Loading matches…')}</p>
                  : profileMatchesError ? <p role="alert" className="py-6 text-sm text-red-300">{getErrorMessage(profileMatchesError, t('Históriu zápasov sa nepodarilo načítať.', 'Could not load match history.'))}</p>
                  : profileMatches.length ? <ul className="mt-6 divide-y divide-white/10">
                    {profileMatches.slice(0, 3).map((match) => <li key={match.id} className="py-1 first:pt-0">
                      <button type="button" onClick={() => setDetailMatchId(match.id)} aria-label={t(`Detail zápasu proti ${match.opponent_name}`, `Match details vs ${match.opponent_name}`)} className="group -mx-2 block w-[calc(100%+1rem)] rounded-lg px-2 py-3 text-left transition-colors hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ccff00]">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 break-words text-sm font-bold">{match.opponent_name}</p>
                        <span className="flex shrink-0 items-center gap-1.5"><span className={`rounded-md px-2 py-1 text-[10px] font-bold ${match.result === 'win' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-red-400/10 text-red-300'}`}>{match.result === 'win' ? t('Výhra', 'Win') : t('Prehra', 'Loss')}</span><ChevronRight size={15} aria-hidden="true" className="text-white/25 transition-colors group-hover:text-[#ccff00]" /></span>
                      </div>
                      <time dateTime={match.match_date} className="mt-2 block text-xs text-white/45">{new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'sk-SK', { dateStyle: 'medium' }).format(new Date(match.match_date))}</time>
                      <p className="mt-2 text-xs text-white/65">{t('Sety', 'Sets')}: <span className="font-bold text-white">{match.sets_won} : {match.sets_lost}</span><span className="mx-2 text-white/25">·</span>{t('Gemy', 'Games')}: {match.games_won} : {match.games_lost}</p>
                      {match.status === 'rejected' || match.status === 'disputed' ? <p className="mt-1 text-[10px] font-semibold text-amber-300">{t('Výsledok je sporný', 'Result disputed')}</p> : null}
                      </button>
                    </li>)}
                  </ul> : <div className="mt-8 flex min-h-[210px] flex-col items-center justify-center text-center"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.05] text-white/30"><Trophy size={21} /></div><p className="mt-4 text-sm font-semibold text-white/65">Zatiaľ bez zápasov</p><p className="mt-2 text-xs text-white/30">Tvoja história zápasov sa zobrazí tu.</p></div>}
              </section>
            </div>
            </>}
          </div>
        </section>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-white/[0.08] bg-[#111722]/95 pb-[max(env(safe-area-inset-bottom),0.5rem)] backdrop-blur md:hidden" aria-label="Mobilná navigácia">
        <ul className="grid grid-cols-5 items-stretch px-2">
          {bottomNavItems.map(({ label, short, tab, href, icon: Icon }) => {
            const active = activeTab === tab
            return (
              <li key={tab} className="min-w-0 flex-1">
                <Link href={href} scroll={false} onClick={() => { setMenuOpen(false); setActiveTab(tab); window.scrollTo({ top: 0, behavior: 'instant' }) }} aria-current={active ? 'page' : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-1 px-0.5 text-[9px] font-bold transition-colors ${active ? 'text-[#ccff00]' : 'text-white/45 active:text-white/80'}`}>
                  <span className={`relative flex h-7 w-10 items-center justify-center rounded-full transition-colors ${active ? 'bg-[#ccff00]/15' : ''}`}><Icon size={20} strokeWidth={active ? 2.5 : 1.8} />{tab === 'matches' && pendingMatchApprovalCount > 0 ? <span aria-label={t(`${pendingMatchApprovalCount} zápasov čaká na potvrdenie`, `${pendingMatchApprovalCount} matches awaiting confirmation`)} className="absolute -top-1 right-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-black text-white">{pendingMatchApprovalCount > 9 ? '9+' : pendingMatchApprovalCount}</span> : null}{tab === 'messages' && unreadCommunicationCount > 0 ? <span aria-label={t(`${unreadCommunicationCount} neprečítaných`, `${unreadCommunicationCount} unread`)} className="absolute -top-1 right-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-black text-white">{unreadCommunicationCount > 9 ? '9+' : unreadCommunicationCount}</span> : null}</span>
                  <span className="max-w-full truncate leading-tight">{t(short, label)}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      {detailMatchId ? <MatchDetailModal matchId={detailMatchId} currentProfileId={player.profile_id} onClose={() => setDetailMatchId(null)} /> : null}
    </main>
  )
}

const DELETE_CONFIRMATION_WORD = 'VYMAZAŤ'

function DeleteAccountModal({ onClose }: { onClose: () => void }) {
  const [confirmation, setConfirmation] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirmed = confirmation.trim().toLocaleUpperCase('sk') === DELETE_CONFIRMATION_WORD

  const handleDelete = async () => {
    if (!confirmed || deleting) return
    setDeleting(true)
    setError(null)
    try {
      await deleteMyAccount()
      window.location.replace('/auth/login')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Účet sa nepodarilo vymazať. Skús to znova.')
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => { if (!deleting) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="delete-account-title" className="w-full max-w-md rounded-2xl border border-red-400/30 bg-[#131924] p-6" onClick={(event) => event.stopPropagation()}>
        <h2 id="delete-account-title" className="text-xl font-black text-red-100">Vymazať účet a dáta?</h2>
        <p className="mt-3 text-sm leading-6 text-white/55">Táto akcia je trvalá a nedá sa vrátiť späť. Vymažeme tvoj profil, prihlasovacie údaje, profilovú fotku, správy, priateľstvá, notifikácie, dvojice a výzvy. Nepotvrdené zápasy sa zrušia.</p>
        <p className="mt-2 text-sm leading-6 text-white/55">Odohrané potvrdené zápasy zostanú ostatným hráčom v histórii, ty v nich budeš zobrazený ako „Vymazaný hráč“.</p>
        <label className="mt-5 grid gap-2 text-sm font-bold text-white/60">
          <span>Pre potvrdenie napíš <span className="text-red-200">{DELETE_CONFIRMATION_WORD}</span></span>
          <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={deleting} autoFocus autoComplete="off" className="h-11 w-full rounded-lg border border-white/10 bg-[#0b0f17] px-4 text-base text-white outline-none focus:border-red-400" />
        </label>
        {error ? <p role="alert" className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={deleting} className="rounded-lg border border-white/10 px-4 py-2.5 text-xs font-bold disabled:opacity-50">Zrušiť</button>
          <button type="button" onClick={handleDelete} disabled={!confirmed || deleting} className="rounded-lg bg-red-500/20 px-4 py-2.5 text-xs font-black text-red-200 disabled:cursor-not-allowed disabled:opacity-50">{deleting ? 'Mažem účet…' : 'Natrvalo vymazať účet'}</button>
        </div>
      </div>
    </div>
  )
}

const SettingsView = memo(function SettingsView({ language, setLanguage, t, onSaveEmail, settings, setSettings, section, setSection, arenas, toast, setToast, deleteModalOpen, setDeleteModalOpen }: { language: 'sk' | 'en'; setLanguage: (language: 'sk' | 'en') => void; t: (sk: string, en?: string) => string; onSaveEmail: (email: string) => void; settings: ProfileSettings; setSettings: React.Dispatch<React.SetStateAction<ProfileSettings>>; section: string; setSection: (value: string) => void; arenas: Arena[]; toast: boolean; setToast: (value: boolean) => void; deleteModalOpen: boolean; setDeleteModalOpen: (value: boolean) => void }) {
  const update = (key: string, value: unknown) => setSettings((current) => ({ ...current, [key]: value }))
  const toggleSlot = (slot: string) => update('preferredTimeSlots', settings.preferredTimeSlots.includes(slot) ? settings.preferredTimeSlots.filter((item) => item !== slot) : slot === 'any_day' ? ['any_day'] : [...settings.preferredTimeSlots.filter((item) => item !== 'any_day'), slot])
  const save = async () => {
    if (!settings.email) {
      window.alert(t('Profil sa ešte načítava, skús to o chvíľu.', 'Your profile is still loading, please try again in a moment.'))
      return
    }
    try {
      await updatePlayerProfile(settings.email, { full_name: settings.displayName, email: settings.email, phone: settings.phone, region: settings.region, level: settings.level, bio: settings.bio, phone_visibility: settings.showPhone, dominant_hand: settings.dominantHand, home_venue_id: settings.homeArenaId || null })
      const preferences: PlayerPreferences = { preferredSide: settings.preferredSide, racketBrand: settings.racketBrand, emailChallenges: settings.emailChallenges, emailMatchApproval: settings.emailMatchApproval, emailMessages: settings.emailMessages, emailTournaments: settings.emailTournaments, pushAlerts: settings.pushAlerts, rankingAlerts: settings.rankingAlerts, publicStats: settings.publicStats, allowDirectMessages: settings.allowDirectMessages, preferredTimeSlots: settings.preferredTimeSlots }
      const saved = await updatePlayerPreferences(settings.email, preferences)
      setSettings((current) => ({ ...current, ...saved }))
    } catch (error: unknown) {
      const message = getErrorMessage(error, t('Nastavenia sa nepodarilo uložiť.', 'Settings could not be saved.'))
      console.error('Uloženie nastavení zlyhalo:', message)
      window.alert(message)
      return
    }
    onSaveEmail(settings.email)
    setToast(true)
    window.setTimeout(() => setToast(false), 2800)
  }
  const nav = [{ id: 'profile', label: 'Hráčsky profil & údaje', icon: UserCog }, { id: 'notifications', label: 'Notifikácie & upozornenia', icon: Bell }, { id: 'privacy', label: 'Súkromie & viditeľnosť', icon: Eye }, { id: 'security', label: 'Zabezpečenie & účet', icon: Lock }]
  const Toggle = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) => <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-4 rounded-xl border border-white/[0.07] bg-[#0b0f17]/60 px-4 py-3 text-left"><span className="text-sm text-white/75">{label}</span><span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-[#ccff00]' : 'bg-white/15'}`}><span className={`absolute top-1 h-4 w-4 rounded-full transition-transform ${checked ? 'translate-x-6 bg-[#10150d]' : 'translate-x-1 bg-white/70'}`} /></span></button>
  const field = (label: string, key: string, type = 'text') => key === 'displayName' ? <><label className="grid gap-2 text-xs font-bold text-white/55">{t(label)}<input type={type} value={settings.displayName} onChange={(event) => update(key, event.target.value)} className="rounded-lg border border-white/10 bg-[#0b0f17] px-3 py-2.5 text-sm text-white outline-none focus:border-[#ccff00]" /></label><label className="grid gap-2 text-xs font-bold text-white/55">{t('Kraj')}<select value={settings.region} onChange={(event) => update('region', event.target.value)} className="rounded-lg border border-white/10 bg-[#0b0f17] px-3 py-2.5 text-sm text-white">{['Bratislavský kraj', 'Trnavský kraj', 'Trenčiansky kraj', 'Nitriansky kraj', 'Žilinský kraj', 'Banskobystrický kraj', 'Prešovský kraj', 'Košický kraj'].map((region) => <option key={region}>{region}</option>)}</select></label><label className="grid gap-2 text-xs font-bold text-white/55">{t('Úroveň')}<select value={settings.level} onChange={(event) => update('level', event.target.value)} className="rounded-lg border border-white/10 bg-[#0b0f17] px-3 py-2.5 text-sm text-white">{['Začiatočník', 'Mierne pokročilý', 'Pokročilý', 'Expert'].map((level) => <option key={level}>{level}</option>)}</select></label></> : <label className="grid gap-2 text-xs font-bold text-white/55">{t(label)}<input type={type} readOnly={key === 'email'} value={(settings as unknown as Record<string, string>)[key] ?? ''} onChange={(event) => update(key, event.target.value)} className="rounded-lg border border-white/10 bg-[#0b0f17] px-3 py-2.5 text-sm text-white outline-none focus:border-[#ccff00] read-only:opacity-70" /></label>
  return <div className="mx-auto max-w-[1120px]"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="text-xs font-bold uppercase tracking-[0.22em] text-[#ccff00]">RIVA /</p><h1 className="mt-2 text-2xl font-black md:text-3xl">{t('Nastavenia', 'Settings')}</h1><p className="mt-2 text-sm text-white/45">{t('Spravuj svoj profil, súkromie a herné preferencie.', 'Manage your profile, privacy, and game preferences.')}</p></div><button type="button" onClick={save} className="inline-flex items-center gap-2 rounded-lg bg-[#ccff00] px-4 py-3 text-xs font-black text-[#10150d]"><Save size={15} /> {t('Uložiť zmeny', 'Save changes')}</button></div><div className="mt-6 rounded-xl border border-white/[0.08] bg-[#0b0f17]/60 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-sm font-black">{t('Jazyk', 'Language')}</h2><p className="mt-1 text-xs text-white/45">{t('Vyber si jazyk, ktorý sa použije v celej aplikácii.', 'Choose the language used throughout the application.')}</p></div><div className="flex items-center gap-2" role="group" aria-label={t('Jazyk', 'Language')}><button type="button" onClick={() => setLanguage('sk')} aria-label="Slovenčina" aria-pressed={language === 'sk'} className={`flex h-11 w-14 items-center justify-center rounded-lg border overflow-hidden p-1.5 transition-colors ${language === 'sk' ? 'border-[#ccff00] bg-[#ccff00]/15 ring-2 ring-[#ccff00]/30' : 'border-white/10 bg-[#131924] opacity-60 hover:opacity-100'}`}><img src="/images/flags/sk.svg" alt="" className="h-full w-full rounded-sm object-cover" /></button><button type="button" onClick={() => setLanguage('en')} aria-label="English" aria-pressed={language === 'en'} className={`flex h-11 w-14 items-center justify-center rounded-lg border overflow-hidden p-1.5 transition-colors ${language === 'en' ? 'border-[#ccff00] bg-[#ccff00]/15 ring-2 ring-[#ccff00]/30' : 'border-white/10 bg-[#131924] opacity-60 hover:opacity-100'}`}><img src="/images/flags/gb.svg" alt="" className="h-full w-full rounded-sm object-cover" /></button></div></div></div><div className="mt-8 grid gap-6 lg:grid-cols-[260px_1fr]"><aside className="space-y-1">{nav.map(({ id, label, icon: Icon }) => <button type="button" key={id} onClick={() => setSection(id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-bold ${section === id ? 'bg-[#ccff00]/10 text-[#ccff00]' : 'text-white/50 hover:bg-white/5 hover:text-white'}`}><Icon size={17} /> {t(label, ({ 'Hráčsky profil & údaje': 'Player profile & details', 'Notifikácie & upozornenia': 'Notifications & alerts', 'Súkromie & viditeľnosť': 'Privacy & visibility', 'Kluby & dostupnosť': 'Clubs & availability', 'Zabezpečenie & účet': 'Security & account' } as Record<string, string>)[label] ?? label)}</button>)}</aside><main className="rounded-2xl border border-white/[0.08] bg-[#131924] p-5 sm:p-8">{section === 'profile' ? <div><h2 className="text-xl font-black">Hráčsky profil & údaje</h2><p className="mt-1 text-sm text-white/40">{t('Tieto údaje sa zobrazia súperom v RIVA Padel.', 'These details are visible to opponents in RIVA Padel.')}</p><div className="mt-6 grid gap-4 sm:grid-cols-2">{field('Zobrazované meno', 'displayName')}{field('E-mail', 'email', 'email')}{field('Telefónne číslo', 'phone', 'tel')}</div><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-xs font-bold text-white/55">Dominantná ruka<select value={settings.dominantHand} onChange={(event) => update('dominantHand', event.target.value)} className="rounded-lg border border-white/10 bg-[#0b0f17] px-3 py-2.5 text-sm text-white"><option value="right">Pravák</option><option value="left">Ľavák</option></select></label></div><label className="mt-4 grid gap-2 text-xs font-bold text-white/55">Krátky profilový popis / Bio<textarea value={settings.bio} onChange={(event) => update('bio', event.target.value)} className="min-h-28 rounded-lg border border-white/10 bg-[#0b0f17] px-3 py-3 text-sm text-white outline-none focus:border-[#ccff00]" /></label></div> : section === 'notifications' ? <div><h2 className="text-xl font-black">Notifikácie & upozornenia</h2><div className="mt-6 grid gap-3"><Toggle label="Nová prijatá výzva od hráča" checked={settings.emailChallenges} onChange={(value) => update('emailChallenges', value)} /><Toggle label="Nová súkromná správa v čate" checked={settings.emailMessages} onChange={(value) => update('emailMessages', value)} /><Toggle label="Pozvánky na turnaje a ligové novinky" checked={settings.emailTournaments} onChange={(value) => update('emailTournaments', value)} /></div></div> : section === 'privacy' ? <div><h2 className="text-xl font-black">Súkromie & viditeľnosť</h2><div className="mt-6 grid gap-4"><label className="grid gap-2 text-xs font-bold text-white/55">Telefónne číslo súperom<select value={settings.showPhone} onChange={(event) => update('showPhone', event.target.value)} className="rounded-lg border border-white/10 bg-[#0b0f17] px-3 py-2.5 text-sm text-white"><option value="everyone">Zobraziť všetkým</option><option value="accepted_only">Len po prijatí výzvy</option><option value="never">Nikdy</option></select></label></div></div> : <div><h2 className="text-xl font-black">Zabezpečenie & účet</h2><div className="mt-6 grid max-w-xl gap-5">{([['Aktuálne heslo', 'Current password', 'currentPassword', 'current-password'], ['Nové heslo', 'New password', 'newPassword', 'new-password'], ['Potvrdenie nového hesla', 'Confirm new password', 'confirmPassword', 'new-password']] as const).map(([sk, en, key, autoComplete]) => <label key={key} className="grid gap-2 text-sm font-bold text-white/60">{t(sk, en)}<input type="password" autoComplete={autoComplete} value={(settings as unknown as Record<string, string>)[key] ?? ''} onChange={(event) => update(key, event.target.value)} className="h-12 w-full rounded-lg border border-white/10 bg-[#0b0f17] px-4 text-base text-white outline-none focus:border-[#ccff00]" /></label>)}</div><button type="button" onClick={save} className="mt-5 rounded-lg border border-white/10 px-4 py-2.5 text-xs font-bold text-white/70">Zmeniť heslo</button><div className="mt-10 rounded-xl border border-red-400/25 bg-red-500/[0.04] p-5"><h3 className="font-black text-red-200">Červená zóna</h3><p className="mt-2 text-sm text-white/45">Trvalé vymazanie účtu a všetkých tvojich dát. Táto akcia sa nedá vrátiť späť.</p><div className="mt-4 flex flex-wrap gap-3"><button type="button" onClick={() => setDeleteModalOpen(true)} className="rounded-lg bg-red-500/15 px-3 py-2 text-xs font-black text-red-200">Vymazať účet a dáta</button></div></div></div>}</main></div>{toast ? <div role="status" className="fixed bottom-6 right-6 z-50 rounded-xl border border-[#ccff00]/30 bg-[#131924] px-4 py-3 text-sm font-bold text-[#ccff00]">Nastavenia boli úspešne uložené</div> : null}{deleteModalOpen ? <DeleteAccountModal onClose={() => setDeleteModalOpen(false)} /> : null}</div>
})

const OpponentsView = memo(function OpponentsView({ player, players, onBack, onChallenge, onMessage }: { player: Player; players: OpponentPlayer[]; onBack: () => void; onChallenge: (player: OpponentPlayer) => void; onMessage: (player: OpponentPlayer) => void }) {
  const [region, setRegion] = useState(player.region || 'Celé Slovensko')
  const [level, setLevel] = useState('Všetky úrovne')
  const [availability, setAvailability] = useState('Všetky dostupnosti')
  const [search, setSearch] = useState('')
  const visiblePlayers = players.filter((opponent) => opponent.player_id !== player.player_id && (region === 'Celé Slovensko' || opponent.region === region) && (level === 'Všetky úrovne' || opponent.level === level) && (availability === 'Všetky dostupnosti' || opponent.availability === availability) && opponent.username.toLowerCase().includes(search.toLowerCase()))
  const selectClass = 'rounded-lg border border-white/10 bg-[#0b0f17] px-3 py-2.5 text-sm text-white outline-none focus:border-[#ccff00]'
  return <div id="opponents" className="mx-auto max-w-[1120px]"><button type="button" onClick={onBack} className="text-sm font-bold text-white/45 hover:text-[#ccff00]">← Späť na prehľad</button><p className="mt-8 text-xs font-bold uppercase tracking-[0.22em] text-[#ccff00]">RIVA /</p><h1 className="mt-2 text-3xl font-black">Nájsť súperov</h1><p className="mt-2 text-sm text-white/45">Nájdi dostupných hráčov vo tvojom kraji na ligový alebo priateľský zápas.</p><div className="mt-8 grid gap-3 md:grid-cols-4"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Hľadať hráča..." aria-label="Hľadať hráča" className={`${selectClass} md:col-span-1`} /><select value={region} onChange={(event) => setRegion(event.target.value)} aria-label="Kraj" className={selectClass}><option>Celé Slovensko</option><option>Žilinský kraj</option><option>Bratislavský kraj</option><option>Trnavský kraj</option><option>Nitriansky kraj</option><option>Banskobystrický kraj</option><option>Košický kraj</option><option>Prešovský kraj</option><option>Trenčiansky kraj</option></select><select value={level} onChange={(event) => setLevel(event.target.value)} aria-label="Úroveň" className={selectClass}><option>Všetky úrovne</option><option>Začiatočník</option><option>Mierne pokročilý</option><option>Pokročilý</option><option>Profesionál</option></select><select value={availability} onChange={(event) => setAvailability(event.target.value)} aria-label="Dostupnosť" className={selectClass}><option>Všetky dostupnosti</option><option>Pracovné dni</option><option>Víkendy</option><option>Večer</option></select></div>{visiblePlayers.length === 0 ? <div className="mt-6 rounded-2xl border border-white/10 bg-[#131924] p-10 text-center"><UserPlus className="mx-auto text-[#ccff00]" size={32} /><h2 className="mt-4 text-xl font-black">Zatiaľ tu nie sú dostupní súperi</h2><p className="mt-2 text-sm text-white/45">Keď sa zaregistrujú hráči v tomto kraji, zobrazia sa tu automaticky.</p></div> : <div className="mt-6 grid gap-4 md:grid-cols-2">{visiblePlayers.map((opponent) => <article key={opponent.player_id} className="rounded-2xl border border-white/10 bg-[#131924] p-5"><div className="flex items-start gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#ccff00] font-black text-[#10150d]">{opponent.username.slice(0, 2)}</div><div className="min-w-0 flex-1"><h2 className="truncate font-black">{opponent.username}</h2><p className="text-xs text-white/45">{opponent.region} · {opponent.elo} ELO</p></div></div><div className="mt-4 flex flex-wrap gap-2 text-xs text-white/55"><span className="rounded-full border border-white/10 px-2.5 py-1">{opponent.level}</span><span className="rounded-full border border-white/10 px-2.5 py-1">{opponent.homeArena}</span><span className="rounded-full border border-[#ccff00]/20 px-2.5 py-1 text-[#ccff00]">Dostupný: {opponent.availability}</span></div><div className="mt-5 flex gap-2"><button type="button" onClick={() => onChallenge(opponent)} className="flex-1 rounded-lg bg-[#ccff00] px-3 py-2.5 text-xs font-black text-[#10150d]">Vyzvať na zápas</button><button type="button" onClick={() => onMessage(opponent)} className="rounded-lg border border-white/10 px-3 py-2.5 text-xs font-bold text-white/65 hover:border-[#ccff00]/40 hover:text-white">Správa</button></div></article>)}</div>}</div>
})

const MessagesView = memo(function MessagesView({ category, setCategory, notifications, pairInvitations, pairInvitationsError, onMarkRead, myProfileId, activeFriendId, setActiveFriendId, onChallenge }: { category: 'direct' | 'notifications'; setCategory: (category: 'direct' | 'notifications') => void; notifications: LeagueNotification[]; pairInvitations: PairInvitation[]; pairInvitationsError?: unknown; onMarkRead: (id: string) => void; myProfileId: number | null; activeFriendId: string | null; setActiveFriendId: (id: string | null) => void; onChallenge: (friend: { id: string; name: string }) => void }) {
  const { language, t } = useLanguage()
  const { mutate: mutateCache } = useSWRConfig()
  const [respondingChallengeId, setRespondingChallengeId] = useState<string | null>(null)
  const [challengeResponseError, setChallengeResponseError] = useState<{ id: string; message: string } | null>(null)
  const [respondingInvitationId, setRespondingInvitationId] = useState<string | null>(null)
  const [pairInvitationError, setPairInvitationError] = useState('')
  const dateFormatter = { format: (date: Date) => Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'sk-SK', { day: 'numeric', month: 'short', year: 'numeric' }).format(date) }
  useEffect(() => {
    if (category !== 'notifications') return
    document.querySelector('#messages li[role="button"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [category, notifications])

  async function answerPairChallenge(notification: LeagueNotification, accept: boolean) {
    if (!notification.challenge_id) {
      setChallengeResponseError({ id: notification.id, message: 'Notifikácii chýba ID výzvy. Obnov stránku alebo požiadaj o novú notifikáciu.' })
      return
    }

    if (myProfileId === null) {
      setChallengeResponseError({ id: notification.id, message: 'Profil sa ešte načítava. Skús to znova o chvíľu.' })
      return
    }

    setRespondingChallengeId(notification.challenge_id)
    setChallengeResponseError(null)
    try {
      if (accept) {
        const { data, error } = await createClient().rpc('accept_challenge', {
          p_challenge_id: notification.challenge_id,
          p_user_id: myProfileId,
        })
        if (error) {
          console.error('Chyba pri potvrdzovaní výzvy:', error)
          throw error
        }
        console.log(data)
      } else {
        await respondToPairChallenge(notification.challenge_id, false)
      }
      await mutateCache<LeagueNotification[]>(['notifications', myProfileId], (current) => current?.map((item) =>
        item.challenge_id === notification.challenge_id
          ? { ...item, read: true, challengeResponse: accept ? 'confirmed' as const : 'declined' as const }
          : item), { revalidate: false })
      await Promise.all([
        mutateCache(['notifications', myProfileId]),
        mutateCache(['pair-challenges', String(myProfileId)]),
      ])
      window.dispatchEvent(new Event('communications-updated'))
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Na výzvu sa nepodarilo odpovedať.')
      console.error('Odpoveď na výzvu zlyhala:', message)
      setChallengeResponseError({ id: notification.id, message })
    } finally {
      setRespondingChallengeId(null)
    }
  }

  async function answerPairInvitation(invitation: PairInvitation, accept: boolean) {
    if (myProfileId === null || respondingInvitationId !== null) return
    setRespondingInvitationId(invitation.id)
    setPairInvitationError('')
    try {
      await respondToPairInvitation(invitation.id, accept)
      await Promise.all([
        mutateCache(['incoming-pair-invitations', myProfileId]),
        mutateCache('league-pairs'),
      ])
      window.dispatchEvent(new Event('communications-updated'))
    } catch (error: unknown) {
      const message = getErrorMessage(error, t('Na pozvanie do dvojice sa nepodarilo odpovedať.', 'Could not respond to the pair invitation.'))
      console.error('Odpoveď na pozvanie do dvojice zlyhala:', message)
      setPairInvitationError(message)
    } finally {
      setRespondingInvitationId(null)
    }
  }

  return <div id="messages" className="mx-auto max-w-[1120px]">
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#ccff00]">RIVA /</p>
      <h1 className="mt-2 text-3xl font-black">Správy</h1>
      <p className="mt-2 text-sm text-white/45">Komunikuj so spoluhráčmi a súpermi.</p>
    </div>
    <div className="mt-8 flex gap-2 border-b border-white/10 pb-3">
      <button type="button" onClick={() => setCategory('direct')} className={`rounded-lg px-3 py-2 text-xs font-bold ${category === 'direct' ? 'bg-white/10 text-white' : 'text-white/45'}`}>Osobné správy</button>
      <button type="button" onClick={() => setCategory('notifications')} className={`rounded-lg px-3 py-2 text-xs font-bold ${category === 'notifications' ? 'bg-white/10 text-white' : 'text-white/45'}`}>Ligové notifikácie</button>
    </div>
    {category === 'notifications' && pairInvitationsError ? <p role="alert" className="mt-6 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">{getErrorMessage(pairInvitationsError, t('Žiadosti o vytvorenie dvojice sa nepodarilo načítať.', 'Could not load pair invitations.'))}</p> : null}
    {category === 'notifications' && pairInvitationError ? <p role="alert" className="mt-6 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">{pairInvitationError}</p> : null}
    {category === 'notifications' && pairInvitations.length > 0 ? (
      <section className="mt-6 rounded-2xl border border-[#ccff00]/40 bg-[#161f30] p-4 shadow-[0_0_24px_rgba(204,255,0,0.12)]">
        <h2 className="flex items-center gap-2 text-sm font-black text-[#ccff00]"><Bell size={16} />{t('Žiadosti o vytvorenie dvojice', 'Pair invitations')}</h2>
        <ul className="mt-3 space-y-3">
          {pairInvitations.map((invitation) => {
            const isResponding = respondingInvitationId === invitation.id
            return <li key={invitation.id} className="rounded-xl border border-white/10 bg-[#0b0f17] p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm font-bold">{t(`${invitation.inviterName} ťa pozýva vytvoriť dvojicu.`, `${invitation.inviterName} invited you to create a pair.`)}</p>
                <time dateTime={invitation.createdAt} className="shrink-0 text-xs text-white/40">{dateFormatter.format(new Date(invitation.createdAt))}</time>
              </div>
              <div className="mt-4 flex gap-2">
                <button type="button" disabled={myProfileId === null || isResponding} onClick={() => void answerPairInvitation(invitation, true)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#ccff00] px-3 py-2 text-xs font-black text-[#10150d] disabled:cursor-wait disabled:opacity-50"><Check size={14} />{isResponding ? t('Spracúvam…', 'Processing…') : t('Prijať')}</button>
                <button type="button" disabled={myProfileId === null || isResponding} onClick={() => void answerPairInvitation(invitation, false)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white/70 disabled:cursor-wait disabled:opacity-50"><X size={14} />{t('Odmietnuť')}</button>
              </div>
            </li>
          })}
        </ul>
      </section>
    ) : null}
    {category === 'notifications' ? notifications.length === 0 && pairInvitations.length === 0 ? (
      <div className="mt-6 rounded-2xl border border-white/10 bg-[#131924] p-6">
        <div className="flex min-h-[260px] flex-col items-center justify-center text-center">
          <Bell className="text-[#ccff00]" size={36} />
          <h2 className="mt-4 text-xl font-black">{t('Zatiaľ nemáš žiadne ligové notifikácie', 'No league notifications yet')}</h2>
          <p className="mt-2 text-sm text-white/45">{t('Keď ti niekto pošle výzvu alebo správu, zobrazí sa tu.', 'When someone sends you a challenge or a message, it will appear here.')}</p>
        </div>
      </div>
    ) : (
      <ul className="mt-6 flex flex-col gap-3">
        {notifications.map((notification) => {
          const isChallengeNotification = ['challenge_request', 'pair_challenge', 'challenge'].includes(notification.type) || Boolean(notification.challenge_id)
          const isPairChallenge = isChallengeNotification && Boolean(notification.challenge_id)
          const isResponding = respondingChallengeId === notification.challenge_id
          const actionTaken = notification.challengeResponse
          return <li
            key={notification.id}
            role={!notification.read && !isChallengeNotification ? 'button' : undefined}
            tabIndex={!notification.read && !isChallengeNotification ? 0 : undefined}
            onClick={() => { if (!notification.read && !isChallengeNotification) onMarkRead(notification.id) }}
            onKeyDown={(event) => { if (!notification.read && !isChallengeNotification && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onMarkRead(notification.id) } }}
            className={`rounded-xl border p-4 ${notification.read ? 'border-white/10 bg-[#131924] text-white/70' : 'border-[#ccff00]/40 bg-[#161f30] text-white'}`}
          >
            <div className="flex items-start justify-between gap-4">
              <h3 className="font-semibold">{notification.title}</h3>
              <time dateTime={notification.createdAt} className="shrink-0 text-xs text-white/40">{dateFormatter.format(new Date(notification.createdAt))}</time>
            </div>
            {notification.body ? <p className="mt-1 text-sm leading-relaxed text-white/50">{notification.body}</p> : null}
            {isChallengeNotification && !notification.challenge_id ? <p role="alert" className="mt-3 text-xs text-amber-300">Notifikácii chýba ID výzvy, preto na ňu nemožno odpovedať.</p> : null}
            {isPairChallenge && (actionTaken === 'confirmed' || actionTaken === 'declined') ? <p role="status" className={`mt-4 inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-bold ${actionTaken === 'confirmed' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-red-400/10 text-red-300'}`}>
              {actionTaken === 'confirmed' ? <Check size={14} /> : <X size={14} />}
              {actionTaken === 'confirmed' ? t('Potvrdené', 'Confirmed') : t('Odmietnuté', 'Declined')}
            </p> : isPairChallenge && actionTaken === 'pending' ? <div className="relative z-10 mt-4 flex gap-2">
              <button type="button" disabled={myProfileId === null || isResponding} onClick={(event) => { event.stopPropagation(); void answerPairChallenge(notification, true) }} className="inline-flex items-center gap-1.5 rounded-lg bg-[#ccff00] px-3 py-2 text-xs font-black text-[#10150d] disabled:cursor-wait disabled:opacity-50"><Check size={14} />{isResponding ? 'Spracúvam…' : 'Potvrdiť účasť'}</button>
              <button type="button" disabled={myProfileId === null || isResponding} onClick={(event) => { event.stopPropagation(); void answerPairChallenge(notification, false) }} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white/70 disabled:cursor-wait disabled:opacity-50"><X size={14} />Odmietnuť</button>
            </div> : null}
            {isPairChallenge && actionTaken === 'cancelled' ? <p role="status" className="mt-3 text-xs text-white/50">{t('Výzva bola zrušená.', 'Challenge cancelled.')}</p> : null}
            {isPairChallenge && actionTaken === 'unavailable' ? <p role="status" className="mt-3 text-xs text-amber-300">{t('Výzva nie je dostupná na potvrdenie.', 'Challenge is not available for confirmation.')}</p> : null}
            {challengeResponseError?.id === notification.id ? <p role="alert" className="mt-3 text-xs text-red-300">{challengeResponseError.message}</p> : null}
          </li>
        })}
      </ul>
    ) : <FriendsChat myProfileId={myProfileId} activeFriendId={activeFriendId} setActiveFriendId={setActiveFriendId} onChallenge={onChallenge} />}
  </div>
})


const MatchesView = memo(function MatchesView({ initialArena, modalOpen, setModalOpen, onMatchSaved, onOpenMatch }: { matches: MatchRecord[]; setMatches: React.Dispatch<React.SetStateAction<MatchRecord[]>>; initialArena: string; modalOpen: boolean; setModalOpen: (open: boolean) => void; onMatchSaved: () => Promise<ProfileMatch[] | undefined>; onOpenMatch: (matchId: string) => void }) {
  const { language } = useLanguage()
  const { mutate: mutateCache } = useSWRConfig()
  const approvingMatches = useRef(new Set<string>())
  const [currentProfileId, setCurrentProfileId] = useState<number | null>(null)
  const [respondingId, setRespondingId] = useState<string | null>(null)
  const [respondedMatches, setRespondedMatches] = useState<Record<string, 'confirmed' | 'rejected' | 'pending'>>({})
  const onMatchSavedRef = useRef(onMatchSaved)
  onMatchSavedRef.current = onMatchSaved
  const [resultError, setResultError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({ date: new Date().toISOString().slice(0, 10), arena: initialArena, set1a: '', set1b: '', set2a: '', set2b: '', set3a: '', set3b: '' })
  const [team1Player1, setTeam1Player1] = useState<MatchPlayerSlot>(EMPTY_PLAYER_SLOT)
  const [team1Player2, setTeam1Player2] = useState<MatchPlayerSlot>(EMPTY_PLAYER_SLOT)
  const [team2Player1, setTeam2Player1] = useState<MatchPlayerSlot>(EMPTY_PLAYER_SLOT)
  const [team2Player2, setTeam2Player2] = useState<MatchPlayerSlot>(EMPTY_PLAYER_SLOT)
  const playerSlots = useMemo<MatchPlayerSlots>(() => ({ team1Player1, team1Player2, team2Player1, team2Player2 }), [team1Player1, team1Player2, team2Player1, team2Player2])
  const setPlayerSlot = useCallback((field: MatchPlayerField, slot: MatchPlayerSlot) => {
    const setters = { team1Player1: setTeam1Player1, team1Player2: setTeam1Player2, team2Player1: setTeam2Player1, team2Player2: setTeam2Player2 }
    setters[field](slot)
  }, [])
  const { data: results = [], isLoading, error: resultsError, mutate: mutateResults } = useSWR(currentProfileId !== null ? ['participant-matches', currentProfileId] : null, ([, id]) => fetchParticipantMatches(id), { refreshInterval: 15000 })

  useEffect(() => {
    let active = true
    const supabase = createClient()
    const refreshIdentity = async () => {
      const { data, error } = await supabase.auth.getUser()
      if (error) throw error
      const profile = data.user?.email ? await fetchPlayerProfile(data.user.email) : null
      if (active) setCurrentProfileId(profile?.id ?? null)
    }
    void refreshIdentity().catch((error: unknown) => { if (active) setResultError(getErrorMessage(error, 'Profil sa nepodarilo načítať.')) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (currentProfileId === null) return
    const supabase = createClient()
    const refresh = () => {
      void mutateResults()
      void onMatchSavedRef.current()
      window.dispatchEvent(new Event('proffiles-updated'))
    }
    const channel = supabase.channel(`match-results-${currentProfileId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `player1_id=eq.${currentProfileId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `player2_id=eq.${currentProfileId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `team1_player2_id=eq.${currentProfileId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `team2_player2_id=eq.${currentProfileId}` }, refresh)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'matches' }, refresh)
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [currentProfileId, mutateResults])

 const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (isSaving) return
    setIsSaving(true)
    setResultError('')
    try {
      const { data: { user } } = await createClient().auth.getUser()
      const profile = user?.email ? await fetchPlayerProfile(user.email) : null
      if (!profile) throw new Error('Tvoj profil sa nepodarilo nájsť podľa e-mailu.')
      const profiles = await fetchPlayerProfiles()
      const playerValidation = validateMatchPlayers(playerSlots, profiles)
      if (!playerValidation.isValid) throw new Error(playerValidation.summary || Object.values(playerValidation.errors)[0] || 'Skontroluj výber hráčov.')
      const profileById = new Map(profiles.map((item) => [String(item.id), item]))
      const pickSlot = (field: MatchPlayerField) => {
        const id = playerValidation.resolvedIds[field]
        const selected = id ? profileById.get(id) : undefined
        if (!selected) throw new Error('Každý slot musí mať vybraného registrovaného hráča.')
        return selected
      }
      const pair1Player1 = pickSlot('team1Player1')
      const pair1Player2 = pickSlot('team1Player2')
      const pair2Player1 = pickSlot('team2Player1')
      const pair2Player2 = pickSlot('team2Player2')
      const matchPlayers = [pair1Player1, pair1Player2, pair2Player1, pair2Player2]
      if (new Set(matchPlayers.map((matchPlayer) => matchPlayer.id)).size !== matchPlayers.length) {
        throw new Error('Všetci štyria hráči musia byť rozdielni.')
      }

      const scoreValidation = validateMatchScore(form)
      if (!scoreValidation.isValid) throw new Error(Object.values(scoreValidation.errors)[0])
      const { sets } = scoreValidation
      if (!form.date) return
      const team1SetsWon = sets.filter((set) => set.team1Score > set.team2Score).length
      const team2SetsWon = sets.filter((set) => set.team2Score > set.team1Score).length
      if (team1SetsWon === team2SetsWon) throw new Error('Zápas musí mať víťaznú dvojicu.')

      const matchDate = new Date(`${form.date}T12:00:00`)
      if (Number.isNaN(matchDate.getTime())) throw new Error('Dátum zápasu nie je platný.')
      if (!matchPlayers.some((matchPlayer) => matchPlayer.id === profile.id)) throw new Error('Výsledok môže zadať iba účastník zápasu.')
      await submitMatchResult({
        team1Player1Id: String(pair1Player1.id),
        team1Player2Id: String(pair1Player2.id),
        team2Player1Id: String(pair2Player1.id),
        team2Player2Id: String(pair2Player2.id),
        date: matchDate.toISOString(),
        arena: form.arena,
        sets,
      })
      await mutateResults()
      setModalOpen(false)
      setForm({ date: new Date().toISOString().slice(0, 10), arena: initialArena, set1a: '', set1b: '', set2a: '', set2b: '', set3a: '', set3b: '' })
      MATCH_PLAYER_FIELDS.forEach((field) => setPlayerSlot(field, EMPTY_PLAYER_SLOT))
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Výsledok zápasu sa nepodarilo uložiť.')
      console.error('Uloženie výsledku zápasu zlyhalo:', message)
      window.alert(message)
      setResultError(message)
    } finally {
      setIsSaving(false)
    }
  }
  const update = async (matchId: string, accept: boolean) => {
    if (approvingMatches.current.has(matchId)) return
    approvingMatches.current.add(matchId)
    setRespondingId(matchId)
    setResultError('')
    try {
      const status = await respondToMatchResult(matchId, accept)
      setRespondedMatches((current) => ({ ...current, [matchId]: status }))
      await mutateResults((current) => current?.map((match) => match.id === matchId
        ? {
            ...match,
            status,
            approvedIds: accept && currentProfileId !== null
              ? Array.from(new Set([...match.approvedIds, String(currentProfileId)]))
              : match.approvedIds,
          }
        : match), { revalidate: false })
      await mutateResults().catch((error: unknown) => console.error('Obnovenie zápasov zlyhalo:', error))
      void mutateCache(matchDetailKey(matchId))
      void onMatchSavedRef.current().catch((error: unknown) => console.error('Obnovenie profilu po odpovedi na zápas zlyhalo:', error))
      window.dispatchEvent(new Event('proffiles-updated'))
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Na výsledok sa nepodarilo odpovedať.')
      console.error(`Odpoveď (${accept ? 'potvrdenie' : 'odmietnutie'}) na zápas ${matchId} zlyhala:`, error)
      setResultError(message)
    } finally {
      approvingMatches.current.delete(matchId)
      setRespondingId(null)
    }
  }
  return <div className="mx-auto max-w-[1120px]">
    <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#ccff00]">RIVA /</p>
    <h1 className="mt-2 text-3xl font-black">Výsledky</h1>
    <p className="mt-2 text-sm text-white/45">Spravuj výsledky, schválenia a zápasovú históriu.</p>
    {resultError ? <p role="alert" className="mt-4 text-sm text-red-300">{resultError}</p> : null}
    {isLoading || currentProfileId === null ? <p role="status" className="py-10 text-sm text-white/50">Načítavam zápasy…</p>
      : resultsError ? <p role="alert" className="py-6 text-sm text-red-300">{getErrorMessage(resultsError, 'Zápasy sa nepodarilo načítať.')}</p>
      : !results.length ? <div className="py-12 text-center"><Calendar className="mx-auto text-[#ccff00]" size={38} /><p className="mt-4 text-sm text-white/60">Zatiaľ nemáš zadané výsledky zápasov.</p></div>
      : <ul className="mt-6 space-y-4">{results.map((match) => {
        const localResponse = respondedMatches[match.id]
        const status = match.status === 'pending' && localResponse && localResponse !== 'pending' ? localResponse : match.status
        const me = currentProfileId === null ? null : String(currentProfileId)
        const approvedSet = new Set(match.approvedIds)
        if (me && localResponse === 'pending') approvedSet.add(me)
        const ownApproval = me !== null && approvedSet.has(me)
        const requiredCount = match.participants.length || 4
        const approvedCount = match.participants.length ? match.participants.filter((participant) => approvedSet.has(participant.id)).length : approvedSet.size
        const waitingFor = match.participants.filter((participant) => !approvedSet.has(participant.id))
        return <li key={match.id} onClick={() => onOpenMatch(match.id)} className="group cursor-pointer rounded-lg border border-white/10 bg-[#131924] p-5 transition-colors hover:border-[#ccff00]/30 hover:bg-[#151c29]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><p className="break-words font-bold"><button type="button" onClick={(event) => { event.stopPropagation(); onOpenMatch(match.id) }} className="text-left hover:text-[#ccff00] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ccff00]" aria-label={`Detail zápasu: ${match.team1Name} vs ${match.team2Name}`}>{match.team1Name} <span className="text-white/40">vs</span> {match.team2Name}</button></p><p className="mt-1 text-xs text-white/45">{match.arena} · {new Date(match.date).toLocaleDateString(language === 'en' ? 'en-GB' : 'sk-SK')}</p></div>
            <span className={`rounded-md px-2 py-1 text-xs font-bold ${status === 'confirmed' ? 'bg-emerald-400/10 text-emerald-300' : status === 'rejected' ? 'bg-red-400/10 text-red-300' : ownApproval ? 'bg-amber-400/10 text-amber-200' : 'bg-white/5 text-white/60'}`}>{status === 'pending' ? (ownApproval ? `Čaká sa na ostatných hráčov (${approvedCount}/${requiredCount})` : `Čaká na schválenie (${approvedCount}/${requiredCount})`) : status === 'confirmed' ? 'Potvrdené' : status === 'cancelled' ? 'Zrušené' : 'Odmietnuté'}</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">{match.sets.length ? match.sets.map((set, index) => <span key={index} className="rounded-md border border-white/10 px-3 py-2 text-xs font-bold">Set {index + 1}: {set.team1Score} : {set.team2Score}</span>) : <span className="text-xs text-white/50">Sety: {match.team1SetsWon} : {match.team2SetsWon}</span>}</div>
          {status === 'confirmed' && match.eloDeltaTeam1 !== null && match.eloDeltaTeam2 !== null ? <p className="mt-3 text-xs text-white/65">ELO na hráča: 1. dvojica {match.eloDeltaTeam1 >= 0 ? '+' : ''}{match.eloDeltaTeam1} · 2. dvojica {match.eloDeltaTeam2 >= 0 ? '+' : ''}{match.eloDeltaTeam2}</p> : null}
          {status === 'pending' ? <div className="mt-4 flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
            {ownApproval ? <div className="grid gap-1">
              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-300"><Check size={14} />Výsledok si potvrdil – čaká sa na ostatných hráčov</span>
              {waitingFor.length ? <span className="text-xs text-white/45">Chýba potvrdenie: {waitingFor.map((participant) => participant.name).join(', ')}</span> : null}
              <span className="text-[11px] text-white/35">ELO a štatistiky sa započítajú až po potvrdení všetkými hráčmi.</span>
            </div> : <>
              <button type="button" disabled={respondingId !== null || !currentProfileId} onClick={() => void update(match.id, true)} className="inline-flex items-center gap-1 rounded-lg bg-[#ccff00] px-3 py-2 text-xs font-black text-[#10150d] disabled:opacity-50"><Check size={14} />Potvrdiť</button>
              <button type="button" disabled={respondingId !== null || !currentProfileId} onClick={() => void update(match.id, false)} className="inline-flex items-center gap-1 rounded-lg border border-red-300/20 px-3 py-2 text-xs font-bold text-red-300 disabled:opacity-50"><X size={14} />Odmietnuť</button>
            </>}
            {respondingId === match.id ? <span role="status" className="text-xs text-white/45">Spracúvam…</span> : null}
          </div> : null}
          <p className="mt-4 inline-flex items-center gap-1 text-[11px] font-bold text-white/35 transition-colors group-hover:text-[#ccff00]" aria-hidden="true">Detail zápasu<ChevronRight size={13} /></p>
        </li>
      })}</ul>}
    {modalOpen ? <MatchRecordModal form={form} setForm={setForm} slots={playerSlots} setSlot={setPlayerSlot} submit={submit} onClose={() => { if (!isSaving) setModalOpen(false) }} /> : null}
  </div>
})

const ChallengesView = memo(function ChallengesView({ challenges, setChallengeModalOpen, updateChallenge, challengeModalOpen, challengeForm, setChallengeForm, submitChallenge }: { challenges: Challenge[]; setChallengeModalOpen: (open: boolean) => void; updateChallenge: (id: string, status: Challenge['status']) => void; challengeModalOpen: boolean; challengeForm: { opponentId: string; opponentName: string; arena: string; proposedDate: string; matchType: 'ranked' | 'friendly'; note: string }; setChallengeForm: React.Dispatch<React.SetStateAction<{ opponentId: string; opponentName: string; arena: string; proposedDate: string; matchType: 'ranked' | 'friendly'; note: string }>>; submitChallenge: (event: React.FormEvent) => void }) {
  const [filter, setFilter] = useState<'all' | 'sent' | 'scheduled'>('all')
  const visible = challenges.filter((challenge) => filter === 'all' || filter === 'sent' && challenge.status === 'PENDING' || filter === 'scheduled' && challenge.status === 'ACCEPTED')
  return <div className="mx-auto max-w-[1120px]"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="text-xs font-bold uppercase tracking-[0.22em] text-[#ccff00]">RIVA /</p><h1 className="mt-2 text-3xl font-black">Výzvy</h1><p className="mt-2 text-sm text-white/45">Vyzvi súpera a dohodni si ligový zápas.</p></div><button type="button" onClick={() => setChallengeModalOpen(true)} className="inline-flex items-center gap-2 self-start rounded-lg bg-[#ccff00] px-4 py-3 text-xs font-black text-[#10150d]"><Plus size={16} /> Vytvoriť novú výzvu</button></div><div className="mt-8 flex gap-2 border-b border-white/10 pb-3"><button type="button" onClick={() => setFilter('all')} className={`rounded-lg px-3 py-2 text-xs font-bold ${filter === 'all' ? 'bg-white/10 text-white' : 'text-white/45'}`}>Všetky</button><button type="button" onClick={() => setFilter('sent')} className={`rounded-lg px-3 py-2 text-xs font-bold ${filter === 'sent' ? 'bg-white/10 text-white' : 'text-white/45'}`}>Odoslané výzvy</button><button type="button" onClick={() => setFilter('scheduled')} className={`rounded-lg px-3 py-2 text-xs font-bold ${filter === 'scheduled' ? 'bg-white/10 text-white' : 'text-white/45'}`}>Dohodnuté zápasy</button></div><section className="mt-6 rounded-2xl border border-white/[0.08] bg-[#131924] p-6 sm:p-8">{visible.length === 0 ? <div className="flex min-h-[300px] flex-col items-center justify-center text-center"><Swords className="text-[#ccff00]" size={38} /><h2 className="mt-5 text-xl font-black">Zatiaľ nemáš žiadne aktívne výzvy</h2><p className="mt-3 max-w-md text-sm leading-6 text-white/45">Vyzvi hráča z rebríčka alebo vytvor novú výzvu na odohranie ligového zápasu.</p><button type="button" onClick={() => setChallengeModalOpen(true)} className="mt-6 rounded-lg bg-[#ccff00] px-4 py-3 text-xs font-black text-[#10150d]">Vytvoriť novú výzvu</button></div> : <div className="space-y-3">{visible.map((challenge) => <div key={challenge.id} className="flex flex-col gap-4 rounded-xl border border-white/10 bg-[#0b0f17] p-5 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><p className="font-bold">{challenge.senderName} → {challenge.receiverName}</p><span className="rounded-full bg-[#ccff00]/10 px-2 py-1 text-[10px] font-black text-[#ccff00]">{challenge.status === 'PENDING' ? 'ODOSLANÁ' : challenge.status === 'ACCEPTED' ? 'POTVRDENÁ' : challenge.status}</span></div><p className="mt-2 text-xs text-white/45">{challenge.arena} · {new Date(challenge.proposedDate).toLocaleString('sk-SK')}</p></div>{challenge.status === 'PENDING' ? <button type="button" onClick={() => updateChallenge(challenge.id, 'CANCELLED')} className="inline-flex items-center gap-2 text-xs font-bold text-red-300"><Trash2 size={14} /> Zrušiť výzvu</button> : null}</div>)}</div>}</section>{challengeModalOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><form onSubmit={submitChallenge} className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#131924] p-6"><div className="flex items-center justify-between"><h2 className="text-xl font-black">Vytvoriť výzvu</h2><button type="button" onClick={() => setChallengeModalOpen(false)} className="text-white/45" aria-label="Zavrieť">×</button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-xs font-bold text-white/60">Súper<input required value={challengeForm.opponentName} onChange={(event) => setChallengeForm((current) => ({ ...current, opponentId: event.target.value, opponentName: event.target.value }))} placeholder="Meno hráča" className="rounded-lg border border-white/10 bg-[#0b0f17] px-3 py-2.5 text-sm text-white outline-none focus:border-[#ccff00]" /></label><label className="grid gap-2 text-xs font-bold text-white/60">Preferovaná aréna<select value={challengeForm.arena} onChange={(event) => setChallengeForm((current) => ({ ...current, arena: event.target.value }))} className="rounded-lg border border-white/10 bg-[#0b0f17] px-3 py-2.5 text-sm text-white"><option>Padel Arena Žilina</option><option>Padel Club Martin</option><option>Padel Point Bratislava</option></select></label><label className="grid gap-2 text-xs font-bold text-white/60">Navrhovaný dátum a čas<input required type="datetime-local" value={challengeForm.proposedDate} onChange={(event) => setChallengeForm((current) => ({ ...current, proposedDate: event.target.value }))} className="rounded-lg border border-white/10 bg-[#0b0f17] px-3 py-2.5 text-sm text-white" /></label><label className="grid gap-2 text-xs font-bold text-white/60">Typ zápasu<select value={challengeForm.matchType} onChange={(event) => setChallengeForm((current) => ({ ...current, matchType: event.target.value as 'ranked' | 'friendly' }))} className="rounded-lg border border-white/10 bg-[#0b0f17] px-3 py-2.5 text-sm text-white"><option value="ranked">Ligový ELO zápas</option><option value="friendly">Priateľský zápas</option></select></label><label className="grid gap-2 text-xs font-bold text-white/60 sm:col-span-2">Správa pre súpera<textarea value={challengeForm.note} onChange={(event) => setChallengeForm((current) => ({ ...current, note: event.target.value }))} className="min-h-20 rounded-lg border border-white/10 bg-[#0b0f17] px-3 py-2.5 text-sm text-white" /></label></div><button className="mt-5 w-full rounded-lg bg-[#ccff00] py-3 text-sm font-black text-[#10150d]">Odoslať výzvu</button></form></div> : null}</div>
})

function formatSeason(seasonStart: string | null, language: string) {
  const now = new Date()
  const [year, month] = seasonStart ? seasonStart.split('-').map(Number) : [now.getFullYear(), now.getMonth() < 6 ? 1 : 7]
  const start = new Date(year, month - 1, 1)
  const end = new Date(year, month + 5, 0)
  const format = new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'sk-SK', { day: 'numeric', month: 'numeric', year: 'numeric' })
  return `${format.format(start)} – ${format.format(end)}`
}

const ProfileView = memo(function ProfileView({ player, phone, avatarUrl, avatarInputRef, handleAvatarChange, removeAvatar, matches, profileMatches, profileMatchesLoading, profileMatchesError, matchStats, matchModalOpen, setMatchModalOpen, matchForm, setMatchForm, submitMatch, approveMatch, onOpenMatch }: { onOpenMatch: (matchId: string) => void; player: Player; phone: string; avatarUrl: string | null; avatarInputRef: React.RefObject<HTMLInputElement | null>; handleAvatarChange: (event: React.ChangeEvent<HTMLInputElement>) => void; removeAvatar: () => void; matches: Match[]; profileMatches: ProfileMatch[]; profileMatchesLoading: boolean; profileMatchesError: unknown; matchStats: { total: number; wins: number; losses: number; winRate: number; wonSets: number; lostSets: number; wonGames: number; lostGames: number; elo: number }; matchModalOpen: boolean; setMatchModalOpen: (open: boolean) => void; matchForm: { date: string; arena: string; teammate: string; opponents: string; set1: string; set2: string; set3: string }; setMatchForm: React.Dispatch<React.SetStateAction<{ date: string; arena: string; teammate: string; opponents: string; set1: string; set2: string; set3: string }>>; submitMatch: (event: React.FormEvent) => void; approveMatch: () => void }) {
  const { data: arenas = [] } = useSWR<Arena[]>('arenas', fetchArenas)
  const { data: profile } = useSWR(player.email ? ['profile-bio', player.email] : null, ([, email]) => fetchPlayerProfile(email))
  const { language, t } = useLanguage()
  const effectiveVenueId = player.home_venue_id || player.auto_venue_id
  const homeVenue = arenas.find((arena) => arena.id === effectiveVenueId)
  const homeVenueDetail = !player.home_venue_id && player.auto_venue_id ? 'Automaticky podľa najnavštevovanejšieho klubu' : undefined

  return <div className="mx-auto max-w-[1120px]">
    <div className="mb-8 flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.22em] text-[#ccff00]">RIVA /</p><h1 className="mt-2 text-3xl font-black">Môj profil</h1></div><div className="hidden items-center gap-3 sm:flex"><div className="text-right"><p className="font-bold">{player.username}</p><p className="text-xs text-white/45">{player.region}</p></div><AvatarPreview src={avatarUrl} initials={player.username.slice(0, 1)} /></div></div>
    <section className="rounded-2xl border border-white/[0.08] bg-[#111722] p-6 sm:p-10"><div className="flex flex-col gap-6 sm:flex-row sm:items-center"><div className="relative"><AvatarPreview src={avatarUrl} initials={player.username.slice(0, 1)} size="lg" /><label htmlFor="profile-avatar-upload" className="absolute -bottom-2 -right-2 flex h-12 w-12 cursor-pointer items-center justify-center rounded-xl bg-[var(--profile-avatar-color,#ccff00)] text-xl font-black text-[#10150d]">⌾</label></div><div className="flex-1"><h2 className="text-4xl font-black">{player.username}</h2><p className="mt-1 text-lg text-white/45">{player.email}</p><div className="mt-4 flex flex-wrap gap-2"><span className="rounded-lg bg-[var(--profile-avatar-color,#ccff00)] px-3 py-2 text-xs font-black text-[#10150d]">{player.region}</span><span className="rounded-lg bg-[#1d2b44] px-3 py-2 text-xs font-bold">{player.level}</span><span className="rounded-lg border border-[var(--profile-avatar-color,#ccff00)] bg-white/5 px-3 py-2 text-xs font-bold text-[var(--profile-avatar-color,#ccff00)]">{matchStats.elo} ELO</span></div></div></div></section><section className="mt-6 rounded-xl border border-white/[0.08] bg-[#111722] p-5"><h2 className="text-sm font-bold">{t('Profilový popis', 'About me')}</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/65">{profile?.bio.trim() || t('Bio zatiaľ nie je vyplnené.', 'No Bio added yet.')}</p></section><input ref={avatarInputRef} id="profile-avatar-upload" type="file" accept="image/*" onChange={handleAvatarChange} className="sr-only" />
    <div className="mt-8 grid gap-6 lg:grid-cols-2"><InfoCard title="Osobné údaje"><InfoRow label="Meno:" value={player.username} /><InfoRow label="Kraj:" value={player.region} /><InfoRow label="Úroveň:" value={player.level} /><HomeArenaInfoRow email={player.email} arenas={arenas} homeVenueId={player.home_venue_id} autoVenueId={player.auto_venue_id} /><DominantHandInfoRow email={player.email} value={player.dominant_hand} /><InfoRow label="Telefón:" value={phone || 'Neuvedené'} /><InfoRow label="Dátum registrácie:" value={player.created_at ? new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'sk-SK', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(player.created_at)) : 'Neuvedené'} /></InfoCard><InfoCard title="Štatistiky ELO"><InfoRow label="Aktuálne ELO:" value={`${player.elo} ELO`} highlight /><InfoRow label="ELO od registrácie:" value={`${player.career_elo} ELO`} /><InfoRow label="Najvyššie ELO:" value={`${player.highest_elo} ELO`} /><InfoRow label="Aktuálna sezóna:" value={formatSeason(player.elo_season_start, language)} /><InfoRow label="Krajská pozícia:" value="1. miesto" /><InfoRow label="Celoslovenská pozícia:" value="1. miesto" /></InfoCard></div>
    <div className="mt-8"><h2 className="text-xl font-black">Štatistiky zápasov</h2></div><section className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MatchStatCard label="Odohraté zápasy" value={profileMatchesLoading || profileMatchesError ? '–' : String(matchStats.total)} detail="Celkový počet zápasov" /><MatchStatCard label="Výhry" value={profileMatchesLoading || profileMatchesError ? '–' : String(matchStats.wins)} detail="Vyhraté zápasy" /><MatchStatCard label="Prehry" value={profileMatchesLoading || profileMatchesError ? '–' : String(matchStats.losses)} detail="Ostatné zápasy" /><MatchStatCard label="Úspešnosť" value={profileMatchesLoading || profileMatchesError ? '–' : `${matchStats.winRate}%`} detail="Win rate" progress={matchStats.winRate} /><MatchStatCard label="Vyhraté sety" value={profileMatchesLoading || profileMatchesError ? '–' : String(matchStats.wonSets)} detail="Celkový počet" /><MatchStatCard label="Prehraté sety" value={profileMatchesLoading || profileMatchesError ? '–' : String(matchStats.lostSets)} detail="Celkový počet" /><MatchStatCard label="Vyhraté gemy" value={profileMatchesLoading || profileMatchesError ? '–' : String(matchStats.wonGames)} detail="Celkový počet" /><MatchStatCard label="Prehraté gemy" value={profileMatchesLoading || profileMatchesError ? '–' : String(matchStats.lostGames)} detail="Celkový počet" /><RecentFormCard matches={profileMatches.filter(isCountedMatch)} isLoading={profileMatchesLoading} error={profileMatchesError} /></section><section className="mt-8 rounded-2xl border border-white/[0.08] bg-[#111722] p-6 sm:p-8">
      <div className="flex items-end justify-between border-b border-white/[0.08] pb-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">Výsledky</p>
          <h2 className="mt-2 text-2xl font-black">História zápasov</h2>
        </div>
        <span className="text-xs text-white/35">{profileMatches.length} záznamov</span>
      </div>
      {matches.some((match) => match.status === 'PENDING') ? (
        <div className="mt-5 space-y-3">
          {matches.filter((match) => match.status === 'PENDING').map((match) => (
            <div key={match.id} className="flex flex-col gap-3 rounded-xl border border-[#ccff00]/20 bg-[#ccff00]/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-bold">Zápas čaká na potvrdenie {match.approvedBy}/2 dvojíc</p>
                <p className="mt-1 text-xs text-white/45">{match.arena} · {match.scores.join(', ')}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={approveMatch} className="rounded-lg bg-[#ccff00] px-3 py-2 text-xs font-black text-[#10150d]">Potvrdiť výsledok</button>
                <button type="button" className="rounded-lg border border-red-300/20 px-3 py-2 text-xs font-bold text-red-300">Nahlásiť chybu</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {profileMatchesLoading ? <p role="status" className="py-12 text-center text-sm text-white/45">Načítavam históriu zápasov…</p> : profileMatchesError ? <p role="alert" className="py-8 text-center text-sm text-red-300">{getErrorMessage(profileMatchesError, 'Históriu zápasov sa nepodarilo načítať.')}</p> : profileMatches.length ? (
        <div className="divide-y divide-white/[0.06]">
          {profileMatches.map((match) => <ProfileMatchHistoryItem key={match.id} match={match} onOpen={onOpenMatch} />)}
        </div>
      ) : (
        <div className="flex min-h-[180px] flex-col items-center justify-center text-center">
          <Trophy className="text-white/25" size={30} />
          <p className="mt-4 text-sm font-semibold text-white/65">Zatiaľ nemáš žiadne odohraté zápasy.</p>
          <p className="mt-2 max-w-lg text-xs leading-relaxed text-white/35">Po odohraní zápasu sa jeho výsledok zobrazí tu.</p>
        </div>
      )}
    </section>
    {matchModalOpen ? <MatchModal matchForm={matchForm} setMatchForm={setMatchForm} submitMatch={submitMatch} onClose={() => setMatchModalOpen(false)} /> : null}
  </div>
})

const MatchRecordModal = memo(function MatchRecordModal({ form, setForm, slots, setSlot, submit, onClose }: { form: Record<string, string>; setForm: React.Dispatch<React.SetStateAction<Record<string, string>>>; slots: MatchPlayerSlots; setSlot: (field: MatchPlayerField, slot: MatchPlayerSlot) => void; submit: (event: React.FormEvent) => void; onClose: () => void }) {
  const { data: arenas = [] } = useSWR('arenas', fetchArenas)
  const { data: players = [], isLoading: playersLoading, error: playersError } = useSWR('match-result-players', fetchPlayerProfiles)
  const [activePlayerField, setActivePlayerField] = useState<string | null>(null)
  const [highlightedPlayer, setHighlightedPlayer] = useState(0)
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const scoreValidation = validateMatchScore(form)
  const playerValidation = validateMatchPlayers(slots, players)
  const normalizeName = normalizePlayerName
  const input = (key: string, label: string, type = 'text', required = true) => key === 'arena' ? (
    <label key={key} className="grid gap-2 text-xs font-bold text-white/60">{label}<select required={required} value={form[key] || ''} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} className="rounded-lg border border-white/10 bg-[#0b0f17] px-3 py-2.5 text-sm text-white"><option value="">Vyber arénu</option>{arenas.map((arena) => <option key={arena.id} value={arena.name}>{arena.name} · {arena.city}</option>)}</select></label>
  ) : <label key={key} className="grid gap-2 text-xs font-bold text-white/60">{label}<input required={required} type={type} value={form[key] || ''} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} className="rounded-lg border border-white/10 bg-[#0b0f17] px-3 py-2.5 text-sm text-white outline-none focus:border-[#ccff00]" /></label>
  const playerInput = (key: MatchPlayerField, label: string) => {
    const slot = slots[key]
    const query = normalizeName(slot.name)
    const otherFields = MATCH_PLAYER_FIELDS.filter((field) => field !== key)
    const takenIds = new Set(otherFields.map((field) => playerValidation.resolvedIds[field] || slots[field].id).filter(Boolean))
    const takenNames = new Set(otherFields.map((field) => normalizeName(slots[field].name)).filter(Boolean))
    const suggestions = query ? players.filter((player) => normalizeName(player.full_name).includes(query) && !takenIds.has(String(player.id)) && !takenNames.has(normalizeName(player.full_name))).slice(0, 8) : []
    const isOpen = activePlayerField === key && Boolean(query)
    const fieldError = playerValidation.errors[key]
    const isDuplicate = Boolean(slot.name) && fieldError === DUPLICATE_PLAYER_ERROR
    const showFieldError = Boolean(fieldError) && (submitAttempted || isDuplicate || (Boolean(slot.name) && activePlayerField !== key))
    const selectPlayer = (player: (typeof players)[number]) => {
      if (takenIds.has(String(player.id))) return
      setSlot(key, { name: player.full_name.trim(), id: String(player.id) })
      setActivePlayerField(null)
      setHighlightedPlayer(0)
    }
    return <div key={key} className="relative grid gap-2" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setActivePlayerField((current) => current === key ? null : current) }}>
      <label htmlFor={`match-${key}`} className="text-xs font-bold text-white/60">{label}</label>
      <input id={`match-${key}`} required autoComplete="off" role="combobox" aria-autocomplete="list" aria-expanded={isOpen} aria-controls={`match-${key}-options`} aria-activedescendant={isOpen && suggestions[highlightedPlayer] ? `match-${key}-option-${suggestions[highlightedPlayer].id}` : undefined}
        aria-invalid={showFieldError} aria-describedby={`match-${key}-error`}
        value={slot.name}
        onFocus={() => { setActivePlayerField(key); setHighlightedPlayer(0) }}
        onChange={(event) => {
          setSlot(key, { name: event.target.value, id: '' })
          setActivePlayerField(key)
          setHighlightedPlayer(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); setActivePlayerField(null) }
          if (!suggestions.length) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setActivePlayerField(key)
            setHighlightedPlayer((current) => event.key === 'ArrowDown' ? (current + 1) % suggestions.length : (current - 1 + suggestions.length) % suggestions.length)
          } else if (event.key === 'Enter' && isOpen) {
            event.preventDefault()
            selectPlayer(suggestions[highlightedPlayer] ?? suggestions[0])
          }
        }}
        placeholder="Meno hráča" className={`rounded-lg border bg-[#0b0f17] px-3 py-2.5 text-sm text-white outline-none ${showFieldError ? 'border-red-400/70 focus:border-red-300' : 'border-white/10 focus:border-[#ccff00]'}`} />
      <p id={`match-${key}-error`} role={showFieldError ? 'alert' : undefined} className="text-xs text-red-300">{showFieldError ? fieldError : null}</p>
      {isOpen ? <ul id={`match-${key}-options`} role="listbox" aria-label={label} className="absolute inset-x-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-lg border border-white/15 bg-[#131924] p-1 shadow-xl">
        {playersLoading ? <li role="presentation" className="p-3 text-xs text-white/50">Načítavam hráčov…</li>
          : playersError ? <li role="presentation" className="p-3 text-xs text-red-300">Hráčov sa nepodarilo načítať.</li>
          : !suggestions.length ? <li role="presentation" className="p-3 text-xs text-white/50">Žiadny hráč s týmto menom.</li>
          : suggestions.map((player, index) => <li key={player.id} id={`match-${key}-option-${player.id}`} role="option" aria-selected={highlightedPlayer === index}>
            <button type="button" tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={() => selectPlayer(player)} className={`w-full rounded-md px-3 py-2 text-left ${highlightedPlayer === index ? 'bg-white/10' : 'hover:bg-white/5'}`}>
              <span className="block break-words text-sm font-bold text-white">{player.full_name}</span>
              <span className="block text-xs text-white/45">{player.region || 'Kraj neuvedený'} · {player.elo_rating} ELO</span>
            </button>
          </li>)}
      </ul> : null}
    </div>
  }
  const scoreInput = (key: string, label: string, setNumber: number) => {
    const disabled = setNumber === 3 && !scoreValidation.thirdSetEnabled
    return <input key={key} required={!disabled} disabled={disabled} type="number" min="0" max="7" step="1" inputMode="numeric" aria-label={label} aria-invalid={Boolean(scoreValidation.errors[setNumber]) && Boolean(form[`set${setNumber}a`] || form[`set${setNumber}b`])} aria-describedby={`set-${setNumber}-error`} value={form[key] || ''}
      onChange={(event) => setForm((current) => {
        const next = { ...current, [key]: event.target.value }
        return validateMatchScore(next).thirdSetEnabled ? next : { ...next, set3a: '', set3b: '' }
      })}
      className="h-11 w-full rounded-lg border border-white/10 bg-[#0b0f17] px-3 text-center text-base font-bold text-white outline-none focus:border-[#ccff00] disabled:cursor-not-allowed disabled:opacity-35" />
  }
  const scoreRow = (setNumber: number) => {
    const showError = Boolean(form[`set${setNumber}a`] || form[`set${setNumber}b`]) || (setNumber === 3 && scoreValidation.thirdSetEnabled)
    return <div key={setNumber}>
      <div className="grid grid-cols-[56px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3">
        <span className="text-xs font-bold text-white/60">Set {setNumber}{setNumber === 3 ? <span className="mt-0.5 block text-[10px] font-normal text-white/35">{scoreValidation.thirdSetEnabled ? 'Povinný' : 'Len pri 1:1'}</span> : null}</span>
        {scoreInput(`set${setNumber}a`, `Set ${setNumber}, 1. dvojica`, setNumber)}
        {scoreInput(`set${setNumber}b`, `Set ${setNumber}, 2. dvojica`, setNumber)}
      </div>
      <p id={`set-${setNumber}-error`} role={showError && scoreValidation.errors[setNumber] ? 'alert' : undefined} className="mt-1 text-xs text-red-300">{showError ? scoreValidation.errors[setNumber] : null}</p>
    </div>
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><form onSubmit={(event) => {
    setSubmitAttempted(true)
    if (!playerValidation.isValid || !scoreValidation.isValid) { event.preventDefault(); return }
    submit(event)
  }} className="ios-scroll max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-[#131924] p-6"><div className="flex items-center justify-between"><h2 className="text-xl font-black">Zadať výsledok zápasu</h2><button type="button" onClick={onClose} aria-label="Zavrieť" className="text-white/45">×</button></div><p className="mt-2 text-sm text-white/45">Zadaj hráčov oboch dvojíc a počet hier v každom sete.</p><p className="mt-3 w-fit rounded-md border border-[#ccff00]/20 bg-[#ccff00]/10 px-3 py-2 text-xs font-bold text-[#ccff00]">Ligový ELO zápas</p><div className="mt-5 grid gap-4 sm:grid-cols-2">{input('date', 'Dátum zápasu', 'date')}{input('arena', 'Aréna')}<fieldset className="grid gap-3 rounded-xl border border-white/10 p-4"><legend className="px-2 text-sm font-bold text-white">1. dvojica</legend>{playerInput('team1Player1', 'Hráč 1')}{playerInput('team1Player2', 'Hráč 2')}</fieldset><fieldset className="grid gap-3 rounded-xl border border-white/10 p-4"><legend className="px-2 text-sm font-bold text-white">2. dvojica</legend>{playerInput('team2Player1', 'Hráč 1')}{playerInput('team2Player2', 'Hráč 2')}</fieldset><div className="grid gap-3 sm:col-span-2"><div><h3 className="text-sm font-bold text-white">Skóre setov</h3><p className="mt-1 text-xs text-white/40">Zadaj počet hier vyhraných každou dvojicou.</p></div><div className="grid grid-cols-[56px_minmax(0,1fr)_minmax(0,1fr)] gap-3 px-1 text-[10px] font-bold uppercase text-white/40"><span /><span className="text-center">1. dvojica</span><span className="text-center">2. dvojica</span></div>{scoreRow(1)}{scoreRow(2)}{scoreRow(3)}</div></div>{playerValidation.hasDuplicates ? <p role="alert" className="mt-5 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm font-bold text-red-200">{playerValidation.summary}</p> : null}<button type="submit" disabled={!scoreValidation.isValid || playerValidation.hasDuplicates} className="mt-5 w-full rounded-lg bg-[#ccff00] py-3 text-sm font-black text-[#10150d] disabled:cursor-not-allowed disabled:opacity-40">Odoslať na schválenie</button></form></div>
})

const MatchModal = memo(function MatchModal({ matchForm, setMatchForm, submitMatch, onClose }: { matchForm: { date: string; arena: string; teammate: string; opponents: string; set1: string; set2: string; set3: string }; setMatchForm: React.Dispatch<React.SetStateAction<{ date: string; arena: string; teammate: string; opponents: string; set1: string; set2: string; set3: string }>>; submitMatch: (event: React.FormEvent) => void; onClose: () => void }) {
  const { data: arenas = [] } = useSWR('arenas', fetchArenas)
  const field = (key: keyof typeof matchForm, label: string, type = 'text') => key === 'arena' ? (
    <label className="grid gap-2 text-xs font-bold text-white/60">{label}<select required value={matchForm.arena} onChange={(event) => setMatchForm((current) => ({ ...current, arena: event.target.value }))} className="rounded-lg border border-white/10 bg-[#0b0f17] px-3 py-2.5 text-sm text-white"><option value="">Vyber arénu</option>{arenas.map((arena) => <option key={arena.id} value={arena.name}>{arena.name} · {arena.city}</option>)}</select></label>
  ) : <label className="grid gap-2 text-xs font-bold text-white/60">{label}<input required={key !== 'set3'} type={type} value={matchForm[key]} onChange={(event) => setMatchForm((current) => ({ ...current, [key]: event.target.value }))} className="rounded-lg border border-white/10 bg-[#0b0f17] px-3 py-2.5 text-sm text-white outline-none focus:border-[#ccff00]" /></label>
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><form onSubmit={submitMatch} className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#111722] p-6"><div className="flex items-center justify-between"><h2 className="text-xl font-black">Zadať výsledok zápasu</h2><button type="button" onClick={onClose} className="text-white/45">×</button></div><div className="mt-5 grid gap-4 sm:grid-cols-2">{field('date', 'Dátum', 'date')}{field('arena', 'Aréna')}{field('teammate', 'Spoluhráč')}{field('opponents', 'Súperi')}{field('set1', 'Set 1 (napr. 6-4)')}{field('set2', 'Set 2 (napr. 3-6)')}{field('set3', 'Set 3 (voliteľný)')}</div><p className="mt-4 text-xs text-white/40">Po odoslaní bude výsledok čakať na schválenie druhou dvojicou.</p><button className="mt-5 w-full rounded-lg bg-[#ccff00] py-3 text-sm font-black text-[#10150d]">Odoslať na schválenie</button></form></div>
})

const MatchStatCard = memo(function MatchStatCard({ label, value, suffix, progress }: { label: string; value: string; suffix?: string; detail?: string; progress?: number }) { return <article className="rounded-2xl border border-white/[0.08] bg-[#111722] p-5"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">{label}</p><p className="mt-4 text-3xl font-black text-[#ccff00]">{value} {suffix ? <span className="text-xs text-white/45">{suffix}</span> : null}</p>{progress ? <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#ccff00]" style={{ width: `${progress}%` }} /></div> : null}</article> })

const ProfileMatchHistoryItem = memo(function ProfileMatchHistoryItem({ match, onOpen }: { match: ProfileMatch; onOpen: (matchId: string) => void }) {
  const { language } = useLanguage()
  const date = new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'sk-SK', { dateStyle: 'medium' }).format(new Date(match.match_date))
  const isWin = match.result === 'win'
  return <button type="button" onClick={() => onOpen(match.id)} aria-label={`Detail zápasu ${date} proti ${match.opponent_name}`} className="group -mx-3 flex w-[calc(100%+1.5rem)] flex-col gap-3 rounded-lg px-3 py-5 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ccff00] sm:flex-row sm:items-center sm:justify-between">
    <div><p className="text-sm font-bold">{date}</p><p className="mt-1 text-sm text-white/55">Súper: {match.opponent_name}</p><p className="mt-1 text-xs text-white/40">Sety {match.sets_won} : {match.sets_lost} · Gemy {match.games_won} : {match.games_lost}</p></div>
    <div className="flex flex-wrap items-center gap-2"><span className={`w-fit rounded-md px-2.5 py-1.5 text-[10px] font-black ${isWin ? 'bg-[#35d6a2]/15 text-[#35d6a2]' : 'bg-red-400/15 text-red-300'}`}>{isWin ? 'VÝHRA' : 'PREHRA'}</span>{match.status === 'rejected' || match.status === 'disputed' ? <span className="w-fit rounded-md bg-amber-400/10 px-2 py-1.5 text-[10px] font-bold text-amber-300">SPORNÝ VÝSLEDOK</span> : null}<ChevronRight size={16} aria-hidden="true" className="hidden text-white/25 transition-colors group-hover:text-[#ccff00] sm:block" /></div>
  </button>
})

const InfoCard = memo(function InfoCard({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-white/[0.08] bg-[#111722] p-6 sm:p-8"><h2 className="border-b border-white/[0.08] pb-4 text-2xl font-black">{title}</h2><div>{children}</div></section> })
function DominantHandInfoRow({ email, value }: { email: string; value: DominantHand }) {
  const [selectedHand, setSelectedHand] = useState(value)
  const [isOpen, setIsOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => setSelectedHand(value), [value])

  const labels: Record<DominantHand, string> = { right: 'Pravák', left: 'Ľavák', both: 'Hráš oboma rukami' }

  async function save(value: DominantHand) {
    setIsSaving(true)
    setError('')
    try {
      await updatePlayerProfile(email, { dominant_hand: value })
      setSelectedHand(value)
      setIsOpen(false)
      window.dispatchEvent(new Event('proffiles-updated'))
    } catch (saveError: unknown) {
      const message = getErrorMessage(saveError, 'Dominantnú ruku sa nepodarilo uložiť.')
      console.error('Uloženie dominantnej ruky zlyhalo:', message)
      setError(message)
    } finally {
      setIsSaving(false)
    }
  }

  return <div className="flex min-h-14 items-center justify-between border-b border-white/[0.06] py-3 text-sm">
    <span className="text-white/55">Dominantná ruka:</span>
    <div className="relative flex items-center gap-2">
      <span className="font-bold">{labels[selectedHand]}</span>
      <button type="button" onClick={() => setIsOpen((open) => !open)} disabled={isSaving} aria-label="Upraviť dominantnú ruku" aria-expanded={isOpen} title="Upraviť dominantnú ruku" className="flex h-8 w-8 items-center justify-center rounded-md text-white/50 hover:bg-white/10 hover:text-[#ccff00] disabled:opacity-50"><Settings size={15} /></button>
      {isOpen ? <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-white/10 bg-[#131924] p-3 shadow-xl">
        <label htmlFor="dominant-hand-select" className="mb-2 block text-xs font-bold text-white/60">Dominantná ruka</label>
        <select id="dominant-hand-select" autoFocus value={selectedHand} disabled={isSaving} onChange={(event) => void save(event.target.value as DominantHand)} className="w-full rounded-md border border-white/10 bg-[#0b0f17] px-3 py-2 text-sm text-white outline-none focus:border-[#ccff00] disabled:opacity-50">
          <option value="right">Pravák</option>
          <option value="left">Ľavák</option>
          <option value="both">Hráš oboma rukami</option>
        </select>
        {error ? <p role="alert" className="mt-2 text-xs text-red-300">{error}</p> : null}
      </div> : null}
    </div>
  </div>
}

function HomeArenaInfoRow({ email, arenas, homeVenueId, autoVenueId }: { email: string; arenas: Arena[]; homeVenueId: string | null; autoVenueId: string | null }) {
  const [selectedArenaId, setSelectedArenaId] = useState(homeVenueId || autoVenueId || '')
  const [isOpen, setIsOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => setSelectedArenaId(homeVenueId || autoVenueId || ''), [homeVenueId, autoVenueId])

  const selectedArena = arenas.find((arena) => arena.id === selectedArenaId)
  const isAutoSelected = !homeVenueId && Boolean(autoVenueId)

  async function save(arenaId: string) {
    if (!arenaId || arenaId === selectedArenaId) {
      setIsOpen(false)
      return
    }
    setIsSaving(true)
    setError('')
    try {
      await updatePlayerProfile(email, { home_venue_id: arenaId })
      setSelectedArenaId(arenaId)
      setIsOpen(false)
      window.dispatchEvent(new Event('proffiles-updated'))
    } catch (saveError: unknown) {
      const message = getErrorMessage(saveError, 'Domovskú arénu sa nepodarilo uložiť.')
      console.error('Uloženie domovskej arény zlyhalo:', message)
      setError(message)
    } finally {
      setIsSaving(false)
    }
  }

  return <div className="flex min-h-14 items-center justify-between border-b border-white/[0.06] py-3 text-sm">
    <span className="text-white/55">Domovská aréna:</span>
    <div className="relative flex items-center gap-2">
      <span className="text-right font-bold">{selectedArena?.name || 'Neuvedená'}{isAutoSelected ? <span className="mt-1 block text-[10px] font-normal text-white/40">Automaticky podľa najnavštevovanejšieho klubu</span> : null}</span>
      <button type="button" onClick={() => setIsOpen((open) => !open)} disabled={isSaving} aria-label="Upraviť domovskú arénu" aria-expanded={isOpen} title="Upraviť domovskú arénu" className="flex h-8 w-8 items-center justify-center rounded-md text-white/50 hover:bg-white/10 hover:text-[#ccff00] disabled:opacity-50"><Settings size={15} /></button>
      {isOpen ? <div className="absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border border-white/10 bg-[#131924] p-3 shadow-xl">
        <label htmlFor="home-arena-select" className="mb-2 block text-xs font-bold text-white/60">Domovská aréna</label>
        <select id="home-arena-select" autoFocus value={selectedArenaId} disabled={isSaving} onChange={(event) => void save(event.target.value)} className="w-full rounded-md border border-white/10 bg-[#0b0f17] px-3 py-2 text-sm text-white outline-none focus:border-[#ccff00] disabled:opacity-50">
          <option value="" disabled>Vyber arénu</option>
          {arenas.map((arena) => <option key={arena.id} value={arena.id}>{arena.name}</option>)}
        </select>
        {error ? <p role="alert" className="mt-2 text-xs text-red-300">{error}</p> : null}
      </div> : null}
    </div>
  </div>
}

const InfoRow = memo(function InfoRow({ label, value, highlight, detail }: { label: string; value: string; highlight?: boolean; detail?: string }) { return <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] py-4 text-sm"><span className="shrink-0 text-white/55">{label}</span><span className="text-right"><span className={highlight ? 'font-bold text-[#ccff00]' : 'font-bold'}>{value}</span>{detail ? <span className="mt-1 block text-[10px] leading-relaxed text-white/40">{detail}</span> : null}</span></div> })

const AvatarPreview = memo(function AvatarPreview({ src, initials, size = 'md' }: { src: string | null; initials: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClass = size === 'sm' ? 'h-9 w-9 text-xs' : size === 'lg' ? 'h-40 w-40 text-7xl' : 'h-16 w-16 text-lg'
  const [zoomed, setZoomed] = useState(false)
  useEffect(() => {
    if (!zoomed) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setZoomed(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomed])
  return src ? <>
    <button type="button" onClick={() => setZoomed(true)} aria-label="Zväčšiť profilovú fotografiu" className="shrink-0 cursor-zoom-in rounded-full ring-2 ring-[var(--profile-avatar-color,#ccff00)]"><img src={src} alt="Profilová fotografia" className={`${sizeClass} rounded-full object-cover`} /></button>
    {zoomed ? <div role="dialog" aria-modal="true" aria-label="Profilová fotografia" onClick={() => setZoomed(false)} className="fixed inset-0 z-[60] flex cursor-zoom-out items-center justify-center bg-black/85 p-4">
      <button type="button" onClick={() => setZoomed(false)} aria-label="Zavrieť" className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"><X size={20} /></button>
      <img src={src} alt="Profilová fotografia" onClick={(event) => event.stopPropagation()} className="max-h-[85vh] max-w-[90vw] cursor-default rounded-2xl object-contain shadow-2xl" />
    </div> : null}
  </> : <div className={`${sizeClass} flex items-center justify-center rounded-full bg-[var(--profile-avatar-color,#ccff00)] font-black text-[#10150d]`}>{initials}</div>
})

const StatCard = memo(function StatCard({ label, value, suffix, detail, icon, onClick }: { label: string; value: string; suffix: string; detail: string; icon: React.ReactNode; onClick?: () => void }) {
  return <article role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick} onKeyDown={(event) => { if (onClick && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onClick() } }} className={`rounded-2xl border border-white/[0.08] bg-[#111722] p-5 hover:border-[#ccff00]/30 ${onClick ? 'cursor-pointer' : ''}`}><div className="flex items-center justify-between text-white/35"><span className="text-[10px] font-bold uppercase tracking-[0.18em]">{label}</span><span className="text-[#ccff00]/75">{icon}</span></div><div className="mt-5 flex items-baseline gap-2"><span className="text-3xl font-black tracking-tight text-[#ccff00]">{value}</span>{suffix ? <span className="text-xs font-semibold text-white/45">{suffix}</span> : null}</div><p className="mt-2 text-xs text-white/30">{detail}</p></article>
})
