import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { ToastProvider } from './components/ui';
import { useAuth } from './context/AuthContext';
import { ProtectedRoute, PublicOnlyRoute, RoleRoute } from './routes/guards';
import Login from './pages/Login';
import AccessDenied from './pages/AccessDenied';
import NotFound from './pages/NotFound';
import { NotificationsPage, ProfilePage, SecurityPage } from './pages/common';
import {
  StudentAnnouncements, StudentAssignments, StudentAttendance, StudentDashboard,
  StudentDepartment, StudentExams, StudentMarks, StudentMaterials, StudentSubjects, StudentTimetable,
} from './pages/student';
import { AdminDashboard, FacultyDashboard, HodDashboard } from './pages/management/Dashboard';
import { AnnouncementsPage, AttendanceHistoryPage, MarkAttendancePage } from './pages/management/AttendancePages';
import {
  AssignmentsPage, DepartmentsPage, ExamsPage, FacultyPage, FacultyStudentsPage, HodsPage,
  MarksPage, MaterialsPage, StudentsPage, SubjectAllocationPage, SubjectsPage, TimetablePage, UsersPage,
} from './pages/management/CrudPages';
import { DepartmentControlCenterPage, ReportsPage } from './pages/management/DepartmentPages';

/** Sends any authenticated user to the dashboard for their role. */
const RoleHomeRedirect = () => {
  const { homePath } = useAuth();
  return <Navigate to={homePath} replace />;
};

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        {/* public */}
        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<Login />} />
        </Route>

        {/* authenticated shell */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route index element={<RoleHomeRedirect />} />
            <Route path="dashboard" element={<RoleHomeRedirect />} />

            {/* shared */}
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="security" element={<SecurityPage />} />

            {/* student */}
            <Route element={<RoleRoute roles="student" />}>
              <Route path="student/dashboard" element={<StudentDashboard />} />
              <Route path="student/department" element={<StudentDepartment />} />
              <Route path="student/attendance" element={<StudentAttendance />} />
              <Route path="student/subjects" element={<StudentSubjects />} />
              <Route path="student/materials" element={<StudentMaterials />} />
              <Route path="student/assignments" element={<StudentAssignments />} />
              <Route path="student/marks" element={<StudentMarks />} />
              <Route path="student/timetable" element={<StudentTimetable />} />
              <Route path="student/exams" element={<StudentExams />} />
              <Route path="student/announcements" element={<StudentAnnouncements />} />
              <Route path="student/profile" element={<ProfilePage />} />
            </Route>

            {/* faculty */}
            <Route element={<RoleRoute roles="faculty" />}>
              <Route path="faculty/dashboard" element={<FacultyDashboard />} />
              <Route path="faculty/students" element={<FacultyStudentsPage />} />
              <Route path="faculty/attendance" element={<MarkAttendancePage />} />
              <Route path="faculty/attendance-history" element={<AttendanceHistoryPage />} />
              <Route path="faculty/subjects" element={<SubjectsPage canEdit={false} />} />
              <Route path="faculty/materials" element={<MaterialsPage />} />
              <Route path="faculty/assignments" element={<AssignmentsPage />} />
              <Route path="faculty/marks" element={<MarksPage />} />
              <Route path="faculty/timetable" element={<TimetablePage />} />
              <Route path="faculty/exams" element={<ExamsPage />} />
              <Route path="faculty/announcements" element={<AnnouncementsPage />} />
              <Route path="faculty/reports" element={<ReportsPage />} />
              <Route path="faculty/profile" element={<ProfilePage />} />
            </Route>

            {/* hod */}
            <Route element={<RoleRoute roles="hod" />}>
              <Route path="hod/dashboard" element={<HodDashboard />} />
              <Route path="hod/control-center" element={<DepartmentControlCenterPage />} />
              <Route path="hod/allocations" element={<SubjectAllocationPage />} />
              <Route path="hod/students" element={<StudentsPage />} />
              <Route path="hod/faculty" element={<FacultyPage />} />
              <Route path="hod/subjects" element={<SubjectsPage />} />
              <Route path="hod/departments" element={<DepartmentsPage />} />
              <Route path="hod/attendance" element={<AttendanceHistoryPage canReopen />} />
              <Route path="hod/materials" element={<MaterialsPage />} />
              <Route path="hod/assignments" element={<AssignmentsPage />} />
              <Route path="hod/marks" element={<MarksPage />} />
              <Route path="hod/timetable" element={<TimetablePage />} />
              <Route path="hod/exams" element={<ExamsPage />} />
              <Route path="hod/announcements" element={<AnnouncementsPage />} />
              <Route path="hod/reports" element={<ReportsPage />} />
              <Route path="hod/profile" element={<ProfilePage />} />
            </Route>

            {/* admin */}
            <Route element={<RoleRoute roles="admin" />}>
              <Route path="admin/dashboard" element={<AdminDashboard />} />
              <Route path="admin/departments" element={<DepartmentsPage adminOnly />} />
              <Route path="admin/users" element={<UsersPage />} />
              <Route path="admin/students" element={<StudentsPage />} />
              <Route path="admin/faculty" element={<FacultyPage />} />
              <Route path="admin/hods" element={<HodsPage />} />
              <Route path="admin/allocations" element={<SubjectAllocationPage />} />
              <Route path="admin/subjects" element={<SubjectsPage />} />
              <Route path="admin/attendance" element={<AttendanceHistoryPage canReopen />} />
              <Route path="admin/materials" element={<MaterialsPage />} />
              <Route path="admin/assignments" element={<AssignmentsPage />} />
              <Route path="admin/marks" element={<MarksPage />} />
              <Route path="admin/timetable" element={<TimetablePage />} />
              <Route path="admin/exams" element={<ExamsPage />} />
              <Route path="admin/announcements" element={<AnnouncementsPage />} />
              <Route path="admin/reports" element={<ReportsPage />} />
              <Route path="admin/profile" element={<ProfilePage />} />
            </Route>

            <Route path="403" element={<AccessDenied />} />
            <Route path="404" element={<NotFound />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>
    </ToastProvider>
  );
}