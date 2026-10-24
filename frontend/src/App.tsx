import { useEffect, useLayoutEffect, useState } from "react";
import Login from "./pages/Login";
import VerifyEmail from "./pages/VerifyEmail";
import BossDashboard from "./pages/BossDashboard";
import MechanicDashboard from "./pages/MechanicDashboard";
import CustomerDashboard from "./pages/CustomerDashboard";
import WorkspacePage from "./pages/WorkspacePage";
import JobPage from "./pages/JobPage";
import CustomerPage from "./pages/CustomerPage";
import Home from "./pages/Home";
import Signup from "./pages/Signup";
import Checkout from "./pages/Checkout";
import BillingPage from "./pages/BillingPage";
import { go, readRoute, useRoute } from "./lib/route";
import type { Interval } from "./components/Plans";
import Profile from "./components/Profile";
import Sidebar from "./components/Sidebar";
import DemoBar from "./components/DemoBar";
import LanguageMenu from "./components/LanguageMenu";
import BottomNav from "./components/BottomNav";
import { LocationIndicator, ShiftProvider } from "./components/Shift";
import { confirmAction, FeedbackHost } from "./components/Feedback";
import { OfflineNotice, SyncPill, UpdateBanner } from "./components/Offline";
import { startOffline, stopOffline, unsynced } from "./offline";
import { LegalPage } from "./components/Legal";
import TwoFactorSetupPage from "./components/TwoFactor";
import { DeletionBanner } from "./components/CompanyData";
import { clearSession, logout as endSession, me, saveSession, SESSION_EXPIRED_EVENT, TWO_FACTOR_SETUP_EVENT, type User } from "./services/api";
import { setTimeZone, setUnits } from "./lib/format";
import { LANGUAGE_CHANGED_EVENT, setLanguage, t } from "./i18n";
import "./style.css";
import "./components/DashboardShell.css";
import "./components/Buttons.css";
// Last, so the look of the app sits on top of each page's layout.
import "./styles/bold.css";

export default function App() {
  return (
    <>
      <Screens />
      <FeedbackHost />
    </>
  );
}

