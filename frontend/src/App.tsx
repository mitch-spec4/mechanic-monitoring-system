import { useEffect, useLayoutEffect, useState } from "react";
import Login from "./pages/Login";
import VerifyEmail from "./pages/VerifyEmail";
import BossDashboard from "./pages/BossDashboard";
import MechanicDashboard from "./pages/MechanicDashboard";
import CustomerDashboard from "./pages/CustomerDashboard";
import WorkspacePage from "./pages/WorkspacePage";
import JobPage from "./pages/JobPage";
import CustomerPage from "./pages/CustomerPage";
import RequestPage from "./pages/RequestPage";
import EquipmentPage from "./pages/EquipmentPage";
import Home from "./pages/Home";
import Signup from "./pages/Signup";
import Checkout from "./pages/Checkout";
import BillingPage from "./pages/BillingPage";
import { go, openCheckout, readRoute, useRoute } from "./lib/route";
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
import PlanBanner from "./components/PlanBanner";
import { clearSession, logout as endSession, me, saveSession, SESSION_EXPIRED_EVENT, TWO_FACTOR_SETUP_EVENT, type User } from "./services/api";
import { setCurrency, setTimeZone, setUnits } from "./lib/format";
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

// Links into the signed-in app, sent in emails.
const APP_LINK = /^\/(requests\/\d+|equipment\/\d+|messages|billing)$/;

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
    setCurrency(user.currency);
    if (user.language) setLanguage(user.language);
  }, [user?.language, user?.timezone, user?.units, user?.currency]);
  // Technicians work offline too: their changes wait on the phone (see src/offline/).
  useEffect(() => {
    if (user?.role === "mechanic") void startOffline(user);
    else void stopOffline({ wipe: false });
  }, [user?.id, user?.role]);
  const [active, setActive] = useState("Dashboard");
  const [openJobId, setOpenJobId] = useState<number | null>(null);
  const [openCustomerId, setOpenCustomerId] = useState<number | null>(null);
  const [openRequestId, setOpenRequestId] = useState<number | null>(null);
  const [openMachineId, setOpenMachineId] = useState<number | null>(null);
  // The job the equipment was opened from, which Back returns to.
  const [machineFromJob, setMachineFromJob] = useState<number | null>(null);
  // The customer whose chat Messages opens on (managers).
  const [chatCustomerId, setChatCustomerId] = useState<number | null>(null);
  const [billingFocus, setBillingFocus] = useState<{ plan: string; interval: Interval }>();
  // Back from the payment provider's page ("/billing?paid=<reference>"): the payment to confirm.
  const [paidReference, setPaidReference] = useState<string>();
  const route = useRoute();
  const navigate = (label: string) => {
    setOpenJobId(null);
    setOpenCustomerId(null);
    setOpenRequestId(null);
    setOpenMachineId(null);
    setChatCustomerId(null);
    setBillingFocus(undefined);
    setActive(label);
  };
  const openRequest = (id: number) => {
    setOpenJobId(null);
    setOpenCustomerId(null);
    setOpenMachineId(null);
    setOpenRequestId(id);
    window.scrollTo({ top: 0 });
  };
  const openMessages = (customerId?: number) => {
    navigate("Messages");
    setChatCustomerId(customerId ?? null);
  };
  const openCustomer = (id: number) => {
    setOpenMachineId(null);
    setOpenCustomerId(id);
    window.scrollTo({ top: 0 });
  };
  // Over the customer or request it was opened from, so Back returns there (or to the job).
  const openMachine = (id: number) => {
    setMachineFromJob(openJobId);
    setOpenJobId(null);
    setOpenMachineId(id);
    window.scrollTo({ top: 0 });
  };
  const closeMachine = () => {
    setOpenMachineId(null);
    setOpenJobId(machineFromJob);
    setMachineFromJob(null);
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
    setOpenRequestId(null);
    setOpenMachineId(null);
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
    setOpenRequestId(null);
    setOpenMachineId(null);
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
    // A link from an email (a request, the chat) opens once signed in.
    go(next.startsWith("/checkout/") ? next : APP_LINK.test(route.path) ? route.path : "/");
  };

  // Links from emails: "/requests/12" opens that request, "/equipment/4" that equipment, "/messages"
  // the chat, "/billing" (managers) the Billing page.
  useEffect(() => {
    if (!user || !APP_LINK.test(route.path)) return;
    const request = /^\/requests\/(\d+)$/.exec(route.path);
    const machine = /^\/equipment\/(\d+)$/.exec(route.path);
    if (route.path === "/billing") {
      if (user.role === "boss") {
        navigate("Billing");
        setPaidReference(route.query.get("paid") || undefined);
      }
    } else if (request) openRequest(Number(request[1]));
    else if (machine) {
      navigate("Dashboard");
      openMachine(Number(machine[1]));
    } else openMessages();
    go("/");
  }, [user?.id, route.path]);

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

  // The saved profile is brought up to date once a session starts (the plan may have changed).
  useEffect(() => {
    if (!user) return;
    me()
      .then((data) => updateUser(data.user))
      .catch(() => {});
  }, [user?.id]);

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
    if (route.path === "/signin" || APP_LINK.test(route.path)) {
      return <Login done={afterLogin} />;
    }
    if (route.path === "/signup") {
      return (
        <Signup
          query={route.query}
          onSignedIn={(newUser, checkoutUrl) => {
            saveSession(newUser);
            signedIn(newUser);
            if (checkoutUrl) openCheckout(checkoutUrl);
            else go("/");
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
    <JobPage key={openJobId} jobId={openJobId} user={user} onBack={() => setOpenJobId(null)} onOpenMachine={openMachine} />
  ) : openMachineId ? (
    <EquipmentPage
      key={openMachineId}
      machineId={openMachineId}
      user={user}
      onBack={closeMachine}
      onOpenJob={openJob}
      onOpenCustomer={user.role === "boss" ? openCustomer : undefined}
    />
  ) : openCustomerId ? (
    <CustomerPage key={openCustomerId} customerId={openCustomerId} onBack={() => setOpenCustomerId(null)} onOpenJob={openJob} onOpenMachine={openMachine} />
  ) : openRequestId ? (
    <RequestPage
      key={openRequestId}
      requestId={openRequestId}
      user={user}
      onBack={() => setOpenRequestId(null)}
      onOpenJob={openJob}
      onOpenMachine={openMachine}
      onOpenMessages={openMessages}
    />
  ) : active === "Billing" && user.role === "boss" ? (
    <BillingPage focus={billingFocus} paid={paidReference} onUserChanged={updateUser} />
  ) : active !== "Dashboard" && active !== "Profile" ? (
    <WorkspacePage
      title={active}
      user={user}
      onOpenJob={openJob}
      onOpenCustomer={openCustomer}
      onOpenRequest={openRequest}
      onOpenMachine={openMachine}
      chatCustomerId={chatCustomerId}
      onUserChanged={updateUser}
    />
  ) : user.role === "boss" ? (
    <BossDashboard
      u={user}
      onOpenJob={openJob}
      onOpenCustomer={openCustomer}
      onOpenRequest={openRequest}
      onUserChanged={updateUser}
    />
  ) : user.role === "mechanic" ? (
    <MechanicDashboard u={user} onOpenJob={openJob} />
  ) : (
    <CustomerDashboard u={user} onOpenJob={openJob} onOpenRequest={openRequest} onOpenMachine={openMachine} onOpenMessages={() => openMessages()} />
  );

  const shell = (
    <div className={`appShell role-${user.role}${user.demo_until ? " hasDemoBar" : ""}`}>
      <button className="skipLink" onClick={() => document.getElementById("content")?.focus()}>
        {t("Skip to content")}
      </button>
      <Sidebar user={user} active={openJobId || openCustomerId || openRequestId || openMachineId ? "" : active} onNavigate={navigate} />
      {user.role === "mechanic" && <BottomNav active={openJobId || openMachineId ? "" : active} onNavigate={navigate} />}
      <div className="appMain">
        <div className="topBar">
          <LanguageMenu user={user} onUserChanged={updateUser} />
          <Profile user={user} onLogout={logout} />
        </div>
        <DeletionBanner user={user} onUserChanged={updateUser} />
        {user.role === "boss" && active !== "Billing" && <PlanBanner subscription={user.subscription} />}
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
