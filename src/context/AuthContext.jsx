import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase } from "../lib/supabaseClient";

const AuthContext = createContext(null);

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
      loadProfile(data.session?.user).finally(() => {
        if (active) setLoading(false);
      });
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      loadProfile(newSession?.user);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

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

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      signUp,
      signIn,
      signInWithGoogle,
      signOut,
      sendPasswordReset,
      updatePassword,
      refreshProfile: () => loadProfile(session?.user),
    }),
    [
      session,
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
