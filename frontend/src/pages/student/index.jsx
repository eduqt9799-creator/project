import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  announcementsApi, assignmentsApi, attendanceApi, dashboardApi, examsApi, marksApi,
  materialsApi, subjectAllocationsApi, subjectsApi, timetableApi,
} from '../../services/api';
import {
  Alert, Badge, Card, CardBody, CardHeader, DataTable, EmptyState, ErrorState, Grid, LoadingState,
  Modal, PageHeader, ProgressBar, SearchBar, SelectInput, StatCard, StatusBadge, TextArea,
  TextInput, useDebounced, useToast,
} from '../../components/ui';
import {
  IconAttendance, IconBooks, IconCalendar, IconClipboard, IconExam, IconMarks, IconBell,
} from '../../components/Icons';

export const SEMESTERS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: n, label: `Semester ${n}` }));
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const SectionCard = ({ title, subtitle, children, action }) => (
  <Card>
    <CardHeader title={title} subtitle={subtitle} actions={action} />
    <CardBody>{children}</CardBody>
  </Card>
);

/** Standard list page state machine backed by the API (loading / error / empty / data). */
export const useApiList = (loader, deps, initialParams = {}) => {
  const [params, setParams] = useState(initialParams);
  const [state, setState] = useState({ loading: true, error: '', rows: [], pagination: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const res = await loader(params);
      setState({ loading: false, error: '', rows: res.data || [], pagination: res.pagination || null });
    } catch (error) {
      setState({ loading: false, error: error.message, rows: [], pagination: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(params), ...deps]);

  useEffect(() => { load(); }, [load]);

  const setParam = useCallback((key, value) => {
    setParams((prev) => ({ ...prev, [key]: value, page: key === 'page' ? value : 1 }));
  }, []);

  return { ...state, params, setParam, setParams, reload: load };
};

/* --------------------------------------------------------------- dashboard */

export const StudentDashboard = () => {
  const { user } = useAuth();
  const [state, setState] = useState({ loading: true, error: '', data: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const res = await dashboardApi.get();
      setState({ loading: false, error: '', data: res.data });
    } catch (error) {
      setState({ loading: false, error: error.message, data: null });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (state.loading) return <LoadingState label="Loading dashboard..." />;
  if (state.error) return <ErrorState message={state.error} onRetry={load} />;

  const data = state.data;
  if (!data || data.empty || !data.profile) {
    return (
      <>
        <PageHeader title="Student Dashboard" subtitle={`Welcome, ${user?.name || ''}`} />
        <Card>
          <EmptyState
            title="No student records available."
            description="Your account is not linked to a student record yet. Contact your department administrator."
          />
        </Card>
      </>
    );
  }

  const { profile, attendance, subjects, assignments, materials, marks, exams, timetable, announcements, notifications } = data;
  const pct = attendance.percentage;

  return (
    <>
      <PageHeader
        title={`Welcome, ${profile.name}`}
        subtitle={`${profile.registerNumber} · Semester ${profile.semester}${profile.departmentName ? ` · ${profile.departmentName}` : ''}`}
      />
      <Grid>
        <StatCard label="Attendance" value={`${pct}%`} hint={`${attendance.present} present of ${attendance.totalClasses} classes`}
          icon={<IconAttendance size={20} />} tone={pct >= 75 ? 'success' : pct >= 50 ? 'warning' : 'danger'} />
        <StatCard label="Subjects" value={subjects.total} hint="Registered this semester" icon={<IconBooks size={20} />} />
        <StatCard label="Assignments" value={assignments.total} hint={`${assignments.pending} pending · ${assignments.overdue} overdue`}
          icon={<IconClipboard size={20} />} tone={assignments.overdue > 0 ? 'warning' : ''} />
        <StatCard label="Materials" value={materials.total} hint="Available to download" icon={<IconBooks size={20} />} />
        <StatCard label="Marks average" value={`${marks.averagePercentage}%`} hint={`${marks.total} subject${marks.total === 1 ? '' : 's'}`}
          icon={<IconMarks size={20} />} tone={marks.averagePercentage >= 50 ? 'success' : 'danger'} />
        <StatCard label="Exams" value={exams.total} hint="Scheduled examinations" icon={<IconExam size={20} />} />
        <StatCard label="Timetable" value={timetable.total} hint="Weekly classes" icon={<IconCalendar size={20} />} />
        <StatCard label="Unread notifications" value={notifications.unread} hint={`${notifications.total} total`} icon={<IconBell size={20} />} />
      </Grid>

      <div className="grid grid-2 mt-2">
        <SectionCard title="Attendance by subject" subtitle="Real records from your department">
          {attendance.subjects.length === 0 ? <EmptyState title="No attendance records available." /> : (
            <div className="stack">
              {attendance.subjects.map((s) => (
                <div key={`${s.subjectCode}-${s.semester}`}>
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                    <span className="strong">{s.subjectCode} · {s.subjectName}</span>
                    <span className="muted">{s.percentage}%</span>
                  </div>
                  <ProgressBar value={s.percentage} />
                  <div className="muted" style={{ fontSize: '0.78rem', marginTop: 4 }}>
                    {s.present} present · {s.absent} absent · {s.totalClasses} classes
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Latest announcements" subtitle="From your department">
          {announcements.total === 0 ? <EmptyState title="No announcements available." /> : (
            <div>
              {announcements.latest.map((a) => (
                <div key={a.announcementId} className="announcement-item" style={{ padding: '12px 0' }}>
                  <div className="announcement-top">
                    <span className="announcement-title">{a.title}</span>
                    <Badge tone={a.priority === 'high' ? 'danger' : a.priority === 'medium' ? 'warning' : 'info'}>{a.priority}</Badge>
                  </div>
                  <div className="announcement-meta">{a.category} · {a.publishDate}</div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
};

/* --------------------------------------------------------------- attendance */

export const StudentAttendance = () => {
  const summary = useApiList(() => attendanceApi.summary(), []);
  const history = useApiList((p) => attendanceApi.myAttendance(p), []);

  const totals = summary.rows.reduce(
    (acc, r) => { acc.total += r.totalClasses; acc.present += r.present; acc.absent += r.absent; return acc; },
    { total: 0, present: 0, absent: 0 }
  );
  const percentage = totals.total ? Number(((totals.present / totals.total) * 100).toFixed(2)) : 0;

  return (
    <>
      <PageHeader title="My Attendance" subtitle="Your attendance is read-only — only authorised faculty can mark it." />
      <Grid>
        <StatCard label="Overall attendance" value={`${percentage}%`} tone={percentage >= 75 ? 'success' : percentage >= 50 ? 'warning' : 'danger'} icon={<IconAttendance size={20} />} />
        <StatCard label="Classes attended" value={totals.present} icon={<IconAttendance size={20} />} tone="success" />
        <StatCard label="Classes missed" value={totals.absent} icon={<IconAttendance size={20} />} tone="danger" />
        <StatCard label="Total classes" value={totals.total} icon={<IconCalendar size={20} />} />
      </Grid>

      <div className="mt-2">
        <Card>
          <CardHeader title="Subject-wise summary" subtitle="Grouped by semester and subject code" />
          <CardBody tight>
            {summary.loading ? <LoadingState label="Loading attendance..." />
              : summary.error ? <ErrorState message={summary.error} onRetry={summary.reload} />
              : (
                <DataTable
                  rows={summary.rows}
                  keyField="subjectCode"
                  emptyTitle="No attendance records available."
                  columns={[
                    { key: 'subjectCode', header: 'Subject Code', render: (r) => <span className="mono strong">{r.subjectCode}</span> },
                    { key: 'subjectName', header: 'Subject Name' },
                    { key: 'semester', header: 'Semester', render: (r) => `Sem ${r.semester}` },
                    { key: 'totalClasses', header: 'Total', className: 'num' },
                    { key: 'present', header: 'Present', className: 'num' },
                    { key: 'absent', header: 'Absent', className: 'num' },
                    {
                      key: 'attendancePercentage',
                      header: 'Percentage',
                      render: (r) => (
                        <div style={{ minWidth: 130 }}>
                          <div className="strong num">{r.attendancePercentage}%</div>
                          <ProgressBar value={r.attendancePercentage} />
                        </div>
                      ),
                    },
                  ]}
                />
              )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-2">
        <Card>
          <CardHeader title="Attendance history" subtitle="Every session recorded for you" actions={(
            <div style={{ minWidth: 170 }}>
              <SelectInput label="" value={history.params.subjectCode || ''} onChange={(e) => history.setParam('subjectCode', e.target.value)}
                placeholder="All subjects" options={summary.rows.map((s) => ({ value: s.subjectCode, label: `${s.subjectCode} · ${s.subjectName}` }))} />
            </div>
          )} />
          <CardBody tight>
            {history.loading ? <LoadingState label="Loading attendance history..." />
              : history.error ? <ErrorState message={history.error} onRetry={history.reload} />
              : (
                <DataTable
                  rows={history.rows}
                  keyField="attendanceId"
                  emptyTitle="No attendance records available."
                  columns={[
                    { key: 'date', header: 'Date' },
                    { key: 'subjectCode', header: 'Subject Code', render: (r) => <span className="mono">{r.subjectCode}</span> },
                    { key: 'subjectName', header: 'Subject' },
                    { key: 'semester', header: 'Semester' },
                    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                    { key: 'facultyName', header: 'Marked by' },
                  ]}
                />
              )}
          </CardBody>
        </Card>
      </div>
    </>
  );
};

/* ----------------------------------------------------------------- subjects */

export const StudentSubjects = () => {
  const list = useApiList((p) => subjectsApi.list(p), []);
  const search = useDebounced(list.params.search || '');

  useEffect(() => {
    if ((list.params.search || '') !== search) list.setParam('search', search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <>
      <PageHeader title="Subjects" subtitle="Your department's subjects, organised by semester and subject code." />
      <Card>
        <CardHeader title="Subject list" actions={(
          <>
            <div style={{ minWidth: 220 }}><SearchBar value={list.params.search || ''} onChange={(v) => list.setParam('search', v)} placeholder="Search subject code or name" /></div>
            <div style={{ minWidth: 160 }}>
              <SelectInput label="" value={list.params.semester || ''} onChange={(e) => list.setParam('semester', e.target.value)}
                options={SEMESTERS} placeholder="All semesters" />
            </div>
          </>
        )} />
        <CardBody tight>
          {list.loading ? <LoadingState label="Loading subjects..." />
            : list.error ? <ErrorState message={list.error} onRetry={list.reload} />
            : (
              <DataTable
                rows={list.rows}
                keyField="subjectId"
                emptyTitle="No subject records available."
                columns={[
                  { key: 'subjectCode', header: 'Subject Code', render: (r) => <span className="mono strong">{r.subjectCode}</span> },
                  { key: 'subjectName', header: 'Subject Name' },
                  { key: 'semester', header: 'Semester', render: (r) => `Sem ${r.semester}` },
                  { key: 'credits', header: 'Credits', className: 'num' },
                  { key: 'departmentName', header: 'Department' },
                  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                ]}
              />
            )}
        </CardBody>
      </Card>
    </>
  );
};

/* -------------------------------------------------- my department / teachers */

/**
 * Student "My Department / My Teachers".
 *
 * Answers "who teaches me what" from the live SubjectAllocations + Faculty rows
 * for the student's own department and semester. Nothing here is hardcoded, and a
 * subject whose teacher has not been allocated yet is shown as "Not yet assigned"
 * instead of being hidden, so the student can tell the HOD what is missing.
 */
export const StudentDepartment = () => {
  const [state, setState] = useState({ loading: true, error: '', data: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const res = await subjectAllocationsApi.teachers();
      setState({ loading: false, error: '', data: res.data || null });
    } catch (error) {
      setState({ loading: false, error: error.message, data: null });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (state.loading) return <LoadingState label="Loading your department..." />;
  if (state.error) return <ErrorState message={state.error} onRetry={load} />;

  const data = state.data;
  if (!data || !data.student) {
    return (
      <>
        <PageHeader title="My Department" />
        <Alert tone="warning" title="Your student record could not be loaded.">
          Your account is not linked to a student record yet, so your subjects and teachers cannot be
          resolved. Please contact your department HOD.
        </Alert>
      </>
    );
  }

  const { student, hod, subjects } = data;
  const assigned = subjects.filter((s) => s.assigned);
  const unassigned = subjects.filter((s) => !s.assigned);

  // One card per teacher, listing every subject they teach this semester.
  const byFaculty = new Map();
  assigned.forEach((s) => {
    const key = s.facultyId || s.facultyEmail || s.facultyName;
    if (!byFaculty.has(key)) {
      byFaculty.set(key, { facultyId: s.facultyId, name: s.facultyName, email: s.facultyEmail, designation: s.facultyDesignation, subjects: [] });
    }
    byFaculty.get(key).subjects.push(s);
  });
  const teachers = [...byFaculty.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));

  return (
    <>
      <PageHeader
        title="My Department"
        subtitle={`${student.departmentName || 'Your department'} · register number ${student.registerNumber} · semester ${student.semester}`}
      />

      <Grid variant="stats">
        <StatCard label="Department" value={student.departmentName || '—'} hint={student.batch ? `Batch ${student.batch}` : 'Your department'} />
        <StatCard label="Subjects this semester" value={subjects.length} hint={`${assigned.length} with a teacher`} />
        <StatCard label="My Teachers" value={teachers.length} hint={teachers.length ? 'Assigned by your HOD' : 'None assigned yet'} />
        <StatCard
          label="Head of Department"
          value={hod ? hod.name : 'Not assigned'}
          hint={hod ? (hod.designation || 'Your HOD') : 'Ask your department to assign an HOD'}
          tone={hod ? '' : 'warning'}
        />
      </Grid>

      <div className="grid grid-2 mt-3">
        <Card>
          <CardHeader title="My Teachers" subtitle="One entry per faculty member, with every subject they teach you." />
          <CardBody>
            {teachers.length === 0 ? (
              <EmptyState
                title="No teacher has been assigned yet."
                description="Your HOD has not allocated any subject for this semester. Once a subject is allocated you will see the teacher here."
              />
            ) : (
              <div className="teacher-list" style={{ display: 'grid', gap: 12 }}>
                {teachers.map((t) => (
                  <div key={t.facultyId || t.email || t.name} className="teacher-card">
                    <span className={`avatar ${assigned.length ? 'faculty' : ''}`} aria-hidden="true">
                      {(t.name || '?').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()}
                    </span>
                    <div className="teacher-card-body">
                      <div className="teacher-card-title">{t.name}</div>
                      <div className="teacher-card-meta">
                        {t.designation || 'Faculty'}
                        {t.email ? ` · ${t.email}` : ''}
                      </div>
                      <div className="teacher-subjects">
                        {t.subjects.map((s) => (
                          <Badge key={s.subjectCode} tone="info">{s.subjectCode} · {s.subjectName}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="My Subjects"
            subtitle={`Every subject in semester ${student.semester}, with the teacher for each.`}
            actions={unassigned.length ? <Badge tone="warning">{unassigned.length} awaiting a teacher</Badge> : <Badge tone="success">All allocated</Badge>}
          />
          <CardBody tight>
            <DataTable
              rows={subjects}
              keyField="subjectCode"
              emptyTitle="No subjects are available for this semester."
              emptyDescription="Your department has not added subjects for this semester yet."
              columns={[
                { key: 'subjectCode', header: 'Code', render: (r) => <span className="mono strong">{r.subjectCode}</span> },
                { key: 'subjectName', header: 'Subject' },
                { key: 'credits', header: 'Credits', className: 'num' },
                {
                  key: 'facultyName',
                  header: 'Teacher',
                  render: (r) => (r.assigned
                    ? <span>{r.facultyName}{r.facultyDesignation ? <span className="muted"> · {r.facultyDesignation}</span> : null}</span>
                    : <Badge tone="warning">Not yet assigned</Badge>),
                },
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
};

/* ---------------------------------------------------------------- materials */

export const StudentMaterials = () => {
  const list = useApiList((p) => materialsApi.list(p), []);

  return (
    <>
      <PageHeader title="Study Materials" subtitle="Files shared by your department. Every link points to a real stored file." />
      <Card>
        <CardHeader title="Available materials" actions={<div style={{ minWidth: 240 }}><SearchBar value={list.params.search || ''} onChange={(v) => list.setParam('search', v)} placeholder="Search materials" /></div>} />
        <CardBody>
          {list.loading ? <LoadingState label="Loading materials..." />
            : list.error ? <ErrorState message={list.error} onRetry={list.reload} />
            : list.rows.length === 0 ? <EmptyState title="No materials available." description="Nothing has been shared for your semester yet." />
            : (
              <div className="grid grid-3">
                {list.rows.map((m) => (
                  <div key={m.materialId} className="card" style={{ padding: 16 }}>
                    <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                      <span className="mono strong">{m.subjectCode}</span>
                      <Badge tone="info">{`Sem ${m.semester}`}</Badge>
                    </div>
                    <h4 style={{ marginBottom: 6 }}>{m.title}</h4>
                    {m.description ? <p className="muted" style={{ fontSize: '0.85rem', marginBottom: 10 }}>{m.description}</p> : null}
                    <div className="muted" style={{ fontSize: '0.78rem' }}>
                      {m.uploadedBy || 'Department'}{m.createdAt ? ` · ${new Date(m.createdAt).toLocaleDateString()}` : ''}
                    </div>
                    {m.fileUrl ? (
                      <a className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} href={m.fileUrl} target="_blank" rel="noreferrer">Open file</a>
                    ) : (
                      <span className="muted" style={{ fontSize: '0.8rem', display: 'block', marginTop: 12 }}>No file attached</span>
                    )}
                  </div>
                ))}
              </div>
            )}
        </CardBody>
      </Card>
    </>
  );
};

/* -------------------------------------------------------------- assignments */

export const StudentAssignments = () => {
  const list = useApiList((p) => assignmentsApi.mine(p), []);
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState(null);
  const [values, setValues] = useState({ submissionNote: '', fileUrl: '' });
  const [errors, setErrors] = useState({});

  const openSubmit = (row) => {
    setEditing(row);
    setValues({ submissionNote: row.submission?.submissionNote || '', fileUrl: row.submission?.fileUrl || '' });
    setErrors({});
  };

  const save = async (event) => {
    event.preventDefault();
    const next = {};
    if (!values.submissionNote.trim() && !values.fileUrl.trim()) next.submissionNote = 'Add a note or a file link';
    if (values.fileUrl.trim() && !/^https?:\/\/\S+$/i.test(values.fileUrl.trim())) next.fileUrl = 'Enter a full http(s) link';
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(editing.assignmentId);
    try {
      await assignmentsApi.submit(editing.assignmentId, { submissionNote: values.submissionNote, fileUrl: values.fileUrl });
      toast.success('Assignment submitted', 'Your submission is recorded against your own record only.');
      setEditing(null);
      list.reload();
    } catch (error) {
      if (error.fieldErrors) setErrors(error.fieldErrors);
      toast.error('Could not submit assignment', error.message);
    } finally {
      setBusy('');
    }
  };

  const withdraw = async (row) => {
    setBusy(row.assignmentId);
    try {
      await assignmentsApi.withdraw(row.assignmentId);
      toast.success('Submission withdrawn');
      list.reload();
    } catch (error) {
      toast.error('Could not withdraw submission', error.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <PageHeader title="Assignments" subtitle="Assignments released for your semester." />
      <Card>
        <CardHeader title="Your assignments" actions={(
          <>
            <div style={{ minWidth: 220 }}><SearchBar value={list.params.search || ''} onChange={(v) => list.setParam('search', v)} placeholder="Search assignments" /></div>
            <div style={{ minWidth: 170 }}>
              <SelectInput label="" value={list.params.status || ''} onChange={(e) => list.setParam('status', e.target.value)}
                placeholder="All statuses"
                options={[{ value: 'pending', label: 'Pending' }, { value: 'submitted', label: 'Submitted' }, { value: 'completed', label: 'Completed' }, { value: 'overdue', label: 'Overdue' }]} />
            </div>
          </>
        )} />
        <CardBody tight>
          {list.loading ? <LoadingState label="Loading assignments..." />
            : list.error ? <ErrorState message={list.error} onRetry={list.reload} />
            : (
              <DataTable
                rows={list.rows}
                keyField="assignmentId"
                emptyTitle="No assignments available."
                columns={[
                  { key: 'title', header: 'Assignment', render: (r) => <span className="strong">{r.title}</span> },
                  { key: 'subjectCode', header: 'Subject', render: (r) => <span className="mono">{r.subjectCode}</span> },
                  { key: 'description', header: 'Description', render: (r) => <span className="muted">{r.description || '—'}</span> },
                  { key: 'assignedDate', header: 'Assigned' },
                  { key: 'dueDate', header: 'Due' },
                  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                  {
                    key: 'submittedAt',
                    header: 'Your submission',
                    render: (r) => (r.submission?.submittedAt
                      ? <span className="muted">{new Date(r.submission.submittedAt).toLocaleString()}</span>
                      : <span className="muted">Not submitted</span>),
                  },
                  {
                    key: 'action',
                    header: '',
                    className: 'actions',
                    render: (r) => (r.status === 'submitted' ? (
                      <>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openSubmit(r)}>Edit</button>
                        <button type="button" className="btn btn-ghost btn-sm" disabled={busy === r.assignmentId} onClick={() => withdraw(r)}>Withdraw</button>
                      </>
                    ) : (
                      <button type="button" className="btn btn-secondary btn-sm" disabled={busy === r.assignmentId} onClick={() => openSubmit(r)}>
                        {busy === r.assignmentId ? <span className="spinner" /> : 'Submit'}
                      </button>
                    )),
                  },
                ]}
              />
            )}
        </CardBody>
      </Card>

      <Modal
        open={Boolean(editing)}
        title="Submit assignment"
        size="narrow"
        onClose={() => setEditing(null)}
        footer={(
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)} disabled={Boolean(busy)}>Cancel</button>
            <button type="submit" form="student-assignment-form" className="btn btn-primary" disabled={Boolean(busy)}>
              {busy ? <span className="spinner" /> : 'Save submission'}
            </button>
          </>
        )}
      >
        {editing ? (
          <form id="student-assignment-form" onSubmit={save} noValidate>
            <Alert tone="info" title={editing.title}>
              {editing.subjectCode} · due {editing.dueDate || '—'}. Only your own record is affected.
            </Alert>
            <div className="mt-2">
              <TextArea label="Submission note" value={values.submissionNote} onChange={(e) => setValues((p) => ({ ...p, submissionNote: e.target.value }))} error={errors.submissionNote} placeholder="Describe what you are submitting" />
              <TextInput label="File link" value={values.fileUrl} onChange={(e) => setValues((p) => ({ ...p, fileUrl: e.target.value }))} error={errors.fileUrl} placeholder="https://..." hint="Optional link to a Drive or document file." />
            </div>
          </form>
        ) : null}
      </Modal>
    </>
  );
};

/* -------------------------------------------------------------------- marks */

export const StudentMarks = () => {
  const list = useApiList((p) => marksApi.mine(p), []);

  const total = list.rows.reduce((sum, r) => sum + (r.total || 0), 0);
  const average = list.rows.length
    ? Number((list.rows.reduce((s, r) => s + r.percentage, 0) / list.rows.length).toFixed(2))
    : 0;

  return (
    <>
      <PageHeader title="Marks" subtitle="Totals are calculated only from stored values." />
      <Grid>
        <StatCard label="Subjects graded" value={list.rows.length} icon={<IconMarks size={20} />} />
        <StatCard label="Average" value={`${average}%`} tone={average >= 50 ? 'success' : 'danger'} icon={<IconMarks size={20} />} />
        <StatCard label="Total marks" value={total} icon={<IconMarks size={20} />} />
      </Grid>
      <div className="mt-2">
        <Card>
          <CardHeader title="Mark sheet" actions={(
            <div style={{ minWidth: 170 }}>
              <SelectInput label="" value={list.params.semester || ''} onChange={(e) => list.setParam('semester', e.target.value)} options={SEMESTERS} placeholder="All semesters" />
            </div>
          )} />
          <CardBody tight>
            {list.loading ? <LoadingState label="Loading marks..." />
              : list.error ? <ErrorState message={list.error} onRetry={list.reload} />
              : (
                <DataTable
                  rows={list.rows}
                  keyField="marksId"
                  emptyTitle="No marks records available."
                  columns={[
                    { key: 'subjectCode', header: 'Subject Code', render: (r) => <span className="mono strong">{r.subjectCode}</span> },
                    { key: 'subjectName', header: 'Subject' },
                    { key: 'semester', header: 'Semester' },
                    { key: 'internalMark', header: 'Internal', className: 'num' },
                    { key: 'assignmentMark', header: 'Assignment', className: 'num' },
                    { key: 'examMark', header: 'Exam', className: 'num' },
                    { key: 'total', header: 'Total', className: 'num strong' },
                    { key: 'percentage', header: '%', className: 'num' },
                    { key: 'status', header: 'Result', render: (r) => <StatusBadge status={r.status} /> },
                  ]}
                />
              )}
          </CardBody>
        </Card>
      </div>
    </>
  );
};

/* ---------------------------------------------------------------- timetable */

export const StudentTimetable = () => {
  const list = useApiList((p) => timetableApi.list({ ...p, limit: 300 }), []);

  const grouped = DAYS
    .map((day) => ({ day, slots: list.rows.filter((r) => r.day === day).sort((a, b) => String(a.startTime).localeCompare(String(b.startTime))) }))
    .filter((g) => g.slots.length > 0);

  return (
    <>
      <PageHeader title="Timetable" subtitle="Your department's weekly class schedule." />
      <Card>
        <CardHeader title="Weekly schedule" />
        <CardBody>
          {list.loading ? <LoadingState label="Loading timetable..." />
            : list.error ? <ErrorState message={list.error} onRetry={list.reload} />
            : list.rows.length === 0 ? <EmptyState title="No timetable records available." />
            : (
              <div className="stack">
                {grouped.map(({ day, slots }) => (
                  <div key={day}>
                    <h4 style={{ marginBottom: 10 }}>{day}</h4>
                    <div className="timetable-grid">
                      {slots.map((slot) => (
                        <div key={slot.timetableId} className="timetable-slot">
                          <div className="slot-time">{slot.startTime} – {slot.endTime}</div>
                          <div className="slot-subject">{slot.subjectCode} · {slot.subjectName}</div>
                          <div className="slot-meta">
                            {slot.room ? `Room ${slot.room}` : 'Room not assigned'}{slot.semester ? ` · Sem ${slot.semester}` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
        </CardBody>
      </Card>
    </>
  );
};

/* -------------------------------------------------------------------- exams */

export const StudentExams = () => {
  const list = useApiList((p) => examsApi.list({ ...p, limit: 200 }), []);

  return (
    <>
      <PageHeader title="Examinations" subtitle="Only examinations for your department and semester are shown." />
      <Card>
        <CardHeader title="Exam schedule" actions={(
          <div style={{ minWidth: 170 }}>
            <SelectInput label="" value={list.params.examType || ''} onChange={(e) => list.setParam('examType', e.target.value)}
              placeholder="All exam types"
              options={['internal', 'assignment', 'model', 'semester', 'practical'].map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))} />
          </div>
        )} />
        <CardBody tight>
          {list.loading ? <LoadingState label="Loading examinations..." />
            : list.error ? <ErrorState message={list.error} onRetry={list.reload} />
            : (
              <DataTable
                rows={list.rows}
                keyField="examId"
                emptyTitle="No examination records available."
                columns={[
                  { key: 'examName', header: 'Exam', render: (r) => <span className="strong">{r.examName}</span> },
                  { key: 'examType', header: 'Type', render: (r) => <Badge tone="info">{r.examType}</Badge> },
                  { key: 'subjectCode', header: 'Subject Code', render: (r) => <span className="mono">{r.subjectCode}</span> },
                  { key: 'subjectName', header: 'Subject' },
                  { key: 'semester', header: 'Semester', render: (r) => `Sem ${r.semester}` },
                  { key: 'date', header: 'Date' },
                  { key: 'time', header: 'Time', render: (r) => `${r.startTime} – ${r.endTime}` },
                  { key: 'room', header: 'Room' },
                ]}
              />
            )}
        </CardBody>
      </Card>
    </>
  );
};

/* ------------------------------------------------------------ announcements */

export const StudentAnnouncements = () => {
  const list = useApiList(() => announcementsApi.list(), []);

  return (
    <>
      <PageHeader title="Announcements" subtitle="Notices targeted at you and your department." />
      <Card>
        <CardHeader title="Notices" />
        <CardBody>
          {list.loading ? <LoadingState label="Loading announcements..." />
            : list.error ? <ErrorState message={list.error} onRetry={list.reload} />
            : list.rows.length === 0 ? <EmptyState title="No announcements available." />
            : list.rows.map((a) => (
              <article key={a.announcementId} className="announcement-item">
                <div className="announcement-top">
                  <span className="announcement-title">{a.title}</span>
                  <Badge tone={a.priority === 'high' ? 'danger' : a.priority === 'medium' ? 'warning' : 'info'}>{a.priority}</Badge>
                  <Badge tone="neutral">{a.category}</Badge>
                </div>
                <div className="announcement-desc">{a.description}</div>
                <div className="announcement-meta">{a.publishDate} · {a.createdByName || 'Department'}</div>
              </article>
            ))}
        </CardBody>
      </Card>
    </>
  );
};

export { Alert };