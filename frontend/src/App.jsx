import { useEffect, useState } from "react";

import {
  GraduationCap,
  ShieldCheck,
  BarChart3,
  Bell,
  Users,
  ClipboardCheck,
  ArrowRight,
  Menu,
  X,
  Sun,
  Moon,
  LogIn,
  UserPlus,
  Lock,
  Phone,
  User,
  Eye,
  EyeOff,
} from "lucide-react";

/* DASHBOARD: role ke hisab se Admin / Teacher / Student dashboard kholta hai */
import RoleDashboard from "./dashboard/RoleDashboardPage";

import "./App.css";

const API_URL = "http://localhost:5000";

/* =========================================================
   DEMO LANDING PAGE DATA
   (sirf landing page ke preview card ke liye.
    Real dashboards isse use nahi karte, wo backend se data lete hain.)
========================================================= */

const INITIAL_STUDENTS = [
  {
    id: 1,
    name: "Rahul Sharma",
    cls: "Class 10 - A",
    present: true,
  },
  {
    id: 2,
    name: "Priya Patel",
    cls: "Class 10 - A",
    present: false,
  },
  {
    id: 3,
    name: "Aarav Shah",
    cls: "Class 10 - A",
    present: true,
  },
  {
    id: 4,
    name: "Diya Mehta",
    cls: "Class 10 - B",
    present: true,
  },
  {
    id: 5,
    name: "Kabir Joshi",
    cls: "Class 10 - B",
    present: true,
  },
  {
    id: 6,
    name: "Ananya Desai",
    cls: "Class 9 - A",
    present: true,
  },
  {
    id: 7,
    name: "Vihaan Trivedi",
    cls: "Class 9 - A",
    present: false,
  },
  {
    id: 8,
    name: "Isha Parmar",
    cls: "Class 9 - B",
    present: true,
  },
  {
    id: 9,
    name: "Yash Solanki",
    cls: "Class 9 - B",
    present: true,
  },
  {
    id: 10,
    name: "Riya Chauhan",
    cls: "Class 8 - A",
    present: true,
  },
];

/* =========================================================
   DATE
========================================================= */

const today = new Date();

const TODAY_KEY = today.toLocaleDateString("en-CA");

const DATE_LABEL = today.toLocaleDateString("en-IN", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

/* =========================================================
   HELPERS
========================================================= */

function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) {
    return "Good Morning";
  }

  if (hour < 17) {
    return "Good Afternoon";
  }

  return "Good Evening";
}

