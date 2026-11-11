/**
 * Teacher session plus the approved-teachers check. SPEC 3.1.
 *
 * Signing in is not enough: after every sign-in the app asks the database
 * `is_allowed_teacher()`. If the answer is no, it signs the user straight back
 * out. The database enforces the same rule on every read and write, so this
 * check is about showing a clear message, not about protection.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { S } from '../strings';
import { supabase, supabaseConfigured } from './supabase';

/**
 * Hide most of an address, for when there is no name to show instead.
 *
 * A teacher is often signed in on a projector in front of a class, and their
 * work address is not something to put on the wall. Enough is kept that they
 * can tell which account they are on; the rest is nobody's business.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '•••';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  // One character for a very short local part, two when there is room.
  const keep = local.length <= 2 ? 1 : 2;
  return `${local.slice(0, keep)}•••${domain}`;
}

/**
 * What to call the person signed in.
 *
 * Google gives a name, which is the friendly thing to show and gives nothing
 * away. Signing in with an address and password gives no name, so that falls
 * back to a masked address rather than the whole thing.
 */
export function signedInAs(session: Session | null): string | null {
  if (!session) return null;
  const meta = session.user.user_metadata as Record<string, unknown> | undefined;
  for (const key of ['full_name', 'name']) {
    const value = meta?.[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  const email = session.user.email;
  return email ? maskEmail(email) : null;
}

interface AuthState {
  /** null once we know there is no signed-in approved teacher. */
  session: Session | null;
  /** A name to show, never the address itself. See `signedInAs`. */
  displayName: string | null;
  loading: boolean;
  /** Set when a sign-in was refused because the email is not approved. */
  rejectedMessage: string | null;
  clearRejected: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [rejectedMessage, setRejectedMessage] = useState<string | null>(null);
  /** Sessions already checked, so a token refresh does not re-check. */
  const approved = useRef<Set<string>>(new Set());

  const vet = useCallback(async (next: Session | null) => {
    if (!next) {
      setSession(null);
      setLoading(false);
      return;
    }

    if (approved.current.has(next.user.id)) {
      setSession(next);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase.rpc('is_allowed_teacher');

    if (error) {
      // Can't tell either way. Treat it as not signed in and say so, rather
      // than letting the teacher into screens whose every query will fail.
      setSession(null);
      setRejectedMessage(S.errors.loadFailed);
      setLoading(false);
      await supabase.auth.signOut();
      return;
    }

    if (data === true) {
      approved.current.add(next.user.id);
      setRejectedMessage(null);
      setSession(next);
      setLoading(false);
      return;
    }

    setSession(null);
    setRejectedMessage(S.signIn.notApproved);
    setLoading(false);
    await supabase.auth.signOut();
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) void vet(data.session);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, next) => {
      if (cancelled) return;
      if (event === 'SIGNED_OUT') {
        approved.current.clear();
        setSession(null);
        setLoading(false);
        return;
      }
      void vet(next);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [vet]);

  const signOut = useCallback(async () => {
    approved.current.clear();
    setRejectedMessage(null);
    await supabase.auth.signOut();
    setSession(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      displayName: signedInAs(session),
      loading,
      rejectedMessage,
      clearRejected: () => setRejectedMessage(null),
      signOut,
    }),
    [session, loading, rejectedMessage, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
