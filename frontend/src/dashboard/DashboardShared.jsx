import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { GraduationCap, LogOut, Bell, Menu, X, RefreshCw, CheckCircle2, AlertCircle, Info } from "lucide-react";
import "./Dashboard.css";

/* =====================================================================
   Shared design-system pieces for AdminDashboard, TeacherDashboard and
   StudentDashboard. This file holds NO dashboard of its own and NO data.
   ===================================================================== */

export const API = "https://smartattendance-1-5p5m.onrender.com";

/* ---------- generic helpers ---------- */
export const pick = (obj, keys) => {
  if (!obj) return null;
  // Case-insensitive: SQL Server/ODBC returns PascalCase columns (StudentID, RollNumber, Class...)
  const lower = new Map(Object.keys(obj).map((k) => [k.toLowerCase(), k]));
  for (const k of keys) {
    const real = lower.get(k.toLowerCase());
    const v = real !== undefined ? obj[real] : undefined;
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
};
const norm = (v) => String(v ?? "").trim().toLowerCase();

export const toList = (d) => {
  if (Array.isArray(d)) return d;
  const inner = d && (d.students ?? d.data ?? d.records ?? d.report ?? d.attendance);
  return Array.isArray(inner) ? inner : [];
};

export const dash = (v) => (v === null || v === undefined || v === "" ? "—" : v);
export const pctText = (n) => (n === null || n === undefined ? "—" : `${n.toFixed(1)}%`);
export const initials = (name) =>
  (name || "U").split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
export const classLabel = (cls, section) => [cls, section].filter(Boolean).join(" - ") || "Unassigned";
export const fmtDate = (key) =>
  new Date(`${key}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
export const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good Morning" : h < 17 ? "Good Afternoon" : "Good Evening";
};

export const setStoredUser = (u) => localStorage.setItem("user", JSON.stringify(u));

export const applyTheme = (t) => {
  try { localStorage.setItem("theme", t); } catch { /* ignore */ }
  document.documentElement.setAttribute("data-theme", t);
};
export const currentTheme = () => document.documentElement.getAttribute("data-theme") || "light";

export const getStoredUser = () => {
  try {
    const u = JSON.parse(localStorage.getItem("user"));
    return u && typeof u === "object" ? u : {};
  } catch {
    return {};
  }
};

/* ---------- normalisers: adjust the key lists if your API uses other names ---------- */
export const normStudent = (s) => ({
  id: pick(s, ["studentId", "student_id", "studentID", "id", "_id"]),
  roll: pick(s, ["rollNumber", "roll_number", "rollNo", "roll_no", "roll"]),
  name: pick(s, ["name", "studentName", "student_name", "fullName"]),
  cls: pick(s, ["class", "className", "class_name", "grade"]),
  section: pick(s, ["section", "sec"]),
  parentName: pick(s, ["parentName", "parent_name", "guardianName", "guardian_name"]),
  parentPhone: pick(s, ["parentPhone", "parent_phone", "parentContact", "parent_contact", "phone"]),
  linkedUserId: pick(s, ["linkedUserId"]),
  linkedUsername: pick(s, ["linkedUsername"]),
});

const dateKey = (v) => {
  if (!v) return null;
  const str = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-CA");
};

export const normRecord = (r) => {
  const st = norm(pick(r, ["status", "attendanceStatus", "attendance_status"]));
  return {
    studentRef: pick(r, ["studentId", "student_id", "studentID", "student"]),
    name: pick(r, ["name", "studentName", "student_name"]),
    roll: pick(r, ["rollNumber", "roll_number", "rollNo", "roll"]),
    cls: pick(r, ["className", "class_name", "class", "grade"]),
    section: pick(r, ["section", "sec"]),
    date: dateKey(pick(r, ["date", "attendanceDate", "attendance_date", "createdAt"])),
    status: st.startsWith("p") ? "present" : st.startsWith("a") ? "absent" : "",
    subject: pick(r, ["subject"]),
    teacher: pick(r, ["teacherName"]),
    period: pick(r, ["period"]),
    lectureStart: pick(r, ["lectureStartTime"]),
    lectureEnd: pick(r, ["lectureEndTime"]),
    takenAt: pick(r, ["attendanceTakenAt"]),
  };
};

/* ---------- API client: every call sends the JWT; 401 => session expired ---------- */
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = "GET", body, query } = {}) {
  const token = localStorage.getItem("token");
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let url = `${API}${path}`;
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== "" && v != null)).toString();
    if (qs) url += `?${qs}`;
  }

  let res;
  try {
    res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError("Cannot reach the server. ", 0);
  }

  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }

  if (res.status === 401) {
    window.dispatchEvent(new Event("auth-expired"));
    throw new ApiError((data && data.message) || "Session expired. Please log in again.", 401);
  }
  if (!res.ok) {
    const e = new ApiError((data && data.message) || `Server responded with ${res.status}`, res.status);
    e.code = data && data.code;
    throw e;
  }
  return data;
}

/* ---------- CSV export (real, already-filtered rows) ---------- */
const csvCell = (v) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // block spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function downloadCSV(filename, headers, rows) {
  const text = [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- data hook for Admin + Teacher: the ONLY place these lists are fetched ---------- */
export function useDashboardData() {
  const [state, setState] = useState({
    students: [], records: [], loading: true, refreshing: false, syncedAt: null,
    errors: { students: null, attendance: null },
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, refreshing: true }));
    const [st, at] = await Promise.allSettled([api("/students/all"), api("/attendance/report")]);
    setState({
      students: st.status === "fulfilled" ? toList(st.value).map(normStudent) : [],
      records: at.status === "fulfilled" ? toList(at.value).map(normRecord) : [],
      errors: {
        students: st.status === "rejected" ? st.reason.message : null,
        attendance: at.status === "rejected" ? at.reason.message : null,
      },
      loading: false,
      refreshing: false,
      syncedAt: new Date(),
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: load, todayKey: new Date().toLocaleDateString("en-CA") };
}

/* ---------- derived data (pure functions over real data) ---------- */
const studentKeys = (s) => [s.id != null && `id:${norm(s.id)}`, s.name && `n:${norm(s.name)}`].filter(Boolean);
const recordKeys = (r) => [r.studentRef != null && `id:${norm(r.studentRef)}`, r.name && `n:${norm(r.name)}`].filter(Boolean);

export const recordsFor = (records, students) => {
  const set = new Set(students.flatMap(studentKeys));
  return records.filter((r) => recordKeys(r).some((k) => set.has(k)));
};

export const summarize = (records, todayKey) => {
  const daily = records.filter((r) => r.date && r.status);
  const today = daily.filter((r) => r.date === todayKey);
  const present = today.filter((r) => r.status === "present").length;
  const absent = today.length - present;
  const marked = present + absent;
  return {
    hasRecords: daily.length > 0, present, absent, marked,
    rate: marked ? (present / marked) * 100 : null,
    dates: [...new Set(daily.map((r) => r.date))].sort().reverse(),
  };
};

const todayMap = (records, todayKey) => {
  const m = new Map();
  records.filter((r) => r.date === todayKey && r.status).forEach((r) => recordKeys(r).forEach((k) => m.set(k, r.status)));
  return m;
};

export const statusToday = (records, todayKey) => {
  const m = todayMap(records, todayKey);
  return (s) => studentKeys(s).map((k) => m.get(k)).find(Boolean) || "none";
};

export const classGroups = (students, records, todayKey) => {
  const statusOf = statusToday(records, todayKey);
  const g = new Map();
  students.forEach((s) => {
    const key = classLabel(s.cls, s.section);
    const e = g.get(key) || { label: key, cls: s.cls, section: s.section, total: 0, present: 0, absent: 0 };
    e.total += 1;
    const st = statusOf(s);
    if (st === "present") e.present += 1;
    if (st === "absent") e.absent += 1;
    g.set(key, e);
  });
  return [...g.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
};

export const recentRecords = (records, students, limit) => {
  const byKey = new Map();
  students.forEach((s) => studentKeys(s).forEach((k) => byKey.set(k, s)));
  return records
    .filter((r) => r.date && r.status)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, limit)
    .map((r, i) => {
      const s = recordKeys(r).map((k) => byKey.get(k)).find(Boolean);
      return { key: i, name: s?.name ?? r.name, cls: s ? classLabel(s.cls, s.section) : null, date: r.date, status: r.status };
    });
};

/* ---------- small UI pieces ---------- */
export function StatCards({ items }) {
  return (
    <section className="dash-cards" aria-label="Summary">
      {items.map((c) => (
        <div key={c.label} className={`dash-card t-${c.tone}`}>
          <span>{c.label}</span>
          <strong>{c.value}</strong>
          <small>{c.note}</small>
        </div>
      ))}
    </section>
  );
}

export function Panel({ id, title, sub, right, children }) {
  return (
    <section id={id} className="dash-panel">
      <div className="dash-panel-head">
        <div>
          <h2>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Pill({ status }) {
  const label = status === "present" ? "Present" : status === "absent" ? "Absent" : "Not marked";
  return <span className={`dash-pill ${status === "present" || status === "absent" ? status : "none"}`}>{label}</span>;
}

export function RecentTable({ rows }) {
  return (
    <div className="dash-table-wrap">
      <table className="dash-table">
        <thead>
          <tr><th>Student</th><th>Class</th><th>Date</th><th>Status</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="strong">{dash(r.name)}</td>
              <td>{dash(r.cls)}</td>
              <td>{fmtDate(r.date)}</td>
              <td><Pill status={r.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function QuickActions({ items, onAction }) {
  return (
    <section className="dash-actions" aria-label="Quick actions">
      {items.map(({ key, label, hint, icon: Icon }) => (
        <button key={key} className="dash-action" onClick={() => onAction?.(key)}>
          <Icon size={20} />
          <div>
            <strong>{label}</strong>
            <span>{hint}</span>
          </div>
        </button>
      ))}
    </section>
  );
}

export function ErrorBanner({ errors, onRetry }) {
  if (!errors.students && !errors.attendance) return null;
  return (
    <div className="dash-error" role="alert">
      <div>
        <strong>Some data could not be loaded.</strong>
        <span>
          {errors.students && `Students: ${errors.students}. `}
          {errors.attendance && `Attendance report: ${errors.attendance}. `}
          
        </span>
      </div>
      <button onClick={onRetry}><RefreshCw size={15} /> Retry</button>
    </div>
  );
}


export function RefreshButton({ onClick, busy, label = "Refresh" }) {
  return (
    <button className="dash-ghost-btn" onClick={onClick} disabled={busy}>
      <RefreshCw size={14} className={busy ? "dash-spin" : ""} /> {busy ? "Refreshing…" : label}
    </button>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="dash-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} className={value === t.key ? "active" : ""} onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="dash-modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dash-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dash-modal-head">
          <h2>{title}</h2>
          <button className="dash-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------- toasts ---------- */
const NotifyContext = createContext(() => {});
export const useNotify = () => useContext(NotifyContext);

/* ---------- layout shell: sidebar + header (each role passes its own nav; page state lives in the dashboard) ---------- */
export function Shell({ nav, page, onPage, user, onLogout, notices = [], children }) {
  const [open, setOpen] = useState(false);
  const [bell, setBell] = useState(false);
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const bellRef = useRef(null);

  const notify = useCallback((message, type = "success") => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === "error" ? 6000 : 3500);
  }, []);

  useEffect(() => {
    if (!bell) return undefined;
    const h = (e) => bellRef.current && !bellRef.current.contains(e.target) && setBell(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [bell]);

  const userName = pick(user, ["fullName", "name", "username"]) || "User";
  const userRole = pick(user, ["role", "userRole"]);
  const todayLabel = new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const go = (item) => {
    onPage(item.key);
    setOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const logout = () => {
    if (onLogout) return onLogout();
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.reload();
  };

  return (
    <NotifyContext.Provider value={notify}>
      <div className="dash">
        {open && <div className="dash-overlay" onClick={() => setOpen(false)} />}

        <aside className={open ? "dash-side open" : "dash-side"}>
          <div className="dash-brand">
            <div className="dash-logo"><GraduationCap size={22} /></div>
            <div>
              <strong>SmartAttendance</strong>
              <span>Management System</span>
            </div>
          </div>

          <nav className="dash-nav" aria-label="Main">
            {nav.map((item) => (
              <button
                key={item.key}
                className={page === item.key ? "dash-nav-item active" : "dash-nav-item"}
                onClick={() => go(item)}
              >
                <item.icon size={18} /> {item.label}
              </button>
            ))}
          </nav>

          <button className="dash-nav-item dash-logout" onClick={logout}>
            <LogOut size={18} /> Logout
          </button>
        </aside>

        <div className="dash-main">
          <header className="dash-top">
            <button className="dash-burger" onClick={() => setOpen(!open)} aria-label="Toggle navigation">
              {open ? <X size={22} /> : <Menu size={22} />}
            </button>
            <div className="dash-top-text">
              <span>{todayLabel}</span>
              <h1>{greeting()}, {userName}</h1>
            </div>
            <div className="dash-top-right">
              <div className="dash-bell" ref={bellRef}>
                <button className="dash-icon-btn" aria-label="Notifications" onClick={() => setBell(!bell)}>
                  <Bell size={19} />
                  {notices.length > 0 && <i className="dash-bell-dot">{notices.length}</i>}
                </button>
                {bell && (
                  <div className="dash-bell-pop">
                    <strong>Notifications</strong>
                    {notices.length === 0 ? (
                      <p className="dash-muted">You're all caught up.</p>
                    ) : (
                      notices.map((n) => (
                        <button key={n.id} onClick={() => { setBell(false); n.onClick?.(); }}>{n.text}</button>
                      ))
                    )}
                  </div>
                )}
              </div>
              <div className="dash-user">
                <div className="dash-avatar">{initials(userName)}</div>
                <div className="dash-user-text">
                  <strong>{userName}</strong>
                  {userRole && <span>{userRole}</span>}
                </div>
              </div>
            </div>
          </header>
          <main className="dash-content">{children}</main>
        </div>

        <div className="dash-toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`dash-toast ${t.type}`}>
              {t.type === "error" ? <AlertCircle size={16} /> : t.type === "info" ? <Info size={16} /> : <CheckCircle2 size={16} />}
              <span>{t.message}</span>
            </div>
          ))}
        </div>
      </div>
    </NotifyContext.Provider>
  );
}
