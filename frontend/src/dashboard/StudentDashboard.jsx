import { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutDashboard, ClipboardCheck, CalendarDays, UserCircle, Settings, Download, RotateCcw } from "lucide-react";
import {
  api, toList, normStudent, normRecord, initials, classLabel, fmtDate, pctText, dash, downloadCSV,
  Shell, StatCards, Panel, Pill, RefreshButton, useNotify,
} from "./DashboardShared";
import { SettingsPage } from "./DashboardPages";
import { lectureTime } from "./SchoolPages";
const taken = (v) => (v ? lectureTime(String(v).slice(11, 16), String(v).slice(11, 16)).split(" - ")[0] : "—");

const NAV = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "attendance", label: "My Attendance", icon: ClipboardCheck },
  { key: "timetable", label: "My Timetable", icon: CalendarDays },
  { key: "profile", label: "Profile", icon: UserCircle },
  { key: "settings", label: "Settings", icon: Settings },
];

/* The student only ever calls /students/me/* endpoints.
   The server resolves "me" from the JWT + the Users.StudentID link, so nothing is guessed on the client. */
function useStudentData() {
  const [state, setState] = useState({ me: null, records: [], loading: true, refreshing: false, notLinked: false, error: null, syncedAt: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, refreshing: true }));
    const [m, a] = await Promise.allSettled([api("/students/me"), api("/students/me/attendance")]);
    const notLinked = [m, a].some((r) => r.status === "rejected" && r.reason.code === "NOT_LINKED");
    const failed = [m, a].find((r) => r.status === "rejected" && r.reason.code !== "NOT_LINKED");
    setState({
      me: m.status === "fulfilled" ? normStudent(m.value) : null,
      records: a.status === "fulfilled" ? toList(a.value).map(normRecord).filter((r) => r.date && r.status) : [],
      notLinked,
      error: failed ? failed.reason.message : null,
      loading: false,
      refreshing: false,
      syncedAt: new Date(),
    });
  }, []);

  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

