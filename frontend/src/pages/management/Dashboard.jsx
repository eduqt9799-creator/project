import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { dashboardApi } from '../../services/api';
import {
  Badge, Card, CardBody, CardHeader, DataTable, EmptyState, ErrorState, Grid, LoadingState,
  PageHeader, ProgressBar, StatCard, StatusBadge,
} from '../../components/ui';
import {
  IconAttendance, IconBook, IconBooks, IconBuilding, IconClipboard, IconExam, IconMarks,
  IconMegaphone, IconShield, IconUsers, IconUser,
} from '../../components/Icons';

const SectionCard = ({ title, subtitle, children, action }) => (
  <Card>
    <CardHeader title={title} subtitle={subtitle} actions={action} />
    <CardBody>{children}</CardBody>
  </Card>
);

/**
 * Dashboard for faculty, HOD and admin.
 * Every value is taken from the backend — nothing is hardcoded or estimated.
 */
const ManagementDashboard = ({ variant }) => {
  const { user, departmentName } = useAuth();
  const [state, setState] = useState({ loading: true, error: '', data: null });

  useEffect(() => {
    document.title = `${variant === 'admin' ? 'Admin' : variant === 'hod' ? 'HOD' : 'Faculty'} Dashboard · Hindusthan Department ERP`;
  }, [variant]);

  const load = async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const res = await dashboardApi.get();
      setState({ loading: false, error: '', data: res.data });
    } catch (error) {
      setState({ loading: false, error: error.message, data: null });
    }
  };

  useEffect(() => { load(); }, []);

  const d = state.data || {};
  const scopeLabel = d.department?.allDepartments
    ? 'All departments'
    : (d.department?.departmentName || departmentName || 'Your department');

  // Declared before any early return so the hook order never changes.
  const stats = useMemo(() => [
    { key: 'students', label: 'Students', value: d.students?.total ?? 0, hint: `${d.students?.active ?? 0} active`, icon: <IconUsers size={20} /> },
    { key: 'faculty', label: 'Faculty', value: d.faculty?.total ?? 0, icon: <IconUser size={20} /> },
    ...(variant === 'admin' || variant === 'hod'
      ? [{ key: 'subjects', label: 'Subjects', value: d.subjects?.total ?? 0, icon: <IconBook size={20} /> },
        ...(variant === 'hod'
          ? [{ key: 'allocation', label: 'Unallocated subjects', value: d.allocations?.unallocatedSubjects ?? 0, hint: `${d.allocations?.coverage ?? 0}% allocated`, tone: (d.allocations?.unallocatedSubjects ?? 0) > 0 ? 'warning' : 'success', icon: <IconClipboard size={20} /> }]
          : []),
        { key: 'departments', label: variant === 'admin' ? 'Departments' : 'Department', value: d.departments?.total ?? 0, icon: <IconBuilding size={20} /> }]
      : []),
    ...(variant === 'admin' ? [{ key: 'hods', label: 'HODs', value: d.hods?.total ?? 0, icon: <IconShield size={20} /> }] : []),
    { key: 'attendance', label: 'Attendance records', value: d.attendance?.records ?? 0, hint: `${d.attendance?.sessions ?? 0} sessions`, icon: <IconAttendance size={20} /> },
    { key: 'percentage', label: 'Attendance rate', value: `${d.attendance?.percentage ?? 0}%`, tone: (d.attendance?.percentage ?? 0) >= 75 ? 'success' : 'warning', icon: <IconAttendance size={20} /> },
    { key: 'assignments', label: 'Assignments', value: d.assignments?.total ?? 0, icon: <IconClipboard size={20} /> },
    { key: 'materials', label: 'Materials', value: d.materials?.total ?? 0, icon: <IconBooks size={20} /> },
    { key: 'exams', label: 'Exams', value: d.exams?.total ?? 0, hint: `${d.exams?.upcoming ?? 0} upcoming`, icon: <IconExam size={20} /> },
    { key: 'announcements', label: 'Announcements', value: d.announcements?.total ?? 0, icon: <IconMegaphone size={20} /> },
    ...(variant === 'admin'
      ? [{ key: 'users', label: 'Active accounts', value: d.system?.activeUsers ?? 0, hint: `${d.system?.totalUsers ?? 0} total users`, icon: <IconShield size={20} /> },
        { key: 'marks', label: 'Marks records', value: d.marks?.total ?? 0, icon: <IconMarks size={20} /> }]
      : [{ key: 'marks', label: 'Marks records', value: d.marks?.total ?? 0, hint: `${d.marksAverage ?? 0}% average`, icon: <IconMarks size={20} /> }]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [state.data, variant]);

  if (state.loading) return <LoadingState label="Loading dashboard..." />;
  if (state.error) return <ErrorState message={state.error} onRetry={load} />;

  const noData = (d.students?.total ?? 0) === 0 && (d.faculty?.total ?? 0) === 0 && (d.subjects?.total ?? 0) === 0;

  return (
    <>
      <PageHeader
        title={`Welcome, ${user?.name || ''}`}
        subtitle={`${scopeLabel} · live figures from the department data store`}
        actions={
          variant === 'hod' ? (
            <Link className="btn btn-primary" to="/hod/control-center">
              <IconClipboard size={16} />Department Control Center
            </Link>
          ) : variant === 'admin' ? (
            <Link className="btn btn-primary" to="/admin/allocations">
              <IconClipboard size={16} />Subject Allocation
            </Link>
          ) : null
        }
      />

      {noData ? (
        <div className="mb-2">
          <Card>
            <EmptyState
              title="No data available."
              description={`There are no student, faculty or subject records for ${scopeLabel.toLowerCase()} yet.`}
            />
          </Card>
        </div>
      ) : null}

      <Grid>
        {stats.map((s) => (
          <StatCard key={s.key} label={s.label} value={s.value} hint={s.hint} icon={s.icon} tone={s.tone || ''} />
        ))}
      </Grid>

      <div className="grid grid-2 mt-2">
        <SectionCard title="Recent attendance" subtitle="Latest sessions recorded">
          {!d.recentAttendance || d.recentAttendance.length === 0 ? <EmptyState title="No attendance records available." /> : (
            <DataTable
              rows={d.recentAttendance}
              keyField="attendanceId"
              emptyTitle="No attendance records available."
              columns={[
                { key: 'date', header: 'Date' },
                { key: 'subjectCode', header: 'Subject', render: (r) => <span className="mono">{r.subjectCode}</span> },
                { key: 'registerNumber', header: 'Register No.', render: (r) => <span className="mono">{r.registerNumber}</span> },
                { key: 'studentName', header: 'Student' },
                { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              ]}
            />
          )}
        </SectionCard>

        <SectionCard title="Recent announcements" subtitle="Latest notices">
          {!d.recentAnnouncements || d.recentAnnouncements.length === 0 ? <EmptyState title="No announcements available." /> : (
            <div>
              {d.recentAnnouncements.map((a) => (
                <div key={a.announcementId} className="announcement-item">
                  <div className="announcement-top">
                    <span className="announcement-title">{a.title}</span>
                    <Badge tone={a.priority === 'high' ? 'danger' : a.priority === 'medium' ? 'warning' : 'info'}>{a.priority}</Badge>
                  </div>
                  <div className="announcement-meta">{a.category} · {a.publishDate} · {a.createdByName || 'Department'}</div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {variant === 'admin' && d.departmentsBreakdown?.length ? (
        <div className="mt-2">
          <SectionCard title="Departments" subtitle="Real counts per department">
            <DataTable
              rows={d.departmentsBreakdown}
              keyField="departmentId"
              emptyTitle="No department records available."
              columns={[
                { key: 'departmentCode', header: 'Code', render: (r) => <span className="mono strong">{r.departmentCode}</span> },
                { key: 'departmentName', header: 'Department' },
                { key: 'students', header: 'Students', className: 'num' },
                { key: 'faculty', header: 'Faculty', className: 'num' },
                { key: 'subjects', header: 'Subjects', className: 'num' },
              ]}
            />
          </SectionCard>
        </div>
      ) : null}

      {d.topStudents?.length ? (
        <div className="mt-2">
          <SectionCard title="Students (register number order)" subtitle="First 10 students by register number">
            <DataTable
              rows={d.topStudents}
              keyField="studentId"
              emptyTitle="No student records available."
              columns={[
                { key: 'registerNumber', header: 'Register Number', render: (r) => <span className="mono strong">{r.registerNumber}</span> },
                { key: 'name', header: 'Name' },
                { key: 'semester', header: 'Semester' },
                { key: 'departmentName', header: 'Department' },
                { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              ]}
            />
          </SectionCard>
        </div>
      ) : null}

      <div className="mt-2">
        <SectionCard title="Attendance rate" subtitle="Present records as a share of all attendance records">
          <ProgressBar value={d.attendance?.percentage ?? 0} />
          <div className="muted mt-1" style={{ fontSize: '0.85rem' }}>
            {d.attendance?.present ?? 0} present · {d.attendance?.absent ?? 0} absent · {d.attendance?.records ?? 0} records
          </div>
        </SectionCard>
      </div>
    </>
  );
};

export const FacultyDashboard = () => <ManagementDashboard variant="faculty" />;
export const HodDashboard = () => <ManagementDashboard variant="hod" />;
export const AdminDashboard = () => <ManagementDashboard variant="admin" />;