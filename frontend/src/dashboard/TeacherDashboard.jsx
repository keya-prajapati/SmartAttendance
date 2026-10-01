import { useMemo, useState } from "react";
import { LayoutDashboard, Users, School, ClipboardCheck, FileBarChart, Settings, CalendarCheck, CalendarDays, Megaphone } from "lucide-react";
import {
  useDashboardData, summarize, recentRecords, statusToday, pctText, dash,
  Shell, StatCards, Panel, RecentTable, ErrorBanner, Pill,
} from "./DashboardShared";
import { StudentsPage, SettingsPage, buildStaffNotices } from "./DashboardPages";
import AnnouncementsPage from "./AnnouncementsPage";
import { MyClassesPage, TeacherTimetablePage, ImportPage, LectureReportsPage } from "./SchoolPages";

const NAV = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "students", label: "Students", icon: Users },
  { key: "classes", label: "My Classes", icon: School },
  { key: "timetable", label: "My Timetable", icon: CalendarDays },
  { key: "announcements", label: "Announcements", icon: Megaphone },
  { key: "import-attendance", label: "Import Attendance", icon: ClipboardCheck },
  { key: "reports", label: "Reports", icon: FileBarChart },
  { key: "settings", label: "Settings", icon: Settings },
];

/* A teacher sees ONLY the classes assigned to them (TeacherAssignments, resolved from the JWT on the server). */
export default function TeacherDashboard({ user, onUserChange, onNavigate, onAction, onLogout }) {
  const data = useDashboardData();
  const { students, records, errors, loading, reload, todayKey } = data;

  const [page, setPage] = useState("overview");
  const [scheduledEntry, setScheduledEntry] = useState(null);
  
  const openPage = (p) => { if (p !== "classes") setScheduledEntry(null); setPage(p); onNavigate?.(p); };
  const goMark = () => { onAction?.("mark-attendance"); setPage("classes"); };
  const goRecords = () => setPage("reports");

  const total = students.length;
  const sum = useMemo(() => summarize(records, todayKey), [records, todayKey]);
  const recent = useMemo(() => recentRecords(records, students, 6), [records, students]);
    const statusOf = useMemo(() => statusToday(records, todayKey), [records, todayKey]);
  const notices = useMemo(() => buildStaffNotices(data, () => goMark(), goRecords), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const notMarked = Math.max(total - sum.marked, 0);
  const ready = !loading;

  const heroText = loading
    ? "Loading today's attendance…"
    : total === 0
    ? "There are no students registered yet."
    : sum.marked === 0
    ? `Attendance has not been marked yet for ${total} student${total === 1 ? "" : "s"}.`
    : `${sum.marked} of ${total} students marked. ${notMarked} remaining.`;

  const cards = [
    { label: "Total Students", value: ready ? total : "…", note: "All registered students", tone: "accent" },
    { label: "Present", value: ready ? sum.present : "…", note: "Marked present today", tone: "ok" },
    { label: "Absent", value: ready ? sum.absent : "…", note: "Marked absent today", tone: "bad" },
    { label: "Attendance", value: ready ? pctText(sum.rate) : "…", note: "Of students marked today", tone: "gold" },
  ];

  return (
    <Shell nav={NAV} page={page} onPage={openPage} user={user} onLogout={onLogout} notices={notices}>
      <ErrorBanner errors={errors} onRetry={reload} />

      {page === "overview" && (
        <>
          <section className="dash-hero">
            <div>
              <h2>Today's Attendance</h2>
              <p>{heroText}</p>
            </div>
            <button className="dash-primary-btn" onClick={() => goMark()}>
              <CalendarCheck size={18} /> Mark Attendance
            </button>
          </section>

          <StatCards items={cards} />

          <div className="dash-cols even">
            <Panel
              id="recent-attendance"
              title="Recent Attendance"
              sub="Latest entries"
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

            <Panel id="roster" title="Student Overview" sub="Today's status for each student" right={<button className="dash-ghost-btn" onClick={() => setPage("students")}>All students</button>}>
              {loading ? (
                <div className="dash-empty">Loading students…</div>
              ) : total === 0 ? (
                <div className="dash-empty">No students added yet.</div>
              ) : (
                <div className="dash-table-wrap dash-scroll">
                  <table className="dash-table">
                    <thead>
                      <tr><th>Roll No.</th><th>Name</th><th>Class</th><th>Today</th></tr>
                    </thead>
                    <tbody>
                      {students.map((s, i) => (
                        <tr key={s.id ?? i}>
                          <td>{dash(s.roll)}</td>
                          <td className="strong">{dash(s.name)}</td>
                          <td>{dash([s.cls, s.section].filter(Boolean).join(" - "))}</td>
                          <td><Pill status={statusOf(s)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        </>
      )}

      {page === "students" && <StudentsPage data={data} isAdmin={false} addOpen={false} setAddOpen={() => {}} />}
      {page === "classes" && <MyClassesPage scheduledEntry={scheduledEntry} onExitSchedule={() => setScheduledEntry(null)} />}
      {page === "timetable" && <TeacherTimetablePage onTakeAttendance={(entry) => { setScheduledEntry(entry); setPage("classes"); }} />}
      {page === "announcements" && <AnnouncementsPage />}
      {page === "import-attendance" && <ImportPage kind="attendance" onDone={reload} />}
      {page === "reports" && <LectureReportsPage isAdmin={false} />}
      {page === "settings" && <SettingsPage user={user} onUserChange={onUserChange} onLogout={onLogout} />}
    </Shell>
  );
}