const monthLabel = (k) => new Date(`${k}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

export default function StudentDashboard({ user, onUserChange, onNavigate, onLogout }) {
  const { me, records, loading, refreshing, notLinked, error, reload } = useStudentData();
  const [page, setPage] = useState("overview");

  const stats = useMemo(() => {
    const present = records.filter((r) => r.status === "present").length;
    const absent = records.length - present;
    const months = new Map();
    records.forEach((r) => {
      const k = r.date.slice(0, 7);
      const m = months.get(k) || { present: 0, absent: 0 };
      m[r.status] += 1;
      months.set(k, m);
    });
    return {
      present, absent, total: records.length,
      pct: records.length ? (present / records.length) * 100 : null,
      months: [...months.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)),
      sorted: [...records].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    };
  }, [records]);

  const openPage = (p) => { setPage(p); onNavigate?.(p); };
  const ready = !loading;
  const share = (n) => (stats.total ? (n / stats.total) * 100 : 0);

  const notices = useMemo(() => {
    if (loading || stats.pct === null) return [];
    return stats.pct < 75 ? [{ id: "low", text: `Your attendance is ${stats.pct.toFixed(1)}% (below 75%)`, onClick: () => setPage("attendance") }] : [];
  }, [loading, stats.pct]);

  const cards = [
    { label: "Overall Attendance", value: ready ? pctText(stats.pct) : "…", note: "Across all recorded days", tone: "gold" },
    { label: "Present", value: ready ? stats.present : "…", note: "Lectures marked present", tone: "ok" },
    { label: "Absent", value: ready ? stats.absent : "…", note: "Lectures marked absent", tone: "bad" },
    { label: "Total Classes", value: ready ? stats.total : "…", note: "Lectures with attendance recorded", tone: "accent" },
  ];

  const banner = error && (
    <div className="dash-error" role="alert">
      <div><strong>Some data could not be loaded.</strong><span>{error}</span></div>
      <button onClick={reload}>Retry</button>
    </div>
  );

  const notLinkedMsg = "Your account is not linked to a student record yet. Please contact the school office.";

  const profilePanel = (
    <Panel id="profile" title="Student Profile" sub="Your details on record" right={<RefreshButton onClick={reload} busy={refreshing} />}>
      {loading ? (
        <div className="dash-empty">Loading your profile…</div>
      ) : !me ? (
        <div className="dash-empty">{notLinked ? notLinkedMsg : "Your profile could not be loaded."}</div>
      ) : (
        <div className="dash-profile">
          <div className="dash-big-avatar">{initials(me.name)}</div>
          <div className="dash-profile-body">
            <h3>{dash(me.name)}</h3>
            <dl className="dash-facts">
              <div><dt>Roll Number</dt><dd>{dash(me.roll)}</dd></div>
              <div><dt>Class</dt><dd>{dash(me.cls)}</dd></div>
              <div><dt>Section</dt><dd>{dash(me.section)}</dd></div>
              <div><dt>Username</dt><dd>{dash(me.linkedUsername || user?.username)}</dd></div>
              <div><dt>Parent Name</dt><dd>{dash(me.parentName)}</dd></div>
              <div><dt>Parent Phone</dt><dd>{dash(me.parentPhone)}</dd></div>
            </dl>
          </div>
        </div>
      )}
    </Panel>
  );

  return (
    <Shell nav={NAV} page={page} onPage={openPage} user={user} onLogout={onLogout} notices={notices}>
      {banner}

      {page === "overview" && (
        <>
          {profilePanel}
          {me && (
            <>
              <StatCards items={cards} />
              <Panel id="attendance-overview" title="Attendance Overview" sub={classLabel(me.cls, me.section)}>
                {stats.total === 0 ? (
                  <div className="dash-empty">No attendance has been recorded for you yet.</div>
                ) : (
                  <div className="dash-att">
                    <div className="dash-today">
                      <h3>Overall</h3>
                      <div className="dash-bar" role="img" aria-label={`${stats.present} present, ${stats.absent} absent`}>
                        <i className="p" style={{ width: `${share(stats.present)}%` }} />
                        <i className="a" style={{ width: `${share(stats.absent)}%` }} />
                      </div>
                      <ul className="dash-legend">
                        <li><i className="p" /> Present <b>{stats.present}</b></li>
                        <li><i className="a" /> Absent <b>{stats.absent}</b></li>
                      </ul>
                    </div>
                    <div className="dash-table-wrap">
                      <table className="dash-table">
                        <thead><tr><th>Month</th><th className="num">Present</th><th className="num">Absent</th><th className="num">Attendance</th></tr></thead>
                        <tbody>
                          {stats.months.slice(0, 6).map(([k, m]) => (
                            <tr key={k}>
                              <td>{monthLabel(k)}</td><td className="num">{m.present}</td><td className="num">{m.absent}</td>
                              <td className="num">{pctText((m.present / (m.present + m.absent)) * 100)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </Panel>

              <Panel title="Recent Attendance History" sub="Your latest entries" right={<button className="dash-ghost-btn" onClick={() => setPage("attendance")}>View all</button>}>
                {stats.sorted.length === 0 ? (
                  <div className="dash-empty">No attendance has been recorded for you yet.</div>
                ) : (
                  <div className="dash-table-wrap">
                    <table className="dash-table">
                      <thead><tr><th>Date</th><th>Subject</th><th>Teacher</th><th>Period</th><th>Lecture time</th><th>Taken at</th><th>Status</th></tr></thead>
                      <tbody>
                        {stats.sorted.slice(0, 10).map((r, i) => (
                          <tr key={i}>
                            <td>{fmtDate(r.date)}</td><td>{dash(r.subject)}</td><td>{dash(r.teacher)}</td><td>{dash(r.period)}</td>
                            <td>{lectureTime(r.lectureStart, r.lectureEnd)}</td><td>{taken(r.takenAt)}</td>
                            <td><Pill status={r.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </>
          )}
        </>
      )}

      {page === "attendance" && (
        me || loading ? <MyAttendance stats={stats} loading={loading} refreshing={refreshing} reload={reload} me={me} /> : (
          <Panel title="My Attendance"><div className="dash-empty">{notLinked ? notLinkedMsg : "Your attendance could not be loaded."}</div></Panel>
        )
      )}
      {page === "timetable" && <MyTimetable me={me} />}
      {page === "profile" && profilePanel}
      {page === "settings" && <SettingsPage user={user} onUserChange={onUserChange} onLogout={onLogout} />}
    </Shell>
  );
}

function MyAttendance({ stats, loading, refreshing, reload, me }) {
  const notify = useNotify();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const [month, setMonth] = useState("");
  const [subject, setSubject] = useState("");
  const subjects = useMemo(() => [...new Set(stats.sorted.map((r) => r.subject).filter(Boolean))].sort(), [stats.sorted]);

  const rows = useMemo(
    () => stats.sorted.filter((r) => (!from || r.date >= from) && (!to || r.date <= to) && (!status || r.status === status) && (!month || r.date.startsWith(month)) && (!subject || r.subject === subject)),
    [stats.sorted, from, to, status, month, subject]
  );
  const p = rows.filter((r) => r.status === "present").length;
  const any = from || to || status || month || subject;

  const exportCsv = () => {
    if (!rows.length) return notify("There are no records to export.", "info");
    downloadCSV(`my-attendance-${me?.roll ?? "student"}.csv`, ["Date", "Subject", "Teacher", "Period", "Lecture Time", "Taken At", "Status"],
      rows.map((r) => [r.date, r.subject, r.teacher, r.period, lectureTime(r.lectureStart, r.lectureEnd), r.takenAt, r.status === "present" ? "Present" : "Absent"]));
    notify(`Exported ${rows.length} record${rows.length === 1 ? "" : "s"}.`);
  };

  return (
    <Panel
      id="attendance-history"
      title="My Attendance"
      sub={loading ? "Loading…" : `${rows.length} record${rows.length === 1 ? "" : "s"} · ${p} present · ${rows.length - p} absent · ${pctText(rows.length ? (p / rows.length) * 100 : null)}`}
      right={
        <div className="dash-head-actions">
          <RefreshButton onClick={reload} busy={refreshing} />
          <button className="dash-ghost-btn" onClick={exportCsv}><Download size={14} /> Export CSV</button>
        </div>
      }
    >
      <div className="dash-filters">
        <label className="dash-field">
          <span>Month</span>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">All months</option>
            {stats.months.map(([k]) => <option key={k} value={k}>{monthLabel(k)}</option>)}
          </select>
        </label>
        <label className="dash-field"><span>From</span><input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="dash-field"><span>To</span><input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="dash-field">
          <span>Subject</span>
          <select value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">All subjects</option>
            {subjects.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className="dash-field">
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option><option value="present">Present</option><option value="absent">Absent</option>
          </select>
        </label>
        {any && <button className="dash-ghost-btn" onClick={() => { setFrom(""); setTo(""); setStatus(""); setMonth(""); setSubject(""); }}><RotateCcw size={14} /> Reset</button>}
      </div>

      {loading ? (
        <div className="dash-empty">Loading attendance…</div>
      ) : !stats.total ? (
        <div className="dash-empty">No attendance has been recorded for you yet.</div>
      ) : !rows.length ? (
        <div className="dash-empty">No records match your filters.</div>
      ) : (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead><tr><th>Date</th><th>Subject</th><th>Teacher</th><th>Period</th><th>Lecture time</th><th>Taken at</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.date}-${i}`}>
                  <td>{fmtDate(r.date)}</td><td>{dash(r.subject)}</td><td>{dash(r.teacher)}</td><td>{dash(r.period)}</td>
                  <td>{lectureTime(r.lectureStart, r.lectureEnd)}</td><td>{taken(r.takenAt)}</td>
                  <td><Pill status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function MyTimetable({ me }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { api("/students/me/timetable").then((d) => setRows(toList(d))).catch((e) => { setRows([]); setErr(e.message); }); }, []);
  return (
    <Panel id="timetable" title="My Timetable" sub={me ? `Class ${classLabel(me.cls, me.section)} · same period schedule every school day` : ""}>
      {rows === null ? <div className="dash-empty">Loading timetable…</div>
        : err ? <div className="dash-empty">{err}</div>
        : !rows.length ? <div className="dash-empty">No timetable has been set up for your class yet.</div>
        : (
          <div className="dash-table-wrap"><table className="dash-table">
            <thead><tr><th>Period</th><th>Subject</th><th>Teacher</th><th>Start</th><th>End</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.AssignmentID}><td>{r.Period}</td><td>{dash(r.Subject)}</td><td>{dash(r.TeacherName)}</td><td>{lectureTime(r.StartTime, r.StartTime).split(" - ")[0]}</td><td>{lectureTime(r.EndTime, r.EndTime).split(" - ")[0]}</td></tr>)}</tbody>
          </table></div>
        )}
    </Panel>
  );
}
