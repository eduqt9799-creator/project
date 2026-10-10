import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Alert, PasswordInput, TextInput } from '../components/ui';
import { IconCheck, IconShield } from '../components/Icons';

const POINTS = [
  'Role-based access for Student, Faculty, HOD and Admin',
  'Department-scoped records — no cross-department leakage',
  'Google Sheets backed: every record is stored, not simulated',
  'Attendance with register-number ordering and a 5:00 PM IST cutoff',
];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = 'Sign in · Hindusthan Department ERP';
  }, []);

  const validate = () => {
    const next = {};
    if (!email.trim()) next.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) next.email = 'Enter a valid email address';
    if (!password) next.password = 'Password is required';
    else if (password.length < 6) next.password = 'Password must be at least 6 characters';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setFormError('');
    if (!validate()) return;
    setSubmitting(true);
    try {
      const loggedIn = await login(email.trim(), password);
      const home = {
        student: '/student/dashboard',
        faculty: '/faculty/dashboard',
        hod: '/hod/dashboard',
        admin: '/admin/dashboard',
      }[loggedIn.role] || '/login';
      window.location.assign(home);
    } catch (error) {
      setFormError(error.message || 'Unable to sign in. Please try again.');
      setErrors(error.fieldErrors || {});
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <section className="auth-visual" aria-label="About Hindusthan Department ERP">
        <div className="auth-brand">
          <div className="sidebar-logo" aria-hidden="true">HD</div>
          <div>
            <strong style={{ display: 'block' }}>Hindusthan Department ERP</strong>
            <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>One Department. One Platform. Smarter Management.</span>
          </div>
        </div>
        <div className="auth-visual-body">
          <h1>Academic department management, connected end to end.</h1>
          <p>
            Students, faculty, HOD and administration share a single platform for attendance,
            subjects, materials, assignments, marks, timetables, examinations and announcements.
          </p>
          <ul className="auth-points">
            {POINTS.map((point) => (
              <li key={point}><IconCheck size={18} /><span>{point}</span></li>
            ))}
          </ul>
        </div>
        <div className="auth-visual-foot">
          Access is granted by your department administrator. Contact your HOD or admin office if you need an account.
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <h2>Sign in</h2>
          <p className="auth-sub">Use your registered email address and password.</p>

          {formError ? <div className="mb-2"><Alert tone="error" title="Sign in failed">{formError}</Alert></div> : null}

          <form onSubmit={onSubmit} noValidate>
            <TextInput
              label="Email"
              type="email"
              required
              autoComplete="username"
              placeholder="you@college.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={errors.email}
            />
            <PasswordInput
              label="Password"
              required
              autoComplete="current-password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.password}
            />
            <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
              {submitting ? <span className="spinner" /> : <IconShield size={17} />}
              {submitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <div className="auth-note">
            <strong>No self sign-up</strong>
            Accounts are created by your department administrator through the ERP. Passwords are stored securely and never displayed.
          </div>
        </div>
      </section>
    </div>
  );
}