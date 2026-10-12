import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { notificationsApi } from '../services/api';
import { notificationRoute } from '../utils/notifications';
import {
  IconAttendance, IconBell, IconBook, IconBooks, IconBuilding, IconCalendar, IconClipboard,
  IconDashboard, IconDownload, IconExam, IconLogout, IconMarks, IconMegaphone, IconMenu,
  IconSettings, IconShield, IconUser, IconUsers,
} from './Icons';
import { EmptyState } from './ui';

/** Profile / notifications / security are available to every role. */
const ACCOUNT_ITEMS = (base) => [
  { to: `${base}/profile`, label: 'My Profile', icon: IconUser },
  { to: '/notifications', label: 'Notifications', icon: IconBell },
  { to: '/security', label: 'Security', icon: IconShield },
];

const NAV_BY_ROLE = {
  student: [
    { section: 'Overview', items: [{ to: '/student/dashboard', label: 'Dashboard', icon: IconDashboard }] },
    {
      section: 'Academics',
      items: [
        { to: '/student/department', label: 'My Department', icon: IconBuilding },
        { to: '/student/attendance', label: 'My Attendance', icon: IconAttendance },
        { to: '/student/subjects', label: 'Subjects', icon: IconBook },
        { to: '/student/materials', label: 'Study Materials', icon: IconBooks },
        { to: '/student/assignments', label: 'Assignments', icon: IconClipboard },
        { to: '/student/marks', label: 'Marks', icon: IconMarks },
      ],
    },
    {
      section: 'Schedule',
      items: [
        { to: '/student/timetable', label: 'Timetable', icon: IconCalendar },
        { to: '/student/exams', label: 'Examinations', icon: IconExam },
        { to: '/student/announcements', label: 'Announcements', icon: IconMegaphone },
      ],
    },
    { section: 'Account', items: ACCOUNT_ITEMS('/student') },
  ],
  faculty: [
    { section: 'Overview', items: [{ to: '/faculty/dashboard', label: 'Dashboard', icon: IconDashboard }] },
    {
      section: 'Teaching',
      items: [
        { to: '/faculty/students', label: 'My Students', icon: IconUsers },
        { to: '/faculty/attendance', label: 'Mark Attendance', icon: IconAttendance },
        { to: '/faculty/attendance-history', label: 'Attendance History', icon: IconCalendar },
        { to: '/faculty/subjects', label: 'My Subjects', icon: IconBook },
        { to: '/faculty/materials', label: 'Study Materials', icon: IconBooks },
        { to: '/faculty/assignments', label: 'Assignments', icon: IconClipboard },
        { to: '/faculty/marks', label: 'Marks', icon: IconMarks },
      ],
    },
    {
      section: 'Schedule',
      items: [
        { to: '/faculty/timetable', label: 'Timetable', icon: IconCalendar },
        { to: '/faculty/exams', label: 'Examinations', icon: IconExam },
        { to: '/faculty/announcements', label: 'Announcements', icon: IconMegaphone },
      ],
    },
    { section: 'Reports', items: [{ to: '/faculty/reports', label: 'My Reports', icon: IconDownload }] },
    { section: 'Account', items: ACCOUNT_ITEMS('/faculty') },
  ],
  hod: [
    { section: 'Overview', items: [{ to: '/hod/dashboard', label: 'Dashboard', icon: IconDashboard }] },
    {
      section: 'Department',
      items: [
        { to: '/hod/control-center', label: 'Control Center', icon: IconSettings },
        { to: '/hod/allocations', label: 'Subject Allocation', icon: IconClipboard },
        { to: '/hod/students', label: 'Student Management', icon: IconUsers },
        { to: '/hod/faculty', label: 'Faculty Management', icon: IconUser },
        { to: '/hod/subjects', label: 'Subject Management', icon: IconBook },
        { to: '/hod/attendance', label: 'Attendance', icon: IconAttendance },
        { to: '/hod/departments', label: 'My Department', icon: IconBuilding },
      ],
    },
    {
      section: 'Academics',
      items: [
        { to: '/hod/materials', label: 'Study Materials', icon: IconBooks },
        { to: '/hod/assignments', label: 'Assignments', icon: IconClipboard },
        { to: '/hod/marks', label: 'Marks', icon: IconMarks },
        { to: '/hod/timetable', label: 'Timetable', icon: IconCalendar },
        { to: '/hod/exams', label: 'Examinations', icon: IconExam },
        { to: '/hod/announcements', label: 'Announcements', icon: IconMegaphone },
      ],
    },
    { section: 'Reports', items: [{ to: '/hod/reports', label: 'Department Reports', icon: IconDownload }] },
    { section: 'Account', items: ACCOUNT_ITEMS('/hod') },
  ],
  admin: [
    { section: 'Overview', items: [{ to: '/admin/dashboard', label: 'Dashboard', icon: IconDashboard }] },
    {
      section: 'Administration',
      items: [
        { to: '/admin/departments', label: 'Departments', icon: IconBuilding },
        { to: '/admin/users', label: 'User Management', icon: IconShield },
        { to: '/admin/allocations', label: 'Subject Allocation', icon: IconClipboard },
        { to: '/admin/students', label: 'Student Management', icon: IconUsers },
        { to: '/admin/faculty', label: 'Faculty Management', icon: IconUser },
        { to: '/admin/hods', label: 'HOD Management', icon: IconShield },
        { to: '/admin/subjects', label: 'Subject Management', icon: IconBook },
        { to: '/admin/attendance', label: 'Attendance', icon: IconAttendance },
        { to: '/admin/announcements', label: 'Announcements', icon: IconMegaphone },
      ],
    },
    {
      section: 'Academic Setup',
      items: [
        { to: '/admin/materials', label: 'Study Materials', icon: IconBooks },
        { to: '/admin/assignments', label: 'Assignments', icon: IconClipboard },
        { to: '/admin/marks', label: 'Marks', icon: IconMarks },
        { to: '/admin/timetable', label: 'Timetable', icon: IconCalendar },
        { to: '/admin/exams', label: 'Examinations', icon: IconExam },
      ],
    },
    { section: 'Reports', items: [{ to: '/admin/reports', label: 'Reports', icon: IconDownload }] },
    { section: 'Account', items: ACCOUNT_ITEMS('/admin') },
  ],
};

