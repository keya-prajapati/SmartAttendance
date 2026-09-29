import { useEffect, useState } from "react";
import { getStoredUser, pick } from "./DashboardShared";
import AdminDashboard from "./AdminDashboard";
import TeacherDashboard from "./TeacherDashboard";
import StudentDashboard from "./StudentDashboard";

/* Chooses the dashboard from the logged-in user's role (UI switch only - the backend enforces
   permissions on every API). Also handles an expired/invalid token (any API call returning 401). */
export default function RoleDashboard(props) {
  const [user, setUser] = useState(getStoredUser);
  const [expired, setExpired] = useState(false);
  const role = String(pick(user, ["role", "userRole"]) ?? "").trim().toLowerCase();

  useEffect(() => {
    const h = () => setExpired(true);
    window.addEventListener("auth-expired", h);
    return () => window.removeEventListener("auth-expired", h);
  }, []);

  const signOut = () => {
    if (props.onLogout) return props.onLogout();
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.reload();
  };

  if (expired) {
    return (
      <div className="dash-blocked" role="alert">
        <h1>Your session has expired</h1>
        <p>For your security you have been signed out. Please log in again to continue.</p>
        <button className="dash-primary-btn" onClick={signOut}>Log in again</button>
      </div>
    );
  }

  const shared = { ...props, user, onUserChange: setUser };
  if (role === "admin") return <AdminDashboard {...shared} />;
  if (role === "teacher") return <TeacherDashboard {...shared} />;
  if (role === "student") return <StudentDashboard {...shared} />;

  return (
    <div className="dash-blocked">
      <h1>We couldn't determine your role</h1>
      <p>Your account has no valid role (Admin, Teacher or Student). Please sign in again or contact the administrator.</p>
      <button className="dash-primary-btn" onClick={signOut}>Back to login</button>
    </div>
  );
}
