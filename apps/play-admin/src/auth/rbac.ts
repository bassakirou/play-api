export type RBACAction = 'create' | 'read' | 'update' | 'delete' | 'manage'
export type RBACResource = 'song' | 'album' | 'user' | 'role' | 'genre' | 'artist'

export type Permission = { id?: string; action: string; resource: string }

export function canAccess(roleName?: string, permissions?: Permission[] | null, action?: RBACAction, resource?: RBACResource) {
  if (!action || !resource) return true
  if (roleName === 'ADMIN') return true
  if (permissions && permissions.length > 0) {
    return permissions.some((p) => p.action === action && p.resource === resource)
  }
  const matrix: Record<string, Array<[RBACAction, RBACResource]>> = {
    CREATOR: [
      ['create', 'song'],
      ['update', 'song'],
      ['read', 'song'],
      ['read', 'album'],
    ],
    LABEL: [
      ['manage', 'artist'],
      ['create', 'album'],
      ['update', 'album'],
      ['read', 'album'],
      ['read', 'song'],
    ],
    USER: [['read', 'song'], ['read', 'album']],
  }
  const allowed = matrix[roleName || ''] || []
  return allowed.some(([a, r]) => a === action && r === resource)
}

export const ALL_PERMISSIONS: Permission[] = ['song', 'album', 'artist', 'genre'].flatMap((resource) =>
  ['create', 'read', 'update', 'delete'].map((action) => ({ action, resource }))
)

