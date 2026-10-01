import { useMemo, useState } from "react";
import {
  LayoutDashboard, Users, ClipboardCheck, FileBarChart, Settings,
  UserPlus, FileText, Upload, BookOpen, UserCog, CalendarDays, Megaphone,
} from "lucide-react";
import {
  useDashboardData, summarize, classGroups, recentRecords, fmtDate, pctText, dash,
  Shell, StatCards, Panel, RecentTable, QuickActions, ErrorBanner, RefreshButton,
} from "./DashboardShared";
import { StudentsPage, SettingsPage, buildStaffNotices } from "./DashboardPages";
import { SetupPage, AssignmentsPage, TimetableManagementPage, ImportPage, LectureReportsPage } from "./SchoolPages";
import AnnouncementsPage from "./AnnouncementsPage";

const NAV = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "students", label: "Students", icon: Users },
  { key: "import-students", label: "Import Students", icon: Upload },
  { key: "setup", label: "Classes & Subjects", icon: BookOpen },
  { key: "assignments", label: "Teacher Assignments", icon: UserCog },
  { key: "timetable", label: "Timetable Management", icon: CalendarDays },
  { key: "announcements", label: "Announcements", icon: Megaphone },
  { key: "reports", label: "Attendance Reports", icon: FileBarChart },
  { key: "import-attendance", label: "Import Attendance", icon: ClipboardCheck },
  { key: "settings", label: "Settings", icon: Settings },
];

const ACTIONS = [
  { key: "add-student", label: "Add Student", hint: "Register a new student", icon: UserPlus },
  { key: "import-students", label: "Import Students", hint: "CSV / XLS / XLSX", icon: Upload },
  { key: "assignments", label: "Assign Teacher", hint: "Class, subject, period, timing", icon: UserCog },
  { key: "view-reports", label: "View Reports", hint: "Attendance from SQL Server", icon: FileText },
];

export default function AdminDashboard({ user, onUserChange, onNavigate, onAction, onLogout }) {
  const data = useDashboardData();
  const { students, records, errors, loading, refreshing, syncedAt, reload, todayKey } = data;

  const [page, setPage] = useState("overview");
    const [addOpen, setAddOpen] = useState(false);

  const openPage = (p) => { setPage(p); onNavigate?.(p); };
  const goMark = () => setPage("assignments");
  const goRecords = () => setPage("reports");

  const handleAction = (key) => {
    onAction?.(key);
    if (key === "add-student") { setPage("students"); setAddOpen(true); }
    else if (key === "import-students") setPage("import-students");
    else if (key === "assignments") setPage("assignments");
    else if (key === "view-reports") setPage("reports");
  };

  const total = students.length;
  const sum = useMemo(() => summarize(records, todayKey), [records, todayKey]);
  const recent = useMemo(() => recentRecords(records, students, 8), [records, students]);
  const groups = useMemo(() => classGroups(students, records, todayKey), [students, records, todayKey]);
  const notices = useMemo(() => buildStaffNotices(data, goMark, goRecords), [data]);
  const notMarked = Math.max(total - sum.marked, 0);
  const ready = !loading;

  const cards = [
    { label: "Total Students", value: ready ? total : "…", note: "Registered in the system", tone: "accent" },
    { label: "Present Today", value: ready ? sum.present : "…", note: `${sum.marked} marked today`, tone: "ok" },
    { label: "Absent Today", value: ready ? sum.absent : "…", note: `${notMarked} not yet marked`, tone: "bad" },
    { label: "Attendance Rate", value: ready ? pctText(sum.rate) : "…", note: "Of students marked today", tone: "gold" },
  ];

  const system = [
    ["Students service", errors.students ? "Unavailable" : "Connected", errors.students ? "absent" : "present"],
    ["Attendance service", errors.attendance ? "Unavailable" : "Connected", errors.attendance ? "absent" : "present"],
    ["Class sections", groups.length],
    ["Attendance records", records.length],
    ["Days with attendance", sum.dates.length],
    ["Latest attendance", sum.dates[0] ? fmtDate(sum.dates[0]) : "None yet"],
    ["Last refreshed", syncedAt ? syncedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"],
  ];

  return (
    <Shell nav={NAV} page={page} onPage={openPage} user={user} onLogout={onLogout} notices={notices}>
      <ErrorBanner errors={errors} onRetry={reload} />

      {page === "overview" && (
        <>
          <StatCards items={cards} />
          <QuickActions items={ACTIONS} onAction={handleAction} />

          <div className="dash-cols">
            <Panel
              id="recent-attendance"
              title="Recent Attendance"
              sub="Latest entries from the attendance report"
              right={<button className="dash-ghost-btn" onClick={goRecords}>View all</button>}
            >
              {loading ? (
                <div className="dash-empty">Loading attendance…</div>
              ) : recent.length ? (
                <RecentTable rows={recent} />
              ) : (
                <div className="dash-empty">No attendance has been recorded yet.</div>
              )}
            </Panel>

            <Panel title="System Information" sub="Live status of this installation" right={<RefreshButton onClick={reload} busy={refreshing} />}>
              <dl className="dash-kv">
                {system.map(([k, v, tone]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{tone ? <span className={`dash-pill ${tone}`}>{v}</span> : dash(v)}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          </div>

          <Panel
            id="student-overview"
            title="Student Overview"
            sub={loading ? "Loading…" : `${total} student${total === 1 ? "" : "s"} across ${groups.length} class section${groups.length === 1 ? "" : "s"}`}
            right={<button className="dash-ghost-btn" onClick={() => setPage("students")}>Manage students</button>}
          >
            {loading ? (
              <div className="dash-empty">Loading students…</div>
            ) : total === 0 ? (
              <div className="dash-empty">{errors.students ? "Students could not be loaded." : "No students added yet."}</div>
            ) : (
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>Class</th><th className="num">Students</th>
                      <th className="num">Present today</th><th className="num">Absent today</th><th className="num">Not marked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <tr key={g.label}>
                        <td className="strong">{g.label}</td>
                        <td className="num">{g.total}</td>
                        <td className="num">{g.present}</td>
                        <td className="num">{g.absent}</td>
                        <td className="num">{g.total - g.present - g.absent}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}

      {page === "students" && <StudentsPage data={data} isAdmin addOpen={addOpen} setAddOpen={setAddOpen} />}
      {page === "import-students" && <ImportPage kind="students" onDone={reload} />}
      {page === "setup" && <SetupPage />}
      {page === "assignments" && <AssignmentsPage />}
      {page === "timetable" && <TimetableManagementPage />}
      {page === "announcements" && <AnnouncementsPage isAdmin />}
      {page === "reports" && <LectureReportsPage isAdmin />}
      {page === "import-attendance" && <ImportPage kind="attendance" onDone={reload} />}
      {page === "settings" && <SettingsPage user={user} onUserChange={onUserChange} onLogout={onLogout} />}
    </Shell>
  );
}
