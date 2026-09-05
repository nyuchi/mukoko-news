'use client';

import { useEffect, useState } from 'react';
import { Building2, Home, Loader2 } from 'lucide-react';
import { getMyEntityAccessAction } from '@/lib/actions/entity-access';
import type { EntityAccess, EntityCapability } from '@/lib/auth/entity-access';

/**
 * The organizations the signed-in user belongs to, and what each membership
 * lets them do.
 *
 * Two reasons this is worth rendering rather than leaving implicit. It is the
 * only place a member can see that the platform knows about their membership at
 * all — until now the data was read and never shown. And it states the scope in
 * plain words: these are powers over that one organization, which is what the
 * capability model enforces (`src/lib/auth/entity-access.ts`). Staff access to
 * `/admin` is a different thing entirely and comes from the WorkOS session, not
 * from anything on this card.
 *
 * Renders nothing when the user has no memberships — including when the read
 * failed, since the action is fail-soft. An empty card claiming "no
 * organizations" would state as fact something the app cannot prove.
 */

const CAPABILITY_LABELS: Record<EntityCapability, string> = {
  'entity:read': 'View',
  'entity:manage': 'Manage',
  'entity:members': 'Members',
};

function entityIcon(entityType: string | null) {
  return entityType === 'family' ? Home : Building2;
}

/**
 * The line under the org name.
 *
 * `title` is free text a person wrote ("Founder", "Head of Newsroom") and is
 * shown verbatim. `role` is the raw `membershipRole` enum off the database row
 * — `founder` | `admin` | `member` — so it needs casing before it is put in
 * front of a reader. Rendering it raw put "Founder" next to "admin" in the same
 * list, which reads as two different kinds of thing rather than one field.
 */
function roleLabel(title: string | null, role: string | null): string {
  if (title) return title;
  if (!role) return 'Member';
  const trimmed = role.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

export function ProfileOrganizations() {
  const [orgs, setOrgs] = useState<EntityAccess[] | null>(null);

  useEffect(() => {
    let active = true;
    getMyEntityAccessAction()
      .then((list) => {
        if (active) setOrgs(list);
      })
      .catch(() => {
        if (active) setOrgs([]);
      });
    return () => {
      active = false;
    };
  }, []);

  if (orgs === null) {
    return (
      <div className="bg-surface border border-elevated rounded-2xl p-6 mb-6 flex justify-center">
        <Loader2 className="w-5 h-5 text-text-tertiary animate-spin" />
      </div>
    );
  }

  if (orgs.length === 0) return null;

  return (
    <div className="bg-surface border border-elevated rounded-2xl overflow-hidden mb-6">
      <h2 className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-tertiary border-b border-elevated">
        Your organizations
      </h2>

      <ul>
        {orgs.map((org) => {
          const Icon = entityIcon(org.entityType);
          return (
            <li
              key={org.entityId}
              className="flex items-start gap-3 px-4 py-4 border-b border-elevated last:border-b-0"
            >
              <div className="w-9 h-9 shrink-0 bg-container-sodalite rounded-full flex items-center justify-center">
                <Icon className="w-4 h-4 text-on-container-sodalite" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="font-medium block truncate">
                  {org.entityName ?? 'Unnamed organization'}
                </span>
                <span className="text-xs text-text-tertiary">
                  {roleLabel(org.title, org.role)}
                </span>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {org.capabilities.map((cap) => (
                    <span
                      key={cap}
                      className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-elevated text-text-secondary"
                    >
                      {CAPABILITY_LABELS[cap]}
                    </span>
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="px-4 py-3 text-xs text-text-tertiary border-t border-elevated">
        These permissions apply to each organization on its own.
      </p>
    </div>
  );
}
