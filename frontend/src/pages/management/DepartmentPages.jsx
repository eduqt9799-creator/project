/** HOD Department Control Center and department reports. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { dashboardApi, departmentsApi, reportsApi, reportColumnLabel } from '../../services/api';
import {
  Alert, Badge, Card, CardBody, CardHeader, DataTable, EmptyState, ErrorState, Grid,
  LoadingState, PageHeader, ProgressBar, SearchBar, SelectInput, StatCard, StatusBadge,
  TextInput, useToast,
} from '../../components/ui';
import { IconDownload, IconRefresh, IconUsers } from '../../components/Icons';
import { SEMESTERS } from '../student/index';

const ATTENDANCE_THRESHOLD = 75;

/** One row per subject, so the HOD sees at a glance which subjects need a teacher. */
const CoverageTable = ({ rows, onAllocate }) => (
  <DataTable
    rows={rows}
    keyField="subjectCode"
    rowClassName={(r) => (r.allocated ? '' : 'row-warning')}
    emptyTitle="No subjects found."
    emptyDescription="Add subjects to this department before allocating them to faculty."
    columns={[
      { key: 'semester', header: 'Semester', className: 'num' },
      { key: 'subjectCode', header: 'Code', render: (r) => <span className="mono strong">{r.subjectCode}</span> },
      { key: 'subjectName', header: 'Subject' },
      { key: 'credits', header: 'Credits', className: 'num' },
      {
        key: 'facultyName',
        header: 'Assigned Faculty',
        render: (r) => (r.allocated
          ? (
            <span>
              <span className="strong">{r.facultyName}</span>
              {r.facultyDesignation ? <span className="muted"> · {r.facultyDesignation}</span> : null}
            </span>
          )
          : <span className="muted">Not allocated</span>),
      },
      { key: 'studentCount', header: 'Students', className: 'num' },
      {
        key: '__status',
        header: 'Status',
        render: (r) => (r.allocated
          ? <StatusBadge status={r.status === 'inactive' ? 'inactive' : 'active'} label={r.status === 'inactive' ? 'Inactive' : 'Allocated'} />
          : <Badge tone="warning">Needs allocation</Badge>),
      },
      ...(onAllocate
        ? [{
          key: '__action',
          header: '',
          className: 'actions',
          render: (r) => (r.allocated ? null : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAllocate(r)}>Allocate</button>
          )),
        }]
        : []),
    ]}
  />
);

/* ------------------------------------------------------ control center */

/**
 * HOD Department Control Center.
 *
 * Surfaces allocation coverage, teaching load and at-risk students for the HOD's
 * own department. All figures come from `/dashboard/control-center`, which scopes
 * and aggregates server-side, so the page never receives another department's rows.
 */
