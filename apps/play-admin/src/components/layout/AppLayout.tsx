import { NavLink, useNavigate } from "react-router-dom";
import { ThemeToggle } from "../ThemeToggle";
import { Button } from "../ui/button";
import {
  Library,
  Music,
  Users,
  Shield,
  LayoutDashboard,
  LogOut,
} from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { cn } from "../../lib/utils";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/songs", label: "Songs", icon: Music },
  { to: "/albums", label: "Albums", icon: Library },
  { to: "/artists", label: "Artistes", icon: Users },
  { to: "/users", label: "Utilisateurs", icon: Users },
  { to: "/roles", label: "Rôles & Droits", icon: Shield },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const onLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };
  return (
    <div className="grid min-h-screen md:grid-cols-[220px_1fr]">
      <aside className="hidden border-r bg-card md:block">
        <div className="p-4 text-lg font-semibold">PyramidPlay</div>
        <nav className="px-2 space-y-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted",
                  isActive && "bg-muted",
                )
              }
              end={to === "/"}
            >
              <Icon className="h-4 w-4" /> <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex flex-col">
        <header className="flex h-14 items-center justify-between gap-2 border-b px-4">
          <div className="md:hidden font-semibold">PyramidPlay</div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <div className="text-sm text-muted-foreground hidden sm:block">
              {user?.email}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onLogout}
              aria-label="Se déconnecter"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
