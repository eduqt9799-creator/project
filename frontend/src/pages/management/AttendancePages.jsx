import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { announcementsApi, attendanceApi, departmentsApi, subjectsApi } from '../../services/api';
import {
  Alert, Badge, Card, CardBody, CardHeader, ConfirmDialog, DataTable, EmptyState, ErrorState,
  Grid, LoadingState, Modal, PageHeader, Pagination, SearchBar, SelectInput, StatCard, StatusBadge,
  TextArea, TextInput, useToast,
} from '../../components/ui';
import { IconCheck, IconClock, IconFilter, IconRefresh, IconX } from '../../components/Icons';
import { SEMESTERS } from '../student/index';

const today = () => new Date().toISOString().slice(0, 10);
const DAY_OPTIONS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/* ---------------------------------------------------------- marking screen */

/**
 * Faculty attendance marking screen.
 * Semester -> Subject -> Date are chosen here; the department always comes from
 * the authenticated faculty account and cannot be switched.
 */
export const MarkAttendancePage = () => {
  const { user, departmentName } = useAuth();
  const toast = useToast();

  const [semester, setSemester] = useState('');
  const [subjectCode, setSubjectCode] = useState('');
  const [date, setDate] = useState(today());
  const [subjects, setSubjects] = useState([]);
  const [roster, setRoster] = useState(null);
  const [marks, setMarks] = useState({});
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  useEffect(() => {
    if (!semester) { setSubjects([]); return; }
    setLoadingSubjects(true);
    setError('');
    subjectsApi.lookup({ semester, limit: 200 })
      .then((res) => setSubjects(res.data || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoadingSubjects(false));
  }, [semester]);

  const loadRoster = useCallback(async () => {
    if (!semester || !subjectCode || !date) { setRoster(null); return; }
    setLoadingRoster(true);
    setError('');
    try {
      const res = await attendanceApi.roster({ semester, subjectCode, date });
      setRoster(res.data);
      const next = {};
      (res.data.students || []).forEach((s) => { next[s.registerNumber] = s.status || ''; });
      setMarks(next);
    } catch (err) {
      setRoster(null);
      setError(err.message);
    } finally {
      setLoadingRoster(false);
    }
  }, [semester, subjectCode, date]);

  useEffect(() => { loadRoster(); }, [loadRoster]);

  const setAll = (status) => {
    const next = {};
    Object.keys(marks).forEach((reg) => { next[reg] = status; });
    setMarks(next);
  };

  const counts = useMemo(() => {
    const values = Object.values(marks).filter(Boolean);
    return {
      present: values.filter((v) => v === 'present').length,
      absent: values.filter((v) => v === 'absent').length,
      pending: Object.values(marks).filter((v) => !v).length,
      total: Object.keys(marks).length,
    };
  }, [marks]);

  const submit = async (override = false, reason = '') => {
    setSubmitting(true);
    setError('');
    try {
      const res = await attendanceApi.submit({
        semester: Number(semester),
        subjectCode,
        date,
        overrideCutoff: override,
        reason,
        departmentId: roster?.subject?.departmentId,
        students: Object.entries(marks).map(([registerNumber, status]) => ({ registerNumber, status })),
      });
      toast.success('Attendance submitted', res.message || 'Attendance saved successfully.');
      setReopenOpen(false);
      setReopenReason('');
      await loadRoster();
    } catch (err) {
      setError(err.message);
      if (err.status === 403) toast.warning('Submission closed', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const closed = roster?.submissionClosed;
  const canOverride = user.role !== 'student';

  return (
    <>
      <PageHeader
        title="Attendance"
        subtitle={`Department: ${roster?.subject?.departmentName || departmentName || 'your department'} (from your account)`}
        actions={<button type="button" className="btn btn-secondary" onClick={loadRoster}><IconRefresh size={16} />Refresh roster</button>}
      />

      <Card>
        <CardHeader title="Session details" subtitle="Select semester, subject and date to load the authorised student list" />
        <CardBody>
          {error ? <div className="mb-2"><Alert tone="error" title="Could not complete the request">{error}</Alert></div> : null}
          <div className="form-grid">
            <SelectInput label="Semester" required value={semester} onChange={(e) => { setSemester(e.target.value); setSubjectCode(''); }}
              placeholder="Select semester" options={SEMESTERS} />
            <SelectInput label="Subject" required value={subjectCode} onChange={(e) => setSubjectCode(e.target.value)}
              placeholder={semester ? 'Select subject' : 'Select a semester first'}
              options={subjects.map((s) => ({ value: s.subjectCode, label: `${s.subjectCode} · ${s.subjectName}` }))}
              disabled={!semester || loadingSubjects} />
            <TextInput label="Date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} max={today()} />
          </div>
          {roster?.alreadySubmitted ? (
            <div className="mt-2">
              <Alert tone="warning" title="Attendance already submitted">
                {counts.total} student record(s) already exist for {subjectCode} on {date}. Submitting again will update them and the change is logged.
              </Alert>
            </div>
          ) : null}
          {closed ? (
            <div className="mt-2">
              <Alert tone="error" title="Submission closed">
                Attendance submission is closed after 5:00 PM IST.
                {canOverride ? ' As an authorised approver you may reopen the session — every reopen is logged with your name, the time and the reason.' : ''}
              </Alert>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <div className="mt-2">
        <Card>
          <CardHeader title="Student register" subtitle={roster ? `${roster.subject.subjectCode} · ${roster.subject.subjectName} · Sem ${roster.subject.semester}` : 'Choose a session above'} />
          {roster ? (
            <div className="mark-all-row">
              <button type="button" className="btn btn-success btn-sm" onClick={() => setAll('present')}><IconCheck size={15} />Mark all present</button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => setAll('absent')}><IconX size={15} />Mark all absent</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMarks({})}>Reset</button>
              <span className="summary">
                {counts.present} present · {counts.absent} absent · {counts.pending} unmarked
              </span>
              {closed && canOverride ? (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setReopenOpen(true)} disabled={submitting}>
                  <IconClock size={15} />Reopen &amp; submit
                </button>
              ) : (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => submit(false)} disabled={submitting || counts.pending > 0}>
                  {submitting ? <span className="spinner" /> : null}Submit attendance
                </button>
              )}
            </div>
          ) : null}
          <CardBody tight>
            {loadingRoster ? <LoadingState label="Loading students..." />
              : !roster ? <EmptyState title="No attendance records available." description="Select a semester, subject and date to load the authorised student list." />
              : roster.students.length === 0 ? <EmptyState title="No student records available." description="No active students are registered for this semester in your department." />
              : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Register Number</th>
                        <th scope="col">Student Name</th>
                        <th scope="col">Attendance Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roster.students.map((student) => (
                        <tr key={student.registerNumber}>
                          <td><span className="mono strong">{student.registerNumber}</span></td>
                          <td>{student.name}</td>
                          <td>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              {['present', 'absent'].map((status) => (
                                <label key={status} className={`checkbox-row ${marks[student.registerNumber] === status ? 'checked' : ''}`}>
                                  <input
                                    type="radio"
                                    name={`att-${student.registerNumber}`}
                                    checked={marks[student.registerNumber] === status}
                                    onChange={() => setMarks((prev) => ({ ...prev, [student.registerNumber]: status }))}
                                  />
                                  <span>{status === 'present' ? 'Present' : 'Absent'}</span>
                                </label>
                              ))}
                              {!marks[student.registerNumber] ? <span className="badge badge-warning">Unmarked</span> : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </CardBody>
        </Card>
      </div>

      <Modal
        open={reopenOpen}
        title="Reopen attendance session"
        size="narrow"
        onClose={() => setReopenOpen(false)}
        footer={(
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setReopenOpen(false)} disabled={submitting}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={() => submit(true, reopenReason)} disabled={submitting || reopenReason.trim().length < 3}>
              {submitting ? <span className="spinner" /> : null}Reopen &amp; submit
            </button>
          </>
        )}
      >
        <Alert tone="warning" title="This action is audited">
          Attendance for {subjectCode} on {date} was submitted after the 5:00 PM IST cutoff.
          Your name, role, the timestamp and the reason below will be recorded.
        </Alert>
        <div className="mt-2">
          <TextArea label="Reason for reopening" required value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="Explain why this session is being reopened" />
        </div>
      </Modal>
    </>
  );
};

/* --------------------------------------------------------------- history */

export const AttendanceHistoryPage = ({ canReopen = false }) => {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const departments = useDepartmentOptionsLocal(isAdmin);

  const [params, setParams] = useState({ page: 1, limit: 25, date: '', startDate: '', endDate: '', semester: '', subjectCode: '', registerNumber: '', status: '' });
  const [state, setState] = useState({ loading: true, error: '', rows: [], pagination: null });
  const [subjects, setSubjects] = useState([]);
  const [editing, setEditing] = useState(null);
  const [status, setStatus] = useState('present');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const res = await attendanceApi.history(params);
      setState({ loading: false, error: '', rows: res.data || [], pagination: res.pagination || null });
    } catch (error) {
      setState({ loading: false, error: error.message, rows: [], pagination: null });
    }
  }, [params]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!params.semester) { setSubjects([]); return; }
    subjectsApi.lookup({ semester: params.semester }).then((res) => setSubjects(res.data || [])).catch(() => setSubjects([]));
  }, [params.semester]);

  const setParam = (key, value) => setParams((p) => ({ ...p, [key]: value, page: 1 }));

  const saveCorrection = async () => {
    setSaving(true);
    try {
      await attendanceApi.update(editing.attendanceId, { status, reason });
      toast.success('Attendance updated', 'The correction was logged with your name and reason.');
      setEditing(null);
      setReason('');
      load();
    } catch (error) {
      toast.error('Could not update attendance', error.message);
    } finally {
      setSaving(false);
    }
  };

  const counts = useMemo(() => {
    const present = state.rows.filter((r) => String(r.status).toLowerCase() === 'present').length;
    return { present, absent: state.rows.length - present };
  }, [state.rows]);

  return (
    <>
      <PageHeader title="Attendance History" subtitle="Filterable history of every authorised attendance record." actions={<button type="button" className="btn btn-secondary" onClick={load}><IconRefresh size={16} />Refresh</button>} />
      <Grid>
        <StatCard label="Records on this page" value={state.rows.length} icon={<IconFilter size={20} />} />
        <StatCard label="Present" value={counts.present} tone="success" icon={<IconCheck size={20} />} />
        <StatCard label="Absent" value={counts.absent} tone="danger" icon={<IconX size={20} />} />
        <StatCard label="Total matching filters" value={state.pagination?.total ?? 0} icon={<IconClock size={20} />} />
      </Grid>
      <div className="mt-2">
        <Card>
          <CardHeader title="Filters" />
          <CardBody>
            <div className="filterbar">
              <div style={{ minWidth: 200 }}><SearchBar value={params.registerNumber || ''} onChange={(v) => setParam('registerNumber', v)} placeholder="Register number or student name" /></div>
              <TextInput label="Date" type="date" value={params.date || ''} onChange={(e) => setParam('date', e.target.value)} />
              <TextInput label="From" type="date" value={params.startDate || ''} onChange={(e) => setParam('startDate', e.target.value)} />
              <TextInput label="To" type="date" value={params.endDate || ''} onChange={(e) => setParam('endDate', e.target.value)} />
              <SelectInput label="Semester" value={params.semester || ''} onChange={(e) => setParam('semester', e.target.value)} placeholder="All semesters" options={SEMESTERS} />
              <SelectInput label="Subject" value={params.subjectCode || ''} onChange={(e) => setParam('subjectCode', e.target.value)} placeholder="All subjects"
                options={subjects.map((s) => ({ value: s.subjectCode, label: `${s.subjectCode} · ${s.subjectName}` }))} />
              <SelectInput label="Status" value={params.status || ''} onChange={(e) => setParam('status', e.target.value)} placeholder="All statuses"
                options={[{ value: 'present', label: 'Present' }, { value: 'absent', label: 'Absent' }]} />
              {isAdmin ? (
                <SelectInput label="Department" value={params.departmentId || ''} onChange={(e) => setParam('departmentId', e.target.value)} placeholder="All departments"
                  options={departments.map((d) => ({ value: d.departmentId, label: d.departmentName }))} />
              ) : null}
              <button type="button" className="btn btn-secondary" onClick={() => setParams({ page: 1, limit: 25, date: '', startDate: '', endDate: '', semester: '', subjectCode: '', registerNumber: '', status: '' })}>Clear</button>
            </div>
          </CardBody>
        </Card>
      </div>
      <div className="mt-2">
        <Card>
          <CardHeader title="Attendance records" subtitle="Sorted by date (newest first) then register number" />
          <CardBody tight>
            {state.loading ? <LoadingState label="Loading attendance..." />
              : state.error ? <ErrorState message={state.error} onRetry={load} />
              : (
                <DataTable
                  rows={state.rows}
                  keyField="attendanceId"
                  emptyTitle="No attendance records available."
                  columns={[
                    { key: 'date', header: 'Date' },
                    { key: 'registerNumber', header: 'Register Number', render: (r) => <span className="mono strong">{r.registerNumber}</span> },
                    { key: 'studentName', header: 'Student' },
                    { key: 'subjectCode', header: 'Subject', render: (r) => <span className="mono">{r.subjectCode}</span> },
                    { key: 'subjectName', header: 'Subject Name' },
                    { key: 'semester', header: 'Semester', className: 'num' },
                    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                    { key: 'facultyName', header: 'Marked By' },
                    ...(isAdmin ? [{ key: 'departmentName', header: 'Department' }] : []),
                    ...(canReopen ? [{
                      key: '__actions',
                      header: 'Actions',
                      className: 'actions',
                      render: (r) => (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setEditing(r); setStatus(r.status); setReason(''); }}>
                          Correct
                        </button>
                      ),
                    }] : []),
                  ]}
                />
              )}
          </CardBody>
          <Pagination pagination={state.pagination} onPageChange={(page) => setParams((p) => ({ ...p, page }))} />
        </Card>
      </div>

      <Modal
        open={Boolean(editing)}
        title="Correct attendance record"
        size="narrow"
        onClose={() => setEditing(null)}
        footer={(
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={saveCorrection} disabled={saving || reason.trim().length < 3}>
              {saving ? <span className="spinner" /> : null}Save correction
            </button>
          </>
        )}
      >
        {editing ? (
          <>
            <Alert tone="info" title="Audited change">
              {editing.registerNumber} · {editing.subjectCode} · {editing.date} — currently marked <strong>{editing.status}</strong>.
              Your name, role, time and reason are recorded.
            </Alert>
            <div className="mt-2">
              <SelectInput label="Corrected status" required value={status} onChange={(e) => setStatus(e.target.value)}
                options={[{ value: 'present', label: 'Present' }, { value: 'absent', label: 'Absent' }]} />
              <TextArea label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this record being corrected?" />
            </div>
          </>
        ) : null}
      </Modal>
    </>
  );
};

