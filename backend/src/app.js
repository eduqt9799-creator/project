const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const env = require('./config/env');
const { authenticateUser } = require('./middleware/auth');
const { errorHandler, notFoundHandler } = require('./middleware/error');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const studentRoutes = require('./routes/students');
const facultyRoutes = require('./routes/faculty');
const hodRoutes = require('./routes/hods');
const departmentRoutes = require('./routes/departments');
const subjectRoutes = require('./routes/subjects');
const subjectAllocationRoutes = require('./routes/subjectAllocations');
const reportRoutes = require('./routes/reports');
const attendanceRoutes = require('./routes/attendance');
const materialRoutes = require('./routes/materials');
const assignmentRoutes = require('./routes/assignments');
const marksRoutes = require('./routes/marks');
const timetableRoutes = require('./routes/timetable');
const examRoutes = require('./routes/exams');
const announcementRoutes = require('./routes/announcements');
const notificationRoutes = require('./routes/notifications');
const userRoutes = require('./routes/users');

const app = express();

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin: env.clientUrl.split(',').map((o) => o.trim()),
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
if (!env.isProduction) app.use(morgan('dev'));

app.get('/api/health', (req, res) => res.json({ success: true, message: 'Hindusthan Department ERP API is running', data: { env: env.nodeEnv, time: new Date().toISOString() } }));

// Public: login only.
app.use('/api/auth', authRoutes);

// Everything else requires a valid session.
app.use('/api', authenticateUser);

app.use('/api/dashboard', dashboardRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/faculty', facultyRoutes);
app.use('/api/hods', hodRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/subjects', subjectRoutes);
// Mounted before /api/subjects is irrelevant (different paths), but kept adjacent
// because allocations are what make a subject teachable.
app.use('/api/subject-allocations', subjectAllocationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/marks', marksRoutes);
app.use('/api/timetable', timetableRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/users', userRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;