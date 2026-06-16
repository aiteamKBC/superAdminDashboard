import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";

export type AuthUser = {
  id: number;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  isStaff: boolean;
  isSuperuser: boolean;
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<AuthUser>;
  loginWithMicrosoftToken: (accessToken: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const authFetch = async (url: string, options: RequestInit = {}) => {
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: "include",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new Error("Cannot connect to the server. Please ensure the backend is running and try again.");
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.detail || "Authentication request failed.");
  }

  return payload;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    try {
      setLoading(true);
      const payload = await authFetch("/api/auth/session/", { method: "GET" });
      setUser(payload?.authenticated ? payload.user : null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const login = useCallback(async (identifier: string, password: string) => {
    const payload = await authFetch("/api/auth/login/", {
      method: "POST",
      body: JSON.stringify({ identifier, password }),
    });
    setUser(payload.user);
    return payload.user as AuthUser;
  }, []);

  const loginWithMicrosoftToken = useCallback(async (accessToken: string) => {
    const payload = await authFetch("/api/auth/microsoft-login/", {
      method: "POST",
      body: JSON.stringify({ accessToken }),
    });
    setUser(payload.user);
    return payload.user as AuthUser;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authFetch("/api/auth/logout/", { method: "POST", body: JSON.stringify({}) });
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, loginWithMicrosoftToken, logout, refreshSession }),
    [user, loading, login, loginWithMicrosoftToken, logout, refreshSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }
  return value;
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8F8F8] text-sm font-semibold text-[#644D93]">
        Loading KBC workspace...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