const useDepartmentOptionsLocal = (enabled) => {
  const [departments, setDepartments] = useState([]);
  useEffect(() => {
    if (!enabled) return;
    departmentsApi.list().then((res) => setDepartments(res.data || [])).catch(() => setDepartments([]));
  }, [enabled]);
  return departments;
};

/* --------------------------------------------------------- announcements */

export const AnnouncementsPage = () => {
  const { user, isAdmin, departmentName } = useAuth();
  const toast = useToast();
  const departments = useDepartmentOptionsLocal(isAdmin);

  const [params, setParams] = useState({ search: '', category: '', priority: '' });
  const [state, setState] = useState({ loading: true, error: '', rows: [] });
  const [editing, setEditing] = useState(null);
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const res = await announcementsApi.list(params);
      setState({ loading: false, error: '', rows: res.data || [] });
    } catch (error) {
      setState({ loading: false, error: error.message, rows: [] });
    }
  }, [params]);

  useEffect(() => { load(); }, [load]);

  const canCreate = ['admin', 'hod', 'faculty'].includes(user.role);

  const submit = async (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!values.title || values.title.trim().length < 3) nextErrors.title = 'Enter at least 3 characters';
    if (!values.description || values.description.trim().length < 3) nextErrors.description = 'Enter at least 3 characters';
    if (!values.category || values.category.trim().length < 2) nextErrors.category = 'Enter a category';
    if (!['low', 'medium', 'high'].includes(values.priority)) nextErrors.priority = 'Choose a priority';
    if (!values.publishDate || !/^\d{4}-\d{2}-\d{2}$/.test(values.publishDate)) nextErrors.publishDate = 'Use YYYY-MM-DD';
    if (user.role === 'faculty' && !['faculty', 'all'].includes(values.targetRole)) nextErrors.targetRole = 'Faculty may target faculty or all';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSaving(true);
    try {
      const payload = { ...values };
      if (isAdmin && values.departmentId) payload.departmentId = values.departmentId;
      if (editing === 'new') {
        await announcementsApi.create(payload);
        toast.success('Announcement published');
      } else {
        await announcementsApi.update(editing.announcementId, payload);
        toast.success('Announcement updated');
      }
      setEditing(null);
      load();
    } catch (error) {
      if (error.fieldErrors) setErrors(error.fieldErrors);
      toast.error('Could not save announcement', error.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await announcementsApi.remove(deleting.announcementId);
      toast.success('Announcement removed');
      setDeleting(null);
      load();
    } catch (error) {
      toast.error('Could not remove announcement', error.message);
    } finally {
      setSaving(false);
    }
  };

  const setParam = (key, value) => setParams((p) => ({ ...p, [key]: value }));

  return (
    <>
      <PageHeader
        title="Announcements"
        subtitle={isAdmin ? 'Publish global or department notices.' : `Notices for ${departmentName || 'your department'}.`}
        actions={canCreate ? (
          <button type="button" className="btn btn-primary" onClick={() => { setEditing('new'); setValues({ publishDate: today(), priority: 'medium', targetRole: 'all', category: 'General' }); setErrors({}); }}>
            New announcement
          </button>
        ) : null}
      />
      <Card>
        <CardHeader title="Announcements" actions={(
          <div className="filterbar">
            <div style={{ minWidth: 220 }}><SearchBar value={params.search} onChange={(v) => setParam('search', v)} placeholder="Search announcements" /></div>
            <SelectInput label="Priority" value={params.priority} onChange={(e) => setParam('priority', e.target.value)} placeholder="All priorities"
              options={[{ value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }]} />
          </div>
        )} />
        <CardBody>
          {state.loading ? <LoadingState label="Loading announcements..." />
            : state.error ? <ErrorState message={state.error} onRetry={load} />
            : state.rows.length === 0 ? <EmptyState title="No announcements available." />
            : state.rows.map((a) => {
              const canManage = isAdmin || (a.departmentId === user.departmentId && (user.role === 'hod' || a.createdBy === user.userId));
              return (
                <article key={a.announcementId} className="announcement-item">
                  <div className="announcement-top">
                    <span className="announcement-title">{a.title}</span>
                    <Badge tone={a.priority === 'high' ? 'danger' : a.priority === 'medium' ? 'warning' : 'info'}>{a.priority}</Badge>
                    <Badge tone="neutral">{a.category}</Badge>
                    <Badge tone="neutral">Target: {a.targetRole}</Badge>
                    {a.departmentName ? <Badge tone="info">{a.departmentName}</Badge> : <Badge tone="info">All departments</Badge>}
                    {canManage ? (
                      <span className="row" style={{ marginLeft: 'auto', gap: 6 }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setEditing(a); setValues({ title: a.title, description: a.description, category: a.category, priority: a.priority, targetRole: a.targetRole, publishDate: a.publishDate, departmentId: a.departmentId }); setErrors({}); }}>Edit</button>
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => setDeleting(a)}>Remove</button>
                      </span>
                    ) : null}
                  </div>
                  <div className="announcement-desc">{a.description}</div>
                  <div className="announcement-meta">{a.publishDate} · {a.createdByName || 'Department'}{a.updatedBy ? ` · updated by ${a.updatedBy}` : ''}</div>
                </article>
              );
            })}
        </CardBody>
      </Card>

      <Modal
        open={editing !== null}
        title={editing === 'new' ? 'New announcement' : 'Edit announcement'}
        onClose={() => setEditing(null)}
        footer={(
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
            <button type="submit" form="announcement-form" className="btn btn-primary" disabled={saving}>{saving ? <span className="spinner" /> : 'Save'}</button>
          </>
        )}
      >
        <form id="announcement-form" onSubmit={submit} noValidate>
          <TextInput label="Title" required value={values.title || ''} onChange={(e) => setValues((p) => ({ ...p, title: e.target.value }))} error={errors.title} />
          <TextArea label="Description" required value={values.description || ''} onChange={(e) => setValues((p) => ({ ...p, description: e.target.value }))} error={errors.description} />
          <div className="form-grid">
            <TextInput label="Category" required value={values.category || ''} onChange={(e) => setValues((p) => ({ ...p, category: e.target.value }))} error={errors.category} />
            <SelectInput label="Priority" required value={values.priority || ''} onChange={(e) => setValues((p) => ({ ...p, priority: e.target.value }))} error={errors.priority}
              options={[{ value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }]} />
            <SelectInput label="Target role" required value={values.targetRole || ''} onChange={(e) => setValues((p) => ({ ...p, targetRole: e.target.value }))} error={errors.targetRole}
              options={[
                { value: 'all', label: 'Everyone' },
                { value: 'student', label: 'Students', disabled: user.role === 'faculty' },
                { value: 'faculty', label: 'Faculty' },
                { value: 'hod', label: 'HOD', disabled: user.role === 'faculty' },
              ].filter((o) => !o.disabled)} />
            <TextInput label="Publish date" type="date" required value={values.publishDate || ''} onChange={(e) => setValues((p) => ({ ...p, publishDate: e.target.value }))} error={errors.publishDate} max={today()} />
            {isAdmin ? (
              <SelectInput label="Department" value={values.departmentId || ''} onChange={(e) => setValues((p) => ({ ...p, departmentId: e.target.value }))}
                placeholder="All departments (global)"
                options={departments.map((d) => ({ value: d.departmentId, label: d.departmentName }))}
                hint="Leave empty to publish globally" />
            ) : null}
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Remove announcement"
        message={`Remove "${deleting?.title}"? Notifications already sent are not recalled.`}
        confirmLabel="Remove"
        loading={saving}
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
      />
    </>
  );
};

export { DAY_OPTIONS };