import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function NotFound() {
  const { isAuthenticated, homePath } = useAuth();
  return (
    <div className="centered-page">
      <div className="centered-card card" style={{ padding: 40 }}>
        <div className="centered-code" aria-hidden="true">404</div>
        <h1 style={{ fontSize: '1.35rem', margin: '10px 0 8px' }}>Page not found.</h1>
        <p className="muted" style={{ marginBottom: 22 }}>
          The page you requested does not exist or has been moved.
        </p>
        <Link to={isAuthenticated ? homePath : '/login'} className="btn btn-primary">Back to Dashboard</Link>
      </div>
    </div>
  );
}