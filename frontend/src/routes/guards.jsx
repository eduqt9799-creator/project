import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LoadingState } from '../components/ui';
import AccessDenied from '../pages/AccessDenied';

const FullPageLoader = ({ label }) => (
  <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--ink-50)' }}>
    <LoadingState label={label} />
  </div>
);

/** Requires an authenticated session. */
export const ProtectedRoute = () => {
  const { isAuthenticated, initialising } = useAuth();
  const location = useLocation();

  if (initialising) return <FullPageLoader label="Restoring your session..." />;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <Outlet />;
};

/** Requires one of the listed roles; otherwise renders the Access Denied page. */
export const RoleRoute = ({ roles }) => {
  const { role } = useAuth();
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!role || !allowed.includes(role)) return <AccessDenied />;
  return <Outlet />;
};

/** Sends an authenticated user away from /login. */
export const PublicOnlyRoute = () => {
  const { isAuthenticated, initialising, homePath } = useAuth();
  if (initialising) return <FullPageLoader label="Loading..." />;
  if (isAuthenticated) return <Navigate to={homePath} replace />;
  return <Outlet />;
};

export { FullPageLoader };