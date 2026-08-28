import { useState } from "react";
import Login from "./pages/Login";
import BossDashboard from "./pages/BossDashboard";
import MechanicDashboard from "./pages/MechanicDashboard";
import CustomerDashboard from "./pages/CustomerDashboard";
import WorkspacePage from "./pages/WorkspacePage";
import Profile from "./components/Profile";
import Sidebar from "./components/Sidebar";
import "./style.css";
import "./components/DashboardShell.css";

export default function App() {
	const [user, setUser] = useState<any>(() => {
		const storedUser = localStorage.getItem("user");
		return storedUser ? JSON.parse(storedUser) : null;
	});
	const [active, setActive] = useState("Dashboard");

	const logout = () => {
		localStorage.removeItem("token");
		localStorage.removeItem("user");
		setUser(null);
		setActive("Dashboard");
	};

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

	const dashboard =
		active !== "Dashboard" && active !== "Profile" ? (
			<WorkspacePage title={active} user={user} />
		) : user.role === "boss" ? (
			<BossDashboard u={user} />
		) : user.role === "mechanic" ? (
			<MechanicDashboard u={user} />
		) : (
			<CustomerDashboard u={user} />
		);

	return (
		<div className={`appShell role-${user.role}`}>
			<Sidebar user={user} active={active} onNavigate={setActive} />
			<div className="appMain">
				<Profile user={user} onLogout={logout} />
				{dashboard}
			</div>
		</div>
	);
}