const TITLES = {
  '/student/dashboard': 'Student Dashboard',
  '/student/department': 'My Department',
  '/faculty/dashboard': 'Faculty Dashboard',
  '/hod/dashboard': 'HOD Dashboard',
  '/admin/dashboard': 'Admin Dashboard',
  '/hod/control-center': 'Department Control Center',
  '/hod/allocations': 'Subject Allocation',
  '/admin/allocations': 'Subject Allocation',
  '/hod/reports': 'Department Reports',
  '/admin/reports': 'Reports',
  '/faculty/reports': 'My Reports',
};

const initials = (name = '') => name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || 'U';

const Sidebar = ({ collapsed, mobileOpen, onNavigate }) => {
  const { role } = useAuth();
  const groups = NAV_BY_ROLE[role] || [];
  return (
    <>
      {mobileOpen ? <div className="sidebar-backdrop" onClick={onNavigate} aria-hidden="true" /> : null}
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`} aria-label="Main navigation">
        <div className="sidebar-brand">
          <div className="sidebar-logo" aria-hidden="true">HD</div>
          <div className="sidebar-brand-text">
            <strong>Hindusthan ERP</strong>
            <span>Department Portal</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          {groups.map((group) => (
            <div key={group.section}>
              <div className="nav-section-label">{collapsed ? group.section.slice(0, 3) : group.section}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                    onClick={onNavigate}
                    title={item.label}
                  >
                    <span className="nav-icon"><Icon size={18} /></span>
                    <span className="nav-label">{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <strong>One Department.</strong>
          One Platform. Smarter Management.
        </div>
      </aside>
    </>
  );
};

const NotificationBell = () => {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { role } = useAuth();

  const openNotification = (n) => {
    const target = notificationRoute(role, n);
    setOpen(false);
    if (target) navigate(target);
  };

  const load = () => {
    notificationsApi.list().then((res) => {
      setItems(res.data || []);
      setUnread(res.unreadCount || 0);
    }).catch(() => {});
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 90000);
    return () => clearInterval(timer);
  }, []);

  const markAll = async () => {
    try {
      await notificationsApi.markAllRead();
      load();
    } catch { /* surfaced by the page */ }
  };

  return (
    <div className="bell-wrap">
      <button
        type="button"
        className="icon-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications (${unread} unread)`}
        aria-expanded={open}
      >
        <IconBell size={19} />
        {unread > 0 ? <span className="count-badge">{unread > 99 ? '99+' : unread}</span> : null}
      </button>
      {open ? (
        <div style={{ position: 'absolute', right: 0, top: 42, width: 'min(360px, 88vw)', zIndex: 90 }}>
          <div className="card" style={{ boxShadow: 'var(--shadow-xl)' }}>
            <div className="card-header">
              <h3>Notifications</h3>
              <div className="card-header-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={markAll} disabled={unread === 0}>Mark all read</button>
              </div>
            </div>
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              {items.length === 0 ? (
                <EmptyState title="No notifications available." description="You have no notifications yet." />
              ) : (
                <div className="notif-list">
                  {items.slice(0, 12).map((n) => (
                    <button
                      key={n.notificationId}
                      type="button"
                      className={`notif-item ${n.isRead ? '' : 'unread'}`}
                      style={{ width: '100%', textAlign: 'left', border: 0, background: 'none', cursor: notificationRoute(role, n) ? 'pointer' : 'default' }}
                      onClick={() => openNotification(n)}
                    >
                      <span className={`notif-bullet ${n.isRead ? 'read' : ''}`} aria-hidden="true" />
                      <div style={{ minWidth: 0 }}>
                        <div className="notif-title">{n.title}</div>
                        <div className="notif-message">{n.message}</div>
                        <div className="notif-time">{new Date(n.createdAt).toLocaleString()}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="card-header" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn btn-secondary btn-sm btn-block" onClick={() => { setOpen(false); navigate('/notifications'); }}>
                View all notifications
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export const AppLayout = () => {
  const { user, role, logout, departmentName } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const pageTitle = useMemo(() => {
    if (TITLES[location.pathname]) return TITLES[location.pathname];
    const segment = location.pathname.split('/').filter(Boolean);
    const last = segment[segment.length - 1] || '';
    return last.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }, [location.pathname]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Sidebar collapsed={collapsed} mobileOpen={mobileOpen} onNavigate={() => setMobileOpen(false)} />
      <div className="main-area">
        <header className="topbar">
          <button
            type="button"
            className="topbar-toggle"
            onClick={() => { setCollapsed((c) => !c); setMobileOpen((m) => !m); }}
            aria-label="Toggle navigation menu"
          >
            <IconMenu size={19} />
          </button>
          <span className="topbar-title">{pageTitle}</span>
          <div className="topbar-actions">
            <NotificationBell />
            <div className="user-chip">
              <span className={`avatar sm ${role}`} aria-hidden="true">{initials(user?.name)}</span>
              <span className="user-chip-text">
                <strong>{user?.name || 'Account'}</strong>
                <span>{role}{departmentName ? ` · ${departmentName}` : ''}</span>
              </span>
            </div>
            <button type="button" className="icon-btn" onClick={handleLogout} aria-label="Log out" title="Log out">
              <IconLogout size={19} />
            </button>
          </div>
        </header>
        <main className="content" id="main-content">
          <div className="content-inner">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export { NAV_BY_ROLE, initials };