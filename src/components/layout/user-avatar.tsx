'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { User } from 'lucide-react';
import { useAuth } from '@workos-inc/authkit-nextjs/components';
import { getMyProfileAction } from '@/lib/actions/profile';
import type { MyProfile } from '@/lib/mongodb/identity';
import { isValidImageUrl, userInitials } from '@/lib/utils';

/**
 * The header's account control — the only place in the chrome that tells a
 * reader whether they are signed in.
 *
 * It used to be a hardcoded `<User>` glyph pointing at /profile, identical for
 * an anonymous visitor and a signed-in one, so there was no way to tell from any
 * page whether a session existed. Now it renders the WorkOS profile picture (or
 * a monogram), and sends signed-out visitors to sign-in rather than to a profile
 * page that would only tell them to sign in.
 *
 * Auth state comes from `useAuth()` — the client hook AuthKitProvider already
 * supplies — deliberately NOT from `withAuth()` in the root layout. Reading
 * cookies in the root layout would opt every route in the app into dynamic
 * rendering to decorate one 36px control; this keeps the static pages static.
 *
 * The picture and name come from `identity.persons`, not from the session: the
 * platform's profile pictures live on `profile-images.mukoko.com` and are not in
 * the WorkOS token, so a header built from the claims alone would show a
 * monogram for users who do have a picture everywhere else.
 */
export function UserAvatar({ onDark = false }: { onDark?: boolean }) {
  const { user, loading } = useAuth();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  // A profile picture is a remote URL that can 404 or be blocked; fall through
  // to the monogram rather than showing a broken-image glyph.
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }
    let active = true;
    getMyProfileAction()
      .then((p) => {
        if (active) setProfile(p);
      })
      // The session still identifies the user, so a failed profile read
      // degrades to the monogram rather than blanking the control.
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user]);

  const ring = onDark
    ? 'bg-white/10 hover:bg-white/20'
    : 'bg-background/20 hover:bg-background/30';
  const base = `flex items-center justify-center w-9 h-9 sm:w-11 sm:h-11 rounded-full transition-colors overflow-hidden ${ring}`;

  // Render the neutral shape while the session resolves. Guessing "signed out"
  // here makes a signed-in user's avatar visibly pop in on every navigation.
  if (loading) {
    return <div className={base} aria-hidden="true" />;
  }

  if (!user) {
    return (
      <Link href="/sign-in" className={base} aria-label="Sign in">
        <User className="w-4 h-4 sm:w-5 sm:h-5 text-on-primary" aria-hidden="true" />
      </Link>
    );
  }

  const first = profile?.givenName ?? user.firstName;
  const last = profile?.familyName ?? user.lastName;
  const picture = profile?.picture ?? user.profilePictureUrl;
  const showPicture = !imageFailed && isValidImageUrl(picture);
  const name = profile?.name || [first, last].filter(Boolean).join(' ') || user.email;

  return (
    <Link
      href="/profile"
      className={`${base} ring-2 ring-white/40`}
      aria-label={`Your account (${name})`}
      title={name}
    >
      {showPicture ? (
        // Plain <img>: the picture host is not in the Next image config, and
        // adding a remote pattern for it would let any path on that host be
        // proxied through our optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={picture as string}
          alt=""
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : (
        // `text-on-primary`, not `text-white`.
        //
        // The pill sits inside the header's `bg-primary`, and `--primary` FLIPS
        // with the theme: #4B0082 in light, #B388FF in dark. Hardcoding white
        // ink is therefore only correct in one of them — in dark it composites
        // to white on ~#BB94FF, which axe reports as a serious contrast
        // violation (3.91:1) and APCA puts at Lc 51.9 against a 75 requirement.
        // `--on-primary` is the token that already tracks that flip.
        //
        // This is an improvement, not a pass: on dark it reaches Lc 56, and
        // NO ink clears 75 on #B388FF at this size — the ceiling is the mineral
        // itself, which is a palette decision rather than a component one.
        <span className="text-xs sm:text-sm font-bold text-on-primary">
          {userInitials(first, last, user.email)}
        </span>
      )}
    </Link>
  );
}
