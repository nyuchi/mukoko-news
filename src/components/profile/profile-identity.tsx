'use client';

import { useState } from 'react';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { updateProfileAction } from '@/lib/actions/profile';
import { isValidImageUrl, userInitials } from '@/lib/utils';

/**
 * The signed-in user's name, picture and the control to change them.
 *
 * The name is edited here and written to WorkOS (see `lib/actions/profile.ts`),
 * which is what makes the change reach the OTHER Mukoko apps rather than just
 * this one: WorkOS emits `user.updated`, the gateway's webhook syncs it into
 * `identity.persons`, and every app reading identity picks it up. Writing
 * MongoDB from here would update News alone and violate the domain boundary.
 *
 * The picture is display-only for now — it comes from the WorkOS profile and
 * changing it needs an upload target, which is a separate piece of work.
 */
export function ProfileIdentity({
  firstName,
  lastName,
  email,
  pictureUrl,
}: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  pictureUrl?: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [first, setFirst] = useState(firstName ?? '');
  const [last, setLast] = useState(lastName ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // The session cookie still carries the old claims until AuthKit refreshes it,
  // so show what was just saved rather than letting the heading snap back.
  const [displayed, setDisplayed] = useState({
    first: firstName ?? '',
    last: lastName ?? '',
  });

  const [imageFailed, setImageFailed] = useState(false);
  const showPicture = !imageFailed && isValidImageUrl(pictureUrl);
  const displayName = [displayed.first, displayed.last].filter(Boolean).join(' ') || email || '';

  async function save() {
    setSaving(true);
    setError(null);
    const result = await updateProfileAction({ firstName: first, lastName: last });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDisplayed({ first: first.trim(), last: last.trim() });
    setEditing(false);
    setSaved(true);
  }

  function cancel() {
    setFirst(displayed.first);
    setLast(displayed.last);
    setError(null);
    setEditing(false);
  }

  return (
    <div className="text-center mb-10">
      <div className="w-20 h-20 rounded-full mx-auto mb-5 overflow-hidden bg-container-tanzanite flex items-center justify-center">
        {showPicture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={pictureUrl as string}
            alt=""
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span className="font-serif text-2xl font-semibold text-on-container-tanzanite">
            {userInitials(displayed.first, displayed.last, email)}
          </span>
        )}
      </div>

      {editing ? (
        <div className="max-w-sm mx-auto text-left">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <label className="block">
              <span className="text-xs text-text-tertiary">First name</span>
              <input
                value={first}
                onChange={(e) => setFirst(e.target.value)}
                maxLength={60}
                autoComplete="given-name"
                className="mt-1 w-full min-h-[var(--touch-input,43px)] px-3 rounded-xl bg-background border border-elevated focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
            <label className="block">
              <span className="text-xs text-text-tertiary">Last name</span>
              <input
                value={last}
                onChange={(e) => setLast(e.target.value)}
                maxLength={60}
                autoComplete="family-name"
                className="mt-1 w-full min-h-[var(--touch-input,43px)] px-3 rounded-xl bg-background border border-elevated focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
          </div>
          {error && (
            <p role="alert" className="text-sm text-warning mb-3">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 min-h-[var(--touch-cta,47px)] rounded-xl bg-primary text-on-primary font-medium disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="w-4 h-4" aria-hidden="true" />
              )}
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 min-h-[var(--touch-cta,47px)] rounded-xl border border-elevated text-foreground"
            >
              <X className="w-4 h-4" aria-hidden="true" />
              Cancel
            </button>
          </div>
          <p className="text-xs text-text-tertiary mt-3">
            Your name is shared across your Mukoko account, so this updates it everywhere.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-center gap-2 mb-1">
            <h1 className="font-serif text-2xl font-bold">{displayName}</h1>
            <button
              type="button"
              onClick={() => {
                setSaved(false);
                setEditing(true);
              }}
              aria-label="Edit your profile"
              className="p-2 rounded-full hover:bg-elevated transition-colors"
            >
              <Pencil className="w-4 h-4 text-text-secondary" aria-hidden="true" />
            </button>
          </div>
          <p className="text-text-secondary">{email}</p>
          {saved && (
            <p role="status" className="text-xs text-success mt-2">
              Profile updated across your Mukoko account.
            </p>
          )}
        </>
      )}
    </div>
  );
}
