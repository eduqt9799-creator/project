import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { IconEyeOff } from '../components/Icons';

export default function AccessDenied() {
  const { homePath, isAuthenticated } = useAuth();
  return (
    <div className="centered-page">
      <div className="centered-card card" style={{ padding: 40 }}>
        <div className="centered-icon"><IconEyeOff size={34} /></div>
        <h1 style={{ fontSize: '1.5rem', marginBottom: 8 }}>Access Denied</h1>
        <p className="muted" style={{ marginBottom: 22 }}>
          You do not have permission to access this page.
        </p>
        <Link to={isAuthenticated ? homePath : '/login'} className="btn btn-primary">
          {isAuthenticated ? 'Back to Dashboard' : 'Go to sign in'}
        </Link>
      </div>
    </div>
  );
}