function getInitials(name) {
  if (!name) return "U";

  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getInitialTheme() {
  try {
    const saved = localStorage.getItem("theme");

    if (saved === "light" || saved === "dark") {
      return saved;
    }
  } catch {
    // ignore
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function loadStudents() {
  try {
    const saved = JSON.parse(
      localStorage.getItem(`attendance-${TODAY_KEY}`)
    );

    if (Array.isArray(saved)) {
      return saved;
    }
  } catch {
    // ignore
  }

  return INITIAL_STUDENTS;
}

/* DASHBOARD: page refresh ke baad bhi user logged-in rahe */
function getSavedUser() {
  try {
    const token = localStorage.getItem("token");

    const user = JSON.parse(
      localStorage.getItem("user")
    );

    return token && user ? user : null;
  } catch {
    return null;
  }
}

/* =========================================================
   APP
========================================================= */

function App() {
  /* ---------- Landing page ---------- */

  const [menuOpen, setMenuOpen] = useState(false);

  const [theme, setTheme] = useState(getInitialTheme);

  const [students, setStudents] = useState(loadStudents);

  const [showAll, setShowAll] = useState(false);

  /* ---------- DASHBOARD: logged-in user ---------- */

  const [user, setUser] = useState(getSavedUser);

  /* ---------- Authentication ---------- */

  const [authPage, setAuthPage] = useState(null);

  const [authLoading, setAuthLoading] = useState(false);

  const [authError, setAuthError] = useState("");

  const [authSuccess, setAuthSuccess] = useState("");

  const [showPassword, setShowPassword] = useState(false);

  /* ---------- Login ---------- */

  const [loginData, setLoginData] = useState({
    username: "",
    password: "",
    role: "Teacher",
  });

  /* ---------- Register ---------- */

  const [registerData, setRegisterData] = useState({
    fullName: "",
    username: "",
    password: "",
    role: "Teacher",
    phone: "",
  });

  /* =========================================================
     THEME
  ========================================================= */

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(
      "(prefers-color-scheme: dark)"
    );

    const handleChange = (event) => {
      if (!localStorage.getItem("theme")) {
        setTheme(event.matches ? "dark" : "light");
      }
    };

    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  /* =========================================================
     LOCAL DEMO ATTENDANCE
  ========================================================= */

  useEffect(() => {
    try {
      localStorage.setItem(
        `attendance-${TODAY_KEY}`,
        JSON.stringify(students)
      );
    } catch {
      // ignore
    }
  }, [students]);

  /* =========================================================
     THEME TOGGLE
  ========================================================= */

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";

    setTheme(nextTheme);

    try {
      localStorage.setItem("theme", nextTheme);
    } catch {
      // ignore
    }
  };

  /* =========================================================
     DEMO ATTENDANCE TOGGLE
  ========================================================= */

  const toggleAttendance = (id) => {
    setStudents((list) =>
      list.map((student) =>
        student.id === id
          ? {
              ...student,
              present: !student.present,
            }
          : student
      )
    );
  };

  /* =========================================================
     ATTENDANCE STATS
  ========================================================= */

  const total = students.length;

  const presentCount = students.filter(
    (student) => student.present
  ).length;

  const absentCount = total - presentCount;

  const percent = total
    ? ((presentCount / total) * 100).toFixed(1)
    : "0.0";

  const visibleStudents = showAll
    ? students
    : students.slice(0, 4);

  /* =========================================================
     OPEN AUTH
  ========================================================= */

  const openLogin = () => {
    setAuthPage("login");

    setAuthError("");

    setAuthSuccess("");

    setShowPassword(false);

    setMenuOpen(false);
  };

  const openRegister = () => {
    setAuthPage("register");

    setAuthError("");

    setAuthSuccess("");

    setShowPassword(false);

    setMenuOpen(false);
  };

  const closeAuth = () => {
    setAuthPage(null);

    setAuthError("");

    setAuthSuccess("");

    setShowPassword(false);
  };

  /* =========================================================
     LOGIN API
  ========================================================= */

  const handleLogin = async (event) => {
  event.preventDefault();

  setAuthError("");
  setAuthSuccess("");
  setAuthLoading(true);
try {
  const loginPayload = {
    username: loginData.username.trim(),
    password: loginData.password,
    role: loginData.role.trim(),
  };

  console.log("LOGIN DATA:", {
    username: loginPayload.username,
    passwordLength: loginPayload.password.length,
    role: loginPayload.role,
  });

  const response = await fetch(
    `${API_URL}/api/auth/login`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(loginPayload),
    }
  );

  const data = await response.json();

  console.log("LOGIN RESPONSE:", data);

  if (!response.ok) {
    throw new Error(
      data.message || "Login failed."
    );
  }

  if (
    data.user?.role &&
    String(data.user.role).toLowerCase() !==
      loginPayload.role.toLowerCase()
  ) {
    throw new Error(
      `This account is not registered as ${loginPayload.role}.`
    );
  }

  localStorage.setItem("token", data.token);

  localStorage.setItem(
    "user",
    JSON.stringify(data.user)
  );

  console.log("Login successful:", data.user);

  setLoginData({
    username: "",
    password: "",
    role: loginPayload.role,
  });
    closeAuth();
    setUser(data.user);

  } catch (error) {
    console.error("Login error:", error);

    setAuthError(
      error.message || "Unable to login."
    );
  } finally {
    setAuthLoading(false);
  }
};
  /* =========================================================
     REGISTER API
  ========================================================= */

  const handleRegister = async (event) => {
    event.preventDefault();

    setAuthError("");

    setAuthSuccess("");

    setAuthLoading(true);

    try {
      const response = await fetch(
        `${API_URL}/api/auth/register`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify(
            registerData
          ),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            "Registration failed."
        );
      }

      setAuthSuccess(
        "Registration successful! Please login."
      );

      /* Clear form */

      setRegisterData({
        fullName: "",
        username: "",
        password: "",
        role: "Teacher",
        phone: "",
      });

      /* Open login after 1 sec */

      setTimeout(() => {
        setAuthPage("login");

        setAuthSuccess(
          "Registration successful. Please login."
        );
      }, 1000);
    } catch (error) {
      console.error(
        "Registration error:",
        error
      );

      setAuthError(
        error.message ||
          "Unable to register."
      );
    } finally {
      setAuthLoading(false);
    }
  };

  /* =========================================================
     DASHBOARD: LOGOUT
  ========================================================= */

  const handleLogout = () => {
    localStorage.removeItem("token");

    localStorage.removeItem("user");

    setUser(null);
  };

  /* =========================================================
     DASHBOARD: LOGGED-IN USER -> ROLE BASED DASHBOARD

     Admin   -> AdminDashboard
     Teacher -> TeacherDashboard
     Student -> StudentDashboard

     (RoleDashboard khud user.role padhkar sahi dashboard chunta hai.)

     IMPORTANT: ye hamesha saare hooks ke BAAD
     aur main return se PEHLE hona chahiye.
  ========================================================= */

  if (user) {
    return (
      <RoleDashboard
        onLogout={handleLogout}
      />
    );
  }

  /* =========================================================
     RETURN  (LANDING PAGE)
  ========================================================= */

  return (
    <div className="app">

      {/* =====================================================
          AUTH MODAL
      ===================================================== */}

      {authPage && (
        <div className="auth-overlay">

          <div className="auth-box">

            {/* Close */}

            <button
              className="auth-close"
              onClick={closeAuth}
              type="button"
            >
              <X size={20} />
            </button>

            {/* Logo */}

            <div className="auth-logo">
              <div className="brand-icon">
                <GraduationCap
                  size={26}
                />
              </div>
            </div>

            {/* =================================================
                LOGIN
            ================================================= */}

            {authPage === "login" ? (
              <>
                <div className="auth-heading">

                  <span className="auth-small-title">
                    SMARTATTENDANCE
                  </span>

                  <h2>
                    Welcome back
                  </h2>

                  <p>
                    Sign in to continue to
                    your account
                  </p>

                </div>

                <form
                  onSubmit={handleLogin}
                  className="auth-form"
                >

                  {/* Username */}

                  <div className="form-group">

                    <label>
                      Username
                    </label>

                    <div className="input-box">

                      <User
                        size={18}
                      />

                      <input
                        type="text"
                        placeholder="Enter username"
                        value={
                          loginData.username
                        }
                        onChange={(event) =>
                          setLoginData({
                            ...loginData,
                            username:
                              event.target.value,
                          })
                        }
                        required
                      />

                    </div>

                  </div>

                  {/* Password */}

                  <div className="form-group">

                    <label>
                      Password
                    </label>

                    <div className="input-box">

                      <Lock
                        size={18}
                      />

                      <input
                        type={
                          showPassword
                            ? "text"
                            : "password"
                        }
                        placeholder="Enter password"
                        value={
                          loginData.password
                        }
                        onChange={(event) =>
                          setLoginData({
                            ...loginData,
                            password:
                              event.target.value,
                          })
                        }
                        required
                      />

                      <button
                        type="button"
                        className="password-toggle"
                        onClick={() =>
                          setShowPassword(
                            !showPassword
                          )
                        }
                      >
                        {showPassword ? (
                          <EyeOff
                            size={18}
                          />
                        ) : (
                          <Eye
                            size={18}
                          />
                        )}
                      </button>

                    </div>

                  </div>

                  {/* Role */}

                  <div className="form-group">

                    <label>
                      Login as
                    </label>

                    <select
                      value={
                        loginData.role
                      }
                      onChange={(event) =>
                        setLoginData({
                          ...loginData,
                          role: event.target.value,
                        })
                      }
                    >

                      <option value="Admin">
                        Admin
                      </option>

                      <option value="Teacher">
                        Teacher
                      </option>

                      <option value="Student">
                        Student
                      </option>

                    </select>

                  </div>

                  {/* Error */}

                  {authError && (
                    <div className="auth-error">
                      {authError}
                    </div>
                  )}

                  {/* Success */}

                  {authSuccess && (
                    <div className="auth-success">
                      {authSuccess}
                    </div>
                  )}

                  {/* Submit */}

                  <button
                    type="submit"
                    className="auth-submit"
                    disabled={authLoading}
                  >

                    {authLoading
                      ? "Signing in..."
                      : "Sign In"}

                    {!authLoading && (
                      <LogIn
                        size={18}
                      />
                    )}

                  </button>

                </form>

                {/* Switch */}

                <div className="auth-switch">

                  <span>
                    Don't have an account?
                  </span>

                  <button
                    type="button"
                    onClick={openRegister}
                  >
                    Create account
                  </button>

                </div>
              </>
            ) : (

              /* =================================================
                 REGISTER
              ================================================= */

              <>

                <div className="auth-heading">

                  <span className="auth-small-title">
                    SMARTATTENDANCE
                  </span>

                  <h2>
                    Create account
                  </h2>

                  <p>
                    Register a new
                    SmartAttendance account
                  </p>

                </div>

                <form
                  onSubmit={handleRegister}
                  className="auth-form"
                >

                  {/* Full Name */}

                  <div className="form-group">

                    <label>
                      Full Name
                    </label>

                    <div className="input-box">

                      <User
                        size={18}
                      />

                      <input
                        type="text"
                        placeholder="Enter full name"
                        value={
                          registerData.fullName
                        }
                        onChange={(event) =>
                          setRegisterData({
                            ...registerData,
                            fullName:
                              event.target.value,
                          })
                        }
                        required
                      />

                    </div>

                  </div>

                  {/* Username */}

                  <div className="form-group">

                    <label>
                      Username
                    </label>

                    <div className="input-box">

                      <UserPlus
                        size={18}
                      />

                      <input
                        type="text"
                        placeholder="Choose username"
                        value={
                          registerData.username
                        }
                        onChange={(event) =>
                          setRegisterData({
                            ...registerData,
                            username:
                              event.target.value,
                          })
                        }
                        required
                      />

                    </div>

                  </div>

                  {/* Phone */}

                  <div className="form-group">

                    <label>
                      Phone
                    </label>

                    <div className="input-box">

                      <Phone
                        size={18}
                      />

                      <input
                        type="tel"
                        placeholder="Enter phone number"
                        value={
                          registerData.phone
                        }
                        onChange={(event) =>
                          setRegisterData({
                            ...registerData,
                            phone:
                              event.target.value,
                          })
                        }
                      />

                    </div>

                  </div>

                  {/* Password */}

                  <div className="form-group">

                    <label>
                      Password
                    </label>

                    <div className="input-box">

                      <Lock
                        size={18}
                      />

                      <input
                        type={
                          showPassword
                            ? "text"
                            : "password"
                        }
                        placeholder="Create password"
                        value={
                          registerData.password
                        }
                        onChange={(event) =>
                          setRegisterData({
                            ...registerData,
                            password:
                              event.target.value,
                          })
                        }
                        required
                      />

                      <button
                        type="button"
                        className="password-toggle"
                        onClick={() =>
                          setShowPassword(
                            !showPassword
                          )
                        }
                      >
                        {showPassword ? (
                          <EyeOff
                            size={18}
                          />
                        ) : (
                          <Eye
                            size={18}
                          />
                        )}
                      </button>

                    </div>

                  </div>

                  {/* Role */}

                  <div className="form-group">

                    <label>
                      Register as
                    </label>

                    <select
                      value={
                        registerData.role
                      }
                      onChange={(event) =>
                        setRegisterData({
                          ...registerData,
                          role: event.target.value,
                        })
                      }
                    >

                      <option value="Admin">
                        Admin
                      </option>

                      <option value="Teacher">
                        Teacher
                      </option>

                      <option value="Student">
                        Student
                      </option>

                    </select>

                  </div>

                  {/* Error */}

                  {authError && (
                    <div className="auth-error">
                      {authError}
                    </div>
                  )}

                  {/* Success */}

                  {authSuccess && (
                    <div className="auth-success">
                      {authSuccess}
                    </div>
                  )}

                  {/* Submit */}

                  <button
                    type="submit"
                    className="auth-submit"
                    disabled={authLoading}
                  >

                    {authLoading
                      ? "Creating..."
                      : "Create Account"}

                    {!authLoading && (
                      <UserPlus
                        size={18}
                      />
                    )}

                  </button>

                </form>

                {/* Switch */}

                <div className="auth-switch">

                  <span>
                    Already have an account?
                  </span>

                  <button
                    type="button"
                    onClick={openLogin}
                  >
                    Sign in
                  </button>

                </div>

              </>
            )}

          </div>

        </div>
      )}

      {/* =====================================================
          NAVBAR
      ===================================================== */}

      <header className="navbar">

        <div className="nav-container">

          {/* BRAND */}

          <div className="brand">

            <div className="brand-icon">
              <GraduationCap
                size={25}
              />
            </div>

            <div>

              <h2>
                SmartAttendance
              </h2>

              <span>
                Attendance Management System
              </span>

            </div>

          </div>

          {/* NAVIGATION */}

          <nav
            className={
              menuOpen
                ? "nav-links mobile-open"
                : "nav-links"
            }
          >

            <a
              href="#home"
              onClick={() =>
                setMenuOpen(false)
              }
            >
              Home
            </a>

            <a
              href="#features"
              onClick={() =>
                setMenuOpen(false)
              }
            >
              Features
            </a>

            <a
              href="#about"
              onClick={() =>
                setMenuOpen(false)
              }
            >
              About
            </a>

            <button
              className="login-nav-btn"
              onClick={openLogin}
            >
              Login
              <ArrowRight
                size={16}
              />
            </button>

          </nav>

          {/* ACTIONS */}

          <div className="nav-actions">

            <button
              className="theme-btn"
              onClick={toggleTheme}
              aria-label="Toggle theme"
            >

              {theme === "dark" ? (
                <Sun size={19} />
              ) : (
                <Moon size={19} />
              )}

            </button>

            <button
              className="menu-btn"
              onClick={() =>
                setMenuOpen(!menuOpen)
              }
              aria-label="Toggle menu"
            >

              {menuOpen ? (
                <X />
              ) : (
                <Menu />
              )}

            </button>

          </div>

        </div>

      </header>

      {/* =====================================================
          HERO
      ===================================================== */}

      <main id="home">

        <section className="hero">

          <div className="hero-container">

            {/* HERO CONTENT */}

            <div className="hero-content">

              <div className="hero-badge">

                <span></span>

                Smart & Reliable
                Attendance System

              </div>

              <h1>

                Attendance made

                <span>
                  {" "}
                  simple and smarter.
                </span>

              </h1>

              <p>

                A centralized attendance
                management system designed
                for administrators, teachers
                and students. Manage attendance,
                monitor records and stay
                connected — all from one place.

              </p>

              <div className="hero-buttons">

                <button
                  className="primary-btn"
                  onClick={openLogin}
                >

                  Get Started

                  <ArrowRight
                    size={18}
                  />

                </button>

                <a
                  href="#features"
                  className="secondary-btn"
                >
                  Explore Features
                </a>

              </div>

              <div className="hero-trust">

                <ShieldCheck
                  size={18}
                />

                Secure • Organized • Easy
                to use

              </div>

            </div>

            {/* =================================================
                DASHBOARD PREVIEW
            ================================================= */}

            <div className="dashboard-preview">

              <div className="preview-header">

                <div>

                  <span>
                    {DATE_LABEL}
                  </span>

                  <h3>
                    {getGreeting()},
                    {" "}
                    Admin
                  </h3>

                </div>

                <div className="profile-circle">
                  A
                </div>

              </div>

              {/* CARDS */}

              <div className="preview-cards">

                <div className="preview-card">

                  <Users
                    size={20}
                  />

                  <div>

                    <small>
                      Total Students
                    </small>

                    <strong>
                      {total}
                    </strong>

                  </div>

                </div>

                <div className="preview-card">

                  <ClipboardCheck
                    size={20}
                  />

                  <div>

                    <small>
                      Present Today
                    </small>

                    <strong>
                      {presentCount}
                    </strong>

                  </div>

                </div>

              </div>

              {/* ATTENDANCE */}

              <div className="attendance-preview">

                <div className="attendance-title">

                  <div>

                    <span>
                      Today's Attendance
                    </span>

                    <strong>
                      {percent}%
                    </strong>

                  </div>

                  <BarChart3
                    size={20}
                  />

                </div>

                <div className="attendance-bar">

                  <div
                    style={{
                      width: `${percent}%`,
                    }}
                  />

                </div>

                <div className="attendance-labels">

                  <span>
                    Present {presentCount}
                  </span>

                  <span>
                    Absent {absentCount}
                  </span>

                </div>

              </div>

              {/* RECENT */}

              <div className="recent-preview">

                <div className="recent-heading">

                  <span>
                    Recent Attendance
                  </span>

                  <button
                    className="link-btn"
                    onClick={() =>
                      setShowAll(!showAll)
                    }
                  >
                    {showAll
                      ? "Show less"
                      : "View all"}
                  </button>

                </div>

                {visibleStudents.map(
                  (student) => (

                    <div
                      className="student-row"
                      key={student.id}
                    >

                      <div className="student-avatar">

                        {getInitials(
                          student.name
                        )}

                      </div>

                      <div>

                        <strong>
                          {student.name}
                        </strong>

                        <small>
                          {student.cls}
                        </small>

                      </div>

                      <button
                        className={
                          student.present
                            ? "status present"
                            : "status absent"
                        }
                        onClick={() =>
                          toggleAttendance(
                            student.id
                          )
                        }
                      >

                        {student.present
                          ? "Present"
                          : "Absent"}

                      </button>

                    </div>

                  )
                )}

              </div>

            </div>

          </div>

        </section>

        {/* =====================================================
            FEATURES
        ===================================================== */}

        <section
          id="features"
          className="features-section"
        >

          <div className="section-heading">

            <span>
              FEATURES
            </span>

            <h2>
              Everything you need to
              manage attendance
            </h2>

            <p>
              Simple tools for schools
              and institutions to manage
              attendance efficiently.
            </p>

          </div>

          <div className="features-grid">

            <Feature
              icon={
                <ClipboardCheck />
              }
              title="Easy Attendance"
              text="Teachers can mark student attendance quickly and efficiently."
            />

            <Feature
              icon={
                <BarChart3 />
              }
              title="Attendance Reports"
              text="View attendance records and monitor student attendance."
            />

            <Feature
              icon={
                <Bell />
              }
              title="Parent Notifications"
              text="Keep parents informed when a student is marked absent."
            />

            <Feature
              icon={
                <ShieldCheck />
              }
              title="Secure Access"
              text="Role-based access keeps administrator, teacher and student data protected."
            />

            <Feature
              icon={
                <Users />
              }
              title="Student Management"
              text="Manage student information and attendance records from one place."
            />

            <Feature
              icon={
                <GraduationCap />
              }
              title="Role Based Dashboard"
              text="Separate dashboards for Admin, Teacher and Student users."
            />

          </div>

        </section>

        {/* =====================================================
            ABOUT
        ===================================================== */}

        <section
          id="about"
          className="about-section"
        >

          <div className="about-container">

            <div>

              <span className="section-small">
                ABOUT SMARTATTENDANCE
              </span>

              <h2>

                One system.
                <br />

                Three roles.
                <br />

                Complete control.

              </h2>

            </div>

            <div className="about-text">

              <p>
                SmartAttendance brings
                administrators, teachers and
                students together in one
                organized platform.
              </p>

              <p>
                Administrators can manage
                students and monitor attendance,
                teachers can mark attendance and
                generate reports, while students
                can view their attendance history.
              </p>

              <button
                className="text-btn"
                onClick={openLogin}
              >

                Login to continue

                <ArrowRight
                  size={17}
                />

              </button>

            </div>

          </div>

        </section>

      </main>

      {/* =====================================================
          FOOTER
      ===================================================== */}

      <footer>

        <div className="footer-container">

          <div className="brand footer-brand">

            <div className="brand-icon">

              <GraduationCap
                size={22}
              />

            </div>

            <div>

              <h3>
                SmartAttendance
              </h3>

              <span>
                Attendance Management System
              </span>

            </div>

          </div>

          <p>
            © {today.getFullYear()}
            {" "}
            SmartAttendance.
            All rights reserved.
          </p>

        </div>

      </footer>

    </div>
  );
}

/* =========================================================
   FEATURE COMPONENT
========================================================= */

function Feature({
  icon,
  title,
  text,
}) {
  return (
    <div className="feature-card">

      <div className="feature-icon">
        {icon}
      </div>

      <h3>
        {title}
      </h3>

      <p>
        {text}
      </p>

      <ArrowRight
        className="feature-arrow"
        size={18}
      />

    </div>
  );
}

export default App;