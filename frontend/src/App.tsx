import { useEffect, useState } from "react";
import Login from "./pages/Login";
import BossDashboard from "./pages/BossDashboard";
import MechanicDashboard from "./pages/MechanicDashboard";
import CustomerDashboard from "./pages/CustomerDashboard";
import WorkspacePage from "./pages/WorkspacePage";
import JobPage from "./pages/JobPage";
import Profile from "./components/Profile";
import Sidebar from "./components/Sidebar";
import { clearSession, logout as endSession, SESSION_EXPIRED_EVENT } from "./services/api";
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
	const navigate = (label: string) => {
		setOpenJobId(null);
		setActive(label);
	};
	const openJob = (id: number) => {
		setOpenJobId(id);
		window.scrollTo({ top: 0 });
	};

	const signedOut = () => {
		clearSession();
		setUser(null);
		setOpenJobId(null);
		setActive("Dashboard");
	};
	const logout = () => {
		endSession();
		signedOut();
	};

	useEffect(() => {
		window.addEventListener(SESSION_EXPIRED_EVENT, signedOut);
		return () => window.removeEventListener(SESSION_EXPIRED_EVENT, signedOut);
	}, []);

	if (!user) {
		return (
			<Login
				done={(loggedInUser: any) => {
					setUser(loggedInUser);
					setActive("Dashboard");
				}}
			/>
		);
	}

	const dashboard = openJobId ? (
		<JobPage key={openJobId} jobId={openJobId} user={user} onBack={() => setOpenJobId(null)} />
	) : active !== "Dashboard" && active !== "Profile" ? (
		<WorkspacePage title={active} user={user} onOpenJob={openJob} />
	) : user.role === "boss" ? (
		<BossDashboard u={user} onOpenJob={openJob} />
	) : user.role === "mechanic" ? (
		<MechanicDashboard u={user} onOpenJob={openJob} />
	) : (
		<CustomerDashboard u={user} onOpenJob={openJob} />
	);

	return (
		<div className={`appShell role-${user.role}`}>
			<Sidebar user={user} active={openJobId ? "" : active} onNavigate={navigate} />
			<div className="appMain">
				<Profile user={user} onLogout={logout} />
				{dashboard}
			</div>
		</div>
	);
}