function storedUser(): User | null {
  try {
    const stored = localStorage.getItem("user");
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function Screens() {
  const [user, setUser] = useState<User | null>(storedUser);
  // Switching language re-renders the whole app (nothing below is memoised), keeping the page that's open.
  const [, setLanguageVersion] = useState(0);
  useEffect(() => {
    const changed = () => setLanguageVersion((version) => version + 1);
    window.addEventListener(LANGUAGE_CHANGED_EVENT, changed);
    return () => window.removeEventListener(LANGUAGE_CHANGED_EVENT, changed);
  }, []);
  // A signed-in person sees the app in their account's language, and times on the company's clock.
  useLayoutEffect(() => {
    if (!user) return;
    setTimeZone(user.timezone);
    setUnits(user.units);
    if (user.language) setLanguage(user.language);
  }, [user?.language, user?.timezone, user?.units]);
  // Technicians work offline too: their changes wait on the phone (see src/offline/).
  useEffect(() => {
    if (user?.role === "mechanic") void startOffline(user);
    else void stopOffline({ wipe: false });
  }, [user?.id, user?.role]);
  const [active, setActive] = useState("Dashboard");
  const [openJobId, setOpenJobId] = useState<number | null>(null);
  const [openCustomerId, setOpenCustomerId] = useState<number | null>(null);
  const [billingFocus, setBillingFocus] = useState<{ plan: string; interval: Interval }>();
  const route = useRoute();
  const navigate = (label: string) => {
    setOpenJobId(null);
    setOpenCustomerId(null);
    setBillingFocus(undefined);
    setActive(label);
  };
  const openCustomer = (id: number) => {
    setOpenCustomerId(id);
    window.scrollTo({ top: 0 });
  };
  const openJob = (id: number) => {
    setOpenJobId(id);
    window.scrollTo({ top: 0 });
  };

  const signedOut = () => {
    clearSession();
    setUser(null);
    setOpenJobId(null);
    setOpenCustomerId(null);
    setActive("Dashboard");
  };
  const logout = async () => {
    // Changes that haven't reached the server live only on this phone: signing out deletes them.
    const waiting = user?.role === "mechanic" ? unsynced() : 0;
    if (
      waiting &&
      !(await confirmAction({
        title: waiting === 1 ? t("1 change hasn't synced") : t("{count} changes haven't synced", { count: waiting }),
        message:
          waiting === 1
            ? t("It's saved only on this phone, and signing out deletes it. Connect to the internet and wait until it says All synced.")
            : t("They're saved only on this phone, and signing out deletes them. Connect to the internet and wait until it says All synced."),
        confirmLabel: t("Sign out anyway"),
        cancelLabel: t("Stay signed in"),
        danger: true,
      }))
    )
      return;
    endSession();
    await stopOffline({ wipe: true });
    signedOut();
    go("/signin");
  };
  const signedIn = (loggedInUser: User) => {
    setUser(loggedInUser);
    setOpenJobId(null);
    setOpenCustomerId(null);
    setActive("Dashboard");
  };
  // The profile kept for reloads changes too, e.g. once the email address is confirmed.
  const updateUser = (changed: User) => {
    saveSession(changed);
    setUser(changed);
  };
  const afterLogin = (loggedInUser: User) => {
    signedIn(loggedInUser);
    const next = route.query.get("next") || "";
    // "Already using MechanicPro?" on the homepage leads to Billing, with the chosen plan picked out.
    if (next === "billing" && loggedInUser.role === "boss") {
      setBillingFocus({ plan: route.query.get("plan") || "", interval: route.query.get("interval") === "year" ? "year" : "month" });
      setActive("Billing");
    }
    go(next.startsWith("/checkout/") ? next : "/");
  };

  useEffect(() => {
    // An ended session goes back to the sign-in page, not the homepage; a checkout is kept.
    const expired = () => {
      signedOut();
      const { path } = readRoute();
      go(path.startsWith("/checkout/") ? `/signin?next=${encodeURIComponent(path)}` : "/signin");
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  }, []);

  // The server asked for two-step sign-in to be set up first (e.g. a manager reset it): reload
  // the profile, which brings up the setup screen.
  useEffect(() => {
    const setupNeeded = () =>
      me()
        .then((data) => updateUser(data.user))
        .catch(() => {});
    window.addEventListener(TWO_FACTOR_SETUP_EVENT, setupNeeded);
    return () => window.removeEventListener(TWO_FACTOR_SETUP_EVENT, setupNeeded);
  }, []);

  // The privacy policy and terms are open to everyone, signed in or not.
  if (route.path === "/privacy" || route.path === "/terms") {
    return <LegalPage key={route.path} name={route.path === "/privacy" ? "privacy" : "terms"} />;
  }

  // Two-step sign-in comes before anything else in the app, paying for a plan included.
  if (user?.two_factor_setup_needed && !["/verify", "/join", "/reset"].includes(route.path)) {
    return <TwoFactorSetupPage onDone={updateUser} onLogout={logout} />;
  }

  // Paying for a plan happens on its own page, after signup or from Billing.
  if (route.path.startsWith("/checkout/")) {
    return (
      <Checkout
        reference={route.path.slice("/checkout/".length)}
        user={user}
        onDone={() => {
          go("/");
          navigate("Billing");
        }}
      />
    );
  }

  // Links from emails work whether or not someone is signed in on this browser.
  if (route.path === "/verify") {
    return <VerifyEmail token={route.query.get("token") || ""} user={user} onVerified={updateUser} />;
  }
  if (route.path === "/join" || route.path === "/reset") {
    return (
      <Login
        key={route.path}
        mode={route.path === "/join" ? "invite" : "link"}
        code={route.query.get("code") || ""}
        email={route.query.get("email") || ""}
        token={route.query.get("token") || ""}
        done={afterLogin}
      />
    );
  }

  if (!user) {
    if (route.path === "/signin") {
      return <Login done={afterLogin} />;
    }
    if (route.path === "/signup") {
      return (
        <Signup
          query={route.query}
          onSignedIn={(newUser, checkoutUrl) => {
            saveSession(newUser);
            signedIn(newUser);
            go(checkoutUrl || "/");
          }}
        />
      );
    }
    return (
      <Home
        onDemo={(demoUser) => {
          saveSession(demoUser);
          signedIn(demoUser);
          go("/");
        }}
      />
    );
  }

  const dashboard = openJobId ? (
    <JobPage key={openJobId} jobId={openJobId} user={user} onBack={() => setOpenJobId(null)} />
  ) : openCustomerId ? (
    <CustomerPage key={openCustomerId} customerId={openCustomerId} onBack={() => setOpenCustomerId(null)} onOpenJob={openJob} />
  ) : active === "Billing" && user.role === "boss" ? (
    <BillingPage focus={billingFocus} />
  ) : active !== "Dashboard" && active !== "Profile" ? (
    <WorkspacePage title={active} user={user} onOpenJob={openJob} onOpenCustomer={openCustomer} onUserChanged={updateUser} />
  ) : user.role === "boss" ? (
    <BossDashboard u={user} onOpenJob={openJob} onOpenCustomer={openCustomer} onOpenBilling={() => navigate("Billing")} onUserChanged={updateUser} />
  ) : user.role === "mechanic" ? (
    <MechanicDashboard u={user} onOpenJob={openJob} />
  ) : (
    <CustomerDashboard u={user} onOpenJob={openJob} />
  );

  const shell = (
    <div className={`appShell role-${user.role}${user.demo_until ? " hasDemoBar" : ""}`}>
      <button className="skipLink" onClick={() => document.getElementById("content")?.focus()}>
        {t("Skip to content")}
      </button>
      <Sidebar user={user} active={openJobId || openCustomerId ? "" : active} onNavigate={navigate} />
      {user.role === "mechanic" && <BottomNav active={openJobId ? "" : active} onNavigate={navigate} />}
      <div className="appMain">
        <div className="topBar">
          <LanguageMenu user={user} onUserChanged={updateUser} />
          <Profile user={user} onLogout={logout} />
        </div>
        <DeletionBanner user={user} onUserChanged={updateUser} />
        {user.role === "mechanic" && <LocationIndicator />}
        {user.role === "mechanic" && <SyncPill />}
        <UpdateBanner />
        <OfflineNotice />
        <div id="content" tabIndex={-1}>
          {dashboard}
        </div>
        {user.demo_until && (
          <DemoBar
            user={user}
            onSwitched={(demoUser) => {
              saveSession(demoUser);
              signedIn(demoUser);
            }}
            onLeave={() => {
              endSession();
              void stopOffline({ wipe: true });
              signedOut();
              go("/signup");
            }}
          />
        )}
      </div>
    </div>
  );
  // Mechanics clock in and out; their location is only shared while clocked in.
  return user.role === "mechanic" ? <ShiftProvider key={user.id}>{shell}</ShiftProvider> : shell;
}
