import { createBrowserRouter, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import { useAuth } from "./auth/AuthContext";
import AppLayout from "./components/layout/AppLayout";
import Songs from "./pages/Songs";
import Albums from "./pages/Albums";
import Users from "./pages/Users";
import Roles from "./pages/Roles";
import SetupSuperAdmin from "./pages/SetupSuperAdmin";
import Artists from "./pages/Artists";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";

function Protected({ children }: { children: React.ReactNode }) {
  const { token, loading } = useAuth();
  if (loading) return null;
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RootLayout({ children }: { children: React.ReactNode }) {
  return <AppLayout>{children}</AppLayout>;
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <RootLayout>
        <Protected>
          <Dashboard />
        </Protected>
      </RootLayout>
    ),
  },
  {
    path: "/login",
    element: <Login />,
  },
  {
    path: "/forgot-password",
    element: <ForgotPassword />,
  },
  {
    path: "/reset-password",
    element: <ResetPassword />,
  },
  {
    path: "/setup",
    element: <SetupSuperAdmin />,
  },
  {
    path: "/songs",
    element: (
      <RootLayout>
        <Protected>
          <Songs />
        </Protected>
      </RootLayout>
    ),
  },
  {
    path: "/albums",
    element: (
      <RootLayout>
        <Protected>
          <Albums />
        </Protected>
      </RootLayout>
    ),
  },
  {
    path: "/users",
    element: (
      <RootLayout>
        <Protected>
          <Users />
        </Protected>
      </RootLayout>
    ),
  },
  {
    path: "/artists",
    element: (
      <RootLayout>
        <Protected>
          <Artists />
        </Protected>
      </RootLayout>
    ),
  },
  {
    path: "/roles",
    element: (
      <RootLayout>
        <Protected>
          <Roles />
        </Protected>
      </RootLayout>
    ),
  },
]);
