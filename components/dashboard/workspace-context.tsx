'use client'

import { createContext, useContext, useMemo, useState } from 'react'
import type { ActionContext, ClientView, OrgView, UserView, Workspace } from '@/core/tenancy'

interface WorkspaceCtxValue {
  org: OrgView
  users: UserView[]
  clients: ClientView[]
  activeUser: UserView
  activeClient: ClientView
  setActiveUserId: (id: string) => void
  setActiveClientId: (id: string) => void
  /** Build the actor+scope context passed into Server Actions. */
  actionCtx: () => ActionContext
  /** Role helpers for UI gating (server still enforces). */
  canApprove: boolean
  canReview: boolean
  /** Bumped after any mutation so views/badges re-fetch. */
  version: number
  refresh: () => void
}

const WorkspaceCtx = createContext<WorkspaceCtxValue | null>(null)

export function useWorkspace(): WorkspaceCtxValue {
  const ctx = useContext(WorkspaceCtx)
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return ctx
}

export function WorkspaceProvider({
  workspace,
  children,
}: {
  workspace: Workspace
  children: React.ReactNode
}) {
  const [activeUserId, setActiveUserId] = useState(workspace.users[0]?.id ?? '')
  const [activeClientId, setActiveClientId] = useState(workspace.clients[0]?.id ?? '')
  const [version, setVersion] = useState(0)

  const activeUser = workspace.users.find((u) => u.id === activeUserId) ?? workspace.users[0]
  const activeClient = workspace.clients.find((c) => c.id === activeClientId) ?? workspace.clients[0]

  const value = useMemo<WorkspaceCtxValue>(() => {
    const role = activeUser?.role ?? 'INITIATOR'
    return {
      org: workspace.org!,
      users: workspace.users,
      clients: workspace.clients,
      activeUser,
      activeClient,
      setActiveUserId,
      setActiveClientId,
      actionCtx: () => ({
        orgId: workspace.org!.id,
        clientId: activeClient.id,
        clientName: activeClient.name,
        userId: activeUser.id,
        userName: activeUser.name,
        role,
      }),
      canApprove: role === 'APPROVER' || role === 'ADMIN',
      canReview: role === 'REVIEWER' || role === 'APPROVER' || role === 'ADMIN',
      version,
      refresh: () => setVersion((v) => v + 1),
    }
  }, [workspace, activeUser, activeClient, version])

  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>
}
