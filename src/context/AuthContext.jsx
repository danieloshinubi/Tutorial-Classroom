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

const AuthContext = createContext(null);

// Every signed-in person, any role, any tenant — a school holds children's
// records, so a session left open on a shared or unattended device is a
// real exposure. 7 minutes with no mouse/keyboard/touch/scroll activity
// anywhere on the page signs them out and sends them back to /Login, the
// same as the session simply having expired.
const INACTIVITY_LIMIT_MS = 7 * 60 * 1000;
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
      loadedForRef.current = data.session?.user?.id ?? null;
      loadProfile(data.session?.user).finally(() => {
        if (active) setLoading(false);
      });
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      const nextId = newSession?.user?.id ?? null;
      setSession(newSession);

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
    if (!session) return undefined;

    let timer;
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
        window.location.href = `/Login?reason=inactivity&from=${from}`;
      });
    };
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(lock, INACTIVITY_LIMIT_MS);
    };

    resetTimer();
    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, resetTimer, { passive: true }));

    return () => {
      clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, resetTimer));
    };
  }, [session]);

  const signUp = useCallback(
    async ({ email, password, firstName, surname, username, role }) => {
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
      signUp,
      signIn,
      signInWithGoogle,
      signOut,
      sendPasswordReset,
      updatePassword,
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
      signUp,
      signIn,
      signInWithGoogle,
      signOut,
      sendPasswordReset,
      updatePassword,
      loadProfile,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthContext;