export const DepartmentControlCenterPage = () => {
  const toast = useToast();
  const { isAdmin, departmentName } = useAuth();
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [params, setParams] = useState({ semester: '', search: '', departmentId: '' });
  const requestId = useRef(0);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    const ticket = ++requestId.current;
    try {
      const res = await dashboardApi.controlCenter({
        semester: params.semester || undefined,
        departmentId: isAdmin ? params.departmentId || undefined : undefined,
      });
      if (ticket !== requestId.current) return;
      setState({ loading: false, error: '', data: res.data || null });
    } catch (error) {
      if (ticket !== requestId.current) return;
      setState({ loading: false, error: error.message, data: null });
    }
  }, [params.semester, params.departmentId, isAdmin]);

  useEffect(() => { load(); }, [load]);

  const data = state.data;
  const term = params.search.trim().toLowerCase();
  const subjects = useMemo(() => {
    const rows = data?.subjects || [];
    if (!term) return rows;
    return rows.filter((r) => `${r.subjectCode} ${r.subjectName} ${r.facultyName}`.toLowerCase().includes(term));
  }, [data, term]);
  const workload = useMemo(() => {
    const rows = data?.workload || [];
    if (!term) return rows;
    return rows.filter((r) => `${r.name} ${r.employeeId} ${r.designation}`.toLowerCase().includes(term));
  }, [data, term]);

  if (state.loading && !data) return <LoadingState label="Loading your department..." />;
  if (state.error && !data) return <ErrorState message={state.error} onRetry={load} />;
  if (!data) return null;

  const { totals } = data;

  return (
    <>
      <PageHeader
        title="Department Control Center"
        subtitle={`${data.department?.departmentName || departmentName || 'Your department'} · allocation coverage, teaching load and student risk.`}
        actions={(
          <>
            <button type="button" className="btn btn-secondary" onClick={load}><IconRefresh size={16} />Refresh</button>
          </>
        )}
      />

      {state.error ? <div className="mb-2"><Alert tone="error">{state.error}</Alert></div> : null}

      {!data.hasAllocationsTable ? (
        <div className="mb-2">
          <Alert tone="warning" title="Subject allocations are not available yet.">
            The connected Google Sheet has no <code>SubjectAllocations</code> tab. Deploy the latest Apps Script
            and run <code>setupSheets()</code> to create it. Every figure below stays accurate without it, but
            nothing can be assigned to a faculty member.
          </Alert>
        </div>
      ) : null}

      {totals.unallocatedSubjects > 0 ? (
        <div className="mb-2">
          <Alert tone="warning" title={`${totals.unallocatedSubjects} subject${totals.unallocatedSubjects === 1 ? '' : 's'} still need a teacher.`}>
            Students cannot see a teacher for these subjects and no faculty member can publish content for them.
            Use Subject Allocation to assign an owner.
          </Alert>
        </div>
      ) : null}

      <Grid variant="stats">
        <StatCard label="Allocation coverage" value={`${totals.allocationCoverage}%`} hint={`${totals.allocatedSubjects} of ${totals.subjects} subjects`} icon={<IconUsers size={20} />} />
        <StatCard label="Unallocated subjects" value={totals.unallocatedSubjects} hint={totals.unallocatedSubjects ? 'Action required' : 'All subjects covered'} tone={totals.unallocatedSubjects ? 'warning' : 'success'} />
        <StatCard label="Faculty" value={totals.faculty} hint={`${totals.students} students`} />
        <StatCard label="Students at risk" value={totals.atRiskStudents} hint={`Below ${ATTENDANCE_THRESHOLD}% attendance`} tone={totals.atRiskStudents ? 'danger' : 'success'} />
      </Grid>

      <div className="grid grid-2 mt-3">
        <Card>
          <CardHeader
            title="Subject allocation coverage"
            subtitle="Every subject in the selected semester and who teaches it."
            actions={(
              <div className="filterbar">
                <div style={{ minWidth: 200 }}>
                  <SearchBar value={params.search} onChange={(v) => setParams((p) => ({ ...p, search: v }))} placeholder="Search subject or faculty" />
                </div>
                <SelectInput
                  label="Semester"
                  value={params.semester}
                  onChange={(e) => setParams((p) => ({ ...p, semester: e.target.value }))}
                  placeholder="All semesters"
                  options={SEMESTERS}
                />
                {isAdmin ? (
                  <AdminDepartmentFilter value={params.departmentId} onChange={(v) => setParams((p) => ({ ...p, departmentId: v }))} />
                ) : null}
              </div>
            )}
          />
          <CardBody tight>
            <CoverageTable rows={subjects} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Teaching load" subtitle="Subjects, credits and reachable students per faculty member." />
          <CardBody tight>
            <DataTable
              rows={workload}
              keyField="facultyId"
              emptyTitle="No faculty members yet."
              emptyDescription="Add faculty members to see their teaching load here."
              columns={[
                { key: 'employeeId', header: 'Employee ID', render: (r) => <span className="mono">{r.employeeId || '—'}</span> },
                { key: 'name', header: 'Faculty', render: (r) => <span className="strong">{r.name}</span> },
                { key: 'subjects', header: 'Subjects', className: 'num' },
                { key: 'credits', header: 'Credits', className: 'num' },
                { key: 'studentCount', header: 'Students', className: 'num' },
                { key: 'semesters', header: 'Semesters', render: (r) => (r.semesters || []).join(', ') || '—' },
                { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-2 mt-3">
        <Card>
          <CardHeader
            title="Students needing attention"
            subtitle={`Attendance below ${ATTENDANCE_THRESHOLD}%.`}
            actions={<Badge tone={data.atRiskStudents.length ? 'danger' : 'success'}>{data.atRiskStudents.length} student{data.atRiskStudents.length === 1 ? '' : 's'}</Badge>}
          />
          <CardBody tight>
            <DataTable
              rows={data.atRiskStudents}
              keyField="registerNumber"
              emptyTitle="No student is below the threshold."
              emptyDescription="Attendance records will appear here once classes are marked."
              columns={[
                { key: 'registerNumber', header: 'Register No', render: (r) => <span className="mono">{r.registerNumber}</span> },
                { key: 'name', header: 'Student', render: (r) => <span className="strong">{r.name}</span> },
                { key: 'semester', header: 'Semester', className: 'num' },
                { key: 'totalClasses', header: 'Classes', className: 'num' },
                { key: 'absent', header: 'Absent', className: 'num' },
                {
                  key: 'percentage',
                  header: 'Attendance',
                  render: (r) => (
                    <div style={{ minWidth: 120 }}>
                      <ProgressBar value={r.percentage} />
                      <span className="muted" style={{ fontSize: 12 }}>{r.percentage}%</span>
                    </div>
                  ),
                },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recent allocation changes" subtitle="The latest additions, reassignments and deactivations." />
          <CardBody tight>
            <DataTable
              rows={data.recentAllocations}
              keyField="allocationId"
              emptyTitle="No allocation activity yet."
              emptyDescription="Allocations you create will be listed here."
              columns={[
                { key: 'semester', header: 'Semester', className: 'num' },
                { key: 'subjectCode', header: 'Subject', render: (r) => <span className="mono">{r.subjectCode}</span> },
                { key: 'facultyName', header: 'Faculty', render: (r) => r.facultyName || '—' },
                { key: 'assignedBy', header: 'By', render: (r) => r.assignedBy || '—' },
                { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
};

/** Admin-only department picker; the HOD has no department choice to make. */
const AdminDepartmentFilter = ({ value, onChange }) => {
  const [departments, setDepartments] = useState([]);
  useEffect(() => {
    let cancelled = false;
    departmentsApi.list().then((res) => { if (!cancelled) setDepartments(res.data || []); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return (
    <SelectInput
      label="Department"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="All departments"
      options={departments.map((d) => ({ value: d.departmentId, label: d.departmentName }))}
    />
  );
};

/* ------------------------------------------------------------------ reports */

/**
 * Department reports.
 *
 * Scoped and filtered on the server; this page only renders the catalogue, the
 * filters and a preview. The download itself goes through `reportsApi.download`,
 * which fetches a CSV blob so the browser saves it (UTF-8 BOM, so Excel opens it).
 */
export const ReportsPage = () => {
  const toast = useToast();
  const { isAdmin } = useAuth();
  const [catalogue, setCatalogue] = useState([]);
  const [report, setReport] = useState('');
  const [filters, setFilters] = useState({ semester: '', subjectCode: '', status: '', from: '', to: '', departmentId: '', search: '' });
  const [preview, setPreview] = useState({ loading: false, error: '', rows: [], columns: [], total: 0 });
  const [downloading, setDownloading] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    reportsApi
      .catalogue()
      .then((res) => {
        if (cancelled) return;
        const list = res.data || [];
        setCatalogue(list);
        if (list.length) setReport((current) => current || list[0].key);
      })
      .catch((error) => { if (!cancelled) toast.error('Could not load reports', error.message); });
    return () => { cancelled = true; };
  }, [toast]);

  const definition = useMemo(() => catalogue.find((c) => c.key === report) || null, [catalogue, report]);

  const activeParams = useMemo(() => {
    const out = {};
    Object.entries(filters).forEach(([key, value]) => { if (value && value !== 'all') out[key] = value; });
    if (!isAdmin) delete out.departmentId;
    return out;
  }, [filters, isAdmin]);

  useEffect(() => {
    if (!report) return undefined;
    setPreview((p) => ({ ...p, loading: true, error: '' }));
    const ticket = ++requestId.current;
    reportsApi
      .preview(report, { ...activeParams, limit: 50 })
      .then((res) => {
        if (ticket !== requestId.current) return;
        setPreview({ loading: false, error: '', rows: res.data || [], columns: res.raw?.columns || [], total: res.raw?.total || 0 });
      })
      .catch((error) => {
        if (ticket !== requestId.current) return;
        setPreview({ loading: false, error: error.message, rows: [], columns: [], total: 0 });
      });
    return undefined;
  }, [report, activeParams]);

  const download = async () => {
    if (!report) return;
    setDownloading(true);
    try {
      const { fileName } = await reportsApi.download(report, activeParams);
      toast.success('Download started', `${fileName} — ${preview.total} row(s) exported.`);
    } catch (error) {
      toast.error('Download failed', error.message);
    } finally {
      setDownloading(false);
    }
  };

  const columns = (preview.columns.length ? preview.columns : definition?.columns || []).map((key) => ({
    key,
    header: reportColumnLabel(key),
    render: (row) => {
      const value = row[key];
      if (value === undefined || value === null || value === '') return <span className="muted">—</span>;
      if (key === 'fileUrl') {
        return <a className="btn btn-ghost btn-sm" href={String(value)} target="_blank" rel="noreferrer">Open</a>;
      }
      return String(value);
    },
  }));

  return (
    <>
      <PageHeader
        title="Department Reports"
        subtitle="Filter, preview and export your department's data as an Excel-compatible CSV."
        actions={(
          <button type="button" className="btn btn-primary" onClick={download} disabled={downloading || !report || preview.total === 0}>
            {downloading ? <span className="spinner" /> : <IconDownload size={16} />} Download CSV
          </button>
        )}
      />

      <Alert tone="info">
        Reports are generated from your own department only. A student, faculty or HOD account can never
        download another department's rows, and every download is recorded in the audit log.
      </Alert>

      <div className="grid grid-2 mt-3">
        <Card>
          <CardHeader title="Choose a report" subtitle="Each report exports the columns shown in the preview." />
          <CardBody>
            {catalogue.length === 0 ? (
              <LoadingState label="Loading available reports..." />
            ) : (
              <div className="report-list">
                {catalogue.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`report-option ${item.key === report ? 'active' : ''}`}
                    onClick={() => setReport(item.key)}
                    aria-pressed={item.key === report}
                  >
                    <span className="strong">{item.label}</span>
                    <span className="muted">{item.columns.length} columns{item.dateRange ? ' · date range available' : ''}</span>
                  </button>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Filters" subtitle="Applied to the preview and the download." />
          <CardBody>
            <div className="form-grid">
              <SelectInput
                label="Semester"
                value={filters.semester}
                onChange={(e) => setFilters((f) => ({ ...f, semester: e.target.value }))}
                placeholder="All semesters"
                options={SEMESTERS}
              />
              <TextInput
                label="Subject code"
                value={filters.subjectCode}
                onChange={(e) => setFilters((f) => ({ ...f, subjectCode: e.target.value }))}
                placeholder="e.g. CS3A"
              />
              <SelectInput
                label="Status"
                value={filters.status}
                onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
                placeholder="All"
                options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]}
              />
              {definition?.dateRange ? (
                <>
                  <TextInput
                    label="From date"
                    type="date"
                    value={filters.from}
                    onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
                  />
                  <TextInput
                    label="To date"
                    type="date"
                    value={filters.to}
                    onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
                  />
                </>
              ) : null}
              {isAdmin ? (
                <AdminDepartmentFilter
                  value={filters.departmentId}
                  onChange={(v) => setFilters((f) => ({ ...f, departmentId: v }))}
                />
              ) : null}
              <TextInput
                label="Search"
                value={filters.search}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                placeholder="Filter rows"
                className="span-2"
              />
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-block mt-2"
              onClick={() => setFilters({ semester: '', subjectCode: '', status: '', from: '', to: '', departmentId: '', search: '' })}
            >
              Clear filters
            </button>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-3">
        <CardHeader
          title={definition ? `${definition.label} preview` : 'Preview'}
          subtitle={preview.total > preview.rows.length ? `Showing ${preview.rows.length} of ${preview.total} rows. The download contains all ${preview.total}.` : ''}
          actions={preview.total ? <Badge tone="info">{preview.total} row{preview.total === 1 ? '' : 's'}</Badge> : null}
        />
        <CardBody tight>
          {preview.loading ? <LoadingState label="Building preview..." />
            : preview.error ? <ErrorState message={preview.error} />
            : preview.rows.length === 0 ? (
              <EmptyState
                title="No rows match these filters."
                description="Widen or clear the filters to see data."
              />
            ) : (
              <DataTable rows={preview.rows} keyField={columns[0]?.key} columns={columns} />
            )}
        </CardBody>
      </Card>
    </>
  );
};