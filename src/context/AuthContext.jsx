import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { supabase } from "../lib/supabaseClient";
import { rememberUser } from "../lib/lastUser";

const AuthContext = createContext(null);

// Every signed-in person, any role, any tenant — a school holds children's
// records, so a session left open on a shared or unattended device is a
// real exposure. 10 minutes with no mouse/keyboard/touch/scroll activity
// anywhere on the page signs them out and sends them back to /Login, the
// same as the session simply having expired. (Was 7; raised to 10 because
// it kept interrupting people mid-task — the 30-second warning below still
// comes first.)
//
// That is the default. A school sets its own (School admin → Security,
// schools.idle_lockout_enabled / idle_lockout_minutes, supabase/207):
// SchoolContext hands it over through setIdlePolicy once the school loads.
// The sign-in page is told the minutes in the address, so it quotes the
// number that actually applied.
const DEFAULT_IDLE_POLICY = { enabled: true, minutes: 10 };
// How long the "still there?" warning shows before the sign-out actually
// happens. The limit above is unchanged — this only stops the sign-out being
// a surprise. A bursar part-way through entering a term's fees was being
// dropped with no notice and losing the form; the exposure the limit exists to
// prevent is an UNATTENDED session, and someone sitting there can now say so.
const INACTIVITY_WARNING_MS = 30 * 1000;
const ACTIVITY_EVENTS = ["mousedown", "mousemove", "keydown", "wheel", "touchstart", "scroll"];

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  // Starts true so ProtectedRoute waits for the stored session to be restored
  // instead of bouncing a signed-in user straight back to /Login on refresh.
  const [loading, setLoading] = useState(true);
  // True as soon as the stored session is known — before the profile has
  // loaded. SchoolContext starts on this rather than on `loading`: it needs
  // only the user id, and waiting for the profile first cost a whole extra
  // round trip to the database on every page load.
  const [sessionReady, setSessionReady] = useState(false);
  // Shown for the last 30 seconds before the inactivity sign-out fires.
  const [idleWarning, setIdleWarning] = useState(false);
  const [idlePolicy, setIdlePolicyState] = useState(DEFAULT_IDLE_POLICY);
  const setIdlePolicy = useCallback((next) => {
    const enabled = next?.enabled !== false;
    const minutes = Math.min(240, Math.max(2, Math.round(Number(next?.minutes) || DEFAULT_IDLE_POLICY.minutes)));
    setIdlePolicyState((cur) => (cur.enabled === enabled && cur.minutes === minutes ? cur : { enabled, minutes }));
  }, []);
  // Who the profile currently belongs to, so a token refresh can be told
  // apart from an actual change of person.
  const loadedForRef = useRef(null);
  // One user object per person, reused across token refreshes.
  const userRef = useRef(null);

  const loadProfile = useCallback(async (sessionUser) => {
    if (!sessionUser) {
      setProfile(null);
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", sessionUser.id)
      .maybeSingle();

    if (error) {
      console.error("Could not load profile:", error.message);
      setProfile(null);
      return;
    }

    if (data) {
      setProfile(data);
      return;
    }

    // Signed in with no profile row. That happens to anyone who registered
    // before the handle_new_user() trigger existed, and would otherwise leave
    // them with no role at all. Create it from their auth metadata — the
    // "users insert their own profile" policy allows exactly this, and never
    // with a role above student/tutor.
    const metadata = sessionUser.user_metadata || {};
    const { data: created, error: insertError } = await supabase
      .from("profiles")
      .insert({
        id: sessionUser.id,
        email: sessionUser.email,
        first_name: metadata.first_name || "",
        surname: metadata.surname || "",
        username: metadata.username || null,
        role: metadata.role === "tutor" ? "tutor" : "student",
      })
      .select("*")
      .single();

    if (insertError) {
      console.error("Could not create a profile:", insertError.message);
      setProfile(null);
      return;
    }
    setProfile(created);
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setSessionReady(true);
      loadedForRef.current = data.session?.user?.id ?? null;
      loadProfile(data.session?.user).finally(() => {
        if (active) setLoading(false);
      });
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      const nextId = newSession?.user?.id ?? null;
      // Every way out (the menu, the inactivity timer, another tab) ends here.
      // The AI assistant's saved conversations go with the person, so the
      // next one to sign in on this device never sees them.
      if (event === "SIGNED_OUT") {
        try {
          for (let i = window.sessionStorage.length - 1; i >= 0; i -= 1) {
            const key = window.sessionStorage.key(i);
            if (key && key.startsWith("schoolivio.assistant.")) window.sessionStorage.removeItem(key);
          }
        } catch {
          // Storage unavailable: nothing was saved.
        }
      }
      setSession(newSession);
      rememberUser(nextId);

      // Returning to a tab refreshes the token, which arrives as a brand new
      // session object for the same person. Re-fetching the profile on that
      // would restart every provider below it and wipe whatever the user was
      // half-way through typing, so only reload when the person changes.
      if (nextId !== loadedForRef.current) {
        loadedForRef.current = nextId;
        loadProfile(newSession?.user);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  // Inactivity sign-out. Not signOut() from below — that's declared after
  // this effect and only matters once, so this calls the same Supabase API
  // directly rather than reordering the file around a hook dependency.
  useEffect(() => {
    if (!session || !idlePolicy.enabled) {
      setIdleWarning(false);
      return undefined;
    }
    const limitMs = idlePolicy.minutes * 60 * 1000;

    let timer;
    let warnTimer;
    const lock = () => {
      // A hard navigation (signing out has to be, so the whole app resets)
      // can't carry React Router's location.state the way an in-app link
      // can, so Login.jsx's own redirectTo would fall back to /Dashboard —
      // fine for staff, but an applicant timed out on their own portal
      // would land on the empty member dashboard instead of back on their
      // application. Carrying the path they were actually on as a query
      // param gives Login.jsx the same "from" to redirect to either way.
      const from = encodeURIComponent(window.location.pathname + window.location.search);
      supabase.auth.signOut().finally(() => {
        window.location.href = `/Login?reason=inactivity&mins=${idlePolicy.minutes}&from=${from}`;
      });
    };
    const resetTimer = () => {
      clearTimeout(timer);
      clearTimeout(warnTimer);
      // Any genuine activity — including a mousemove towards the warning
      // itself — means somebody is there, so the warning simply goes away
      // rather than needing to be dismissed.
      setIdleWarning(false);
      warnTimer = setTimeout(
        () => setIdleWarning(true),
        Math.max(0, limitMs - INACTIVITY_WARNING_MS)
      );
      timer = setTimeout(lock, limitMs);
    };

    resetTimer();
    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, resetTimer, { passive: true }));

    return () => {
      clearTimeout(timer);
      clearTimeout(warnTimer);
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, resetTimer));
    };
  }, [session, idlePolicy]);

  const signUp = useCallback(
    async ({ email, password, firstName, surname, username, role, pendingApplicantSchoolId }) => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // Read back by the handle_new_user() trigger to build the profile row.
          data: {
            first_name: firstName,
            surname,
            username,
            role,
            // Set only by /Apply/Account. Lets ApplicantLogin tell "just
            // signed up here as an applicant, hasn't started an application
            // yet" apart from an unrelated account with the same shape (no
            // membership, no applicant_accounts row) at first login, when
            // email confirmation delays the real applicant_accounts row
            // past signup — see ApplicantLogin.jsx.
            pending_applicant_school_id: pendingApplicantSchoolId || null,
          },
        },
      });
      if (error) throw error;
      return data;
    },
    []
  );

  const signIn = useCallback(async ({ email, password }) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  }, []);

  // Redirect flow: Supabase holds the Google client secret, so nothing
  // sensitive lives in this bundle. On the way back, detectSessionInUrl picks
  // the session out of the URL and onAuthStateChange fires.
  const signInWithGoogle = useCallback(async (redirectPath = "/Dashboard") => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}${redirectPath}`,
      },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const sendPasswordReset = useCallback(async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/Reset-Password`,
    });
    if (error) throw error;
  }, []);

  const updatePassword = useCallback(async (password) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
  }, []);

  // Stable while it is the same person signed in. See the note above
  // loadedForRef: this is what stops a tab switch from remounting the app.
  const user = useMemo(() => {
    const next = session?.user ?? null;
    if (next && userRef.current && userRef.current.id === next.id) {
      return userRef.current;
    }
    userRef.current = next;
    return next;
  }, [session]);

  const value = useMemo(
    () => ({
      session,
      user,
      profile,
      loading,
      sessionReady,
      signUp,
      signIn,
      signInWithGoogle,
      signOut,
      sendPasswordReset,
      updatePassword,
      setIdlePolicy,
      refreshProfile: () => {
        loadedForRef.current = user?.id ?? null;
        return loadProfile(user);
      },
    }),
    [
      session,
      user,
      profile,
      loading,
      sessionReady,
      signUp,
      signIn,
      signInWithGoogle,
      signOut,
      sendPasswordReset,
      updatePassword,
      setIdlePolicy,
      loadProfile,
    ]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {/* Deliberately not the shared Modal or confirmDialog: this has to be
          able to dismiss ITSELF the moment any activity is detected, which a
          promise-based dialog awaiting a button press cannot do. It is also
          rendered by the auth provider, which sits above most of the app, so
          keeping it self-contained avoids dragging UI imports down here. */}
      {idleWarning ? (
        <div className="idle-warning" role="alertdialog" aria-live="assertive">
          <strong>{"Still there?"}</strong>
          <span>
            {"You'll be signed out shortly because the screen has been idle. Move the mouse or press a key to stay signed in."}
          </span>
        </div>
      ) : null}
    </AuthContext.Provider>
  );
};

export default AuthContext;
