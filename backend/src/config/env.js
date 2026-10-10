require('dotenv').config();

const required = (key, fallback) => {
  const value = process.env[key] || fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 5000),
  clientUrl: required('CLIENT_URL', 'http://localhost:5173'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  appsScriptUrl: required('APPS_SCRIPT_URL'),
  appsScriptApiKey: process.env.APPS_SCRIPT_API_KEY || '',
  attendanceCutoffHour: Number(process.env.ATTENDANCE_CUTOFF_HOUR || 17),
  attendanceTimezone: process.env.ATTENDANCE_TIMEZONE || 'Asia/Kolkata',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 10),
};

if (env.jwtSecret.length < 24) {
  throw new Error('JWT_SECRET must be at least 24 characters long');
}

env.isProduction = env.nodeEnv === 'production';

module.exports = env;