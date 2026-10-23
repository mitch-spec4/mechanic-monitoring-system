import { useEffect, useState } from "react";
import Login from "./pages/Login";
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
import { go, useRoute } from "./lib/route";
import type { Interval } from "./components/Plans";
import Profile from "./components/Profile";
import Sidebar from "./components/Sidebar";
import { LocationIndicator, ShiftProvider } from "./components/Shift";
import { clearSession, logout as endSession, saveSession, SESSION_EXPIRED_EVENT } from "./services/api";
import "./style.css";
import "./components/DashboardShell.css";
import "./components/Buttons.css";

export default function App() {
	const [user, setUser] = useState<any>(() => {
		const storedUser = localStorage.getItem("user");
		return storedUser ? JSON.parse(storedUser) : null;
	});
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
	const logout = () => {
		endSession();
		signedOut();
		go("/signin");
	};
	const signedIn = (loggedInUser: any) => {
		setUser(loggedInUser);
		setActive("Dashboard");
	};

	useEffect(() => {
		// An ended session goes back to the sign-in page, not the homepage.
		const expired = () => {
			signedOut();
			go("/signin");
		};
		window.addEventListener(SESSION_EXPIRED_EVENT, expired);
		return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
	}, []);

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

	if (!user) {
		if (route.path === "/signin") {
			return (
				<Login
					done={(loggedInUser: any) => {
						signedIn(loggedInUser);
						// "Already using MechanicPro?" on the homepage leads to Billing, with the chosen plan picked out.
						if (route.query.get("next") === "billing" && loggedInUser.role === "boss") {
							setBillingFocus({ plan: route.query.get("plan") || "", interval: route.query.get("interval") === "year" ? "year" : "month" });
							setActive("Billing");
						}
						go("/");
					}}
				/>
			);
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
		return <Home />;
	}

	const dashboard = openJobId ? (
		<JobPage key={openJobId} jobId={openJobId} user={user} onBack={() => setOpenJobId(null)} />
	) : openCustomerId ? (
		<CustomerPage key={openCustomerId} customerId={openCustomerId} onBack={() => setOpenCustomerId(null)} onOpenJob={openJob} />
	) : active === "Billing" && user.role === "boss" ? (
		<BillingPage focus={billingFocus} />
	) : active !== "Dashboard" && active !== "Profile" ? (
		<WorkspacePage title={active} user={user} onOpenJob={openJob} onOpenCustomer={openCustomer} />
	) : user.role === "boss" ? (
		<BossDashboard u={user} onOpenJob={openJob} onOpenCustomer={openCustomer} onOpenBilling={() => navigate("Billing")} />
	) : user.role === "mechanic" ? (
		<MechanicDashboard u={user} onOpenJob={openJob} />
	) : (
		<CustomerDashboard u={user} onOpenJob={openJob} />
	);

	const shell = (
		<div className={`appShell role-${user.role}`}>
			<Sidebar user={user} active={openJobId || openCustomerId ? "" : active} onNavigate={navigate} />
			<div className="appMain">
				<Profile user={user} onLogout={logout} />
				{user.role === "mechanic" && <LocationIndicator />}
				{dashboard}
			</div>
		</div>
	);
	// Mechanics clock in and out; their location is only shared while clocked in.
	return user.role === "mechanic" ? <ShiftProvider key={user.id}>{shell}</ShiftProvider> : shell;
}
