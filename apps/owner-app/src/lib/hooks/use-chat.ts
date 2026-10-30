'use client';

import { useQuery } from '@tanstack/react-query';
import type { ChatConversation, ChatThread } from '@morbeez/shared-types';
import { apiGet } from '../api/client';

// Driver–owner chat (driver app D9): the drivers' conversations, one
// conversation, and what this owner hasn't read — refreshed while open.

export const CHAT_KEY = ['chat'];

export function useChatUnread(enabled: boolean) {
  return useQuery({ queryKey: ['chat', 'unread'], queryFn: () => apiGet<{ unread: number }>('chat/unread'), enabled, refetchInterval: 30_000 });
}

export function useConversations() {
  return useQuery({ queryKey: ['chat', 'conversations'], queryFn: () => apiGet<ChatConversation[]>('chat/conversations'), refetchInterval: 20_000 });
}

export function useChatThread(employeeId: string | null) {
  return useQuery({
    queryKey: ['chat', 'thread', employeeId],
    queryFn: () => apiGet<ChatThread>(`chat/conversations/${employeeId}`),
    enabled: employeeId !== null,
    refetchInterval: 10_000,
  });
}
