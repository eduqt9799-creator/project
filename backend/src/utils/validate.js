const env = require('../config/env');
const { byName, byRegisterNumber } = require('./naturalSort');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const REGISTER_RE = /^[A-Za-z0-9][A-Za-z0-9/-]{1,19}$/;
const SUBJECT_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9/&-]{1,19}$/;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isEmail = (v) => typeof v === 'string' && EMAIL_RE.test(v.trim());
const isRegisterNumber = (v) => typeof v === 'string' && REGISTER_RE.test(v.trim());
const isSubjectCode = (v) => typeof v === 'string' && SUBJECT_CODE_RE.test(v.trim());
const isDate = (v) => {
  if (typeof v !== 'string' || !DATE_RE.test(v.trim())) return false;
  const d = new Date(`${v.trim()}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
};
const isSemester = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 10;
};
const isNumberInRange = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max;
};
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

/** Collects field errors for one field spec map. */
const validate = (payload, spec) => {
  const errors = {};
  const data = {};
  Object.entries(spec).forEach(([field, rule]) => {
    const raw = payload ? payload[field] : undefined;
    const value = typeof raw === 'string' ? raw.trim() : raw;
    if (rule.required && (value === undefined || value === null || value === '')) {
      errors[field] = `${rule.label} is required`;
      return;
    }
    if (value === undefined || value === null || value === '') {
      data[field] = undefined;
      return;
    }
    if (rule.check) {
      const result = rule.check(value);
      if (result !== true) {
        errors[field] = result;
        return;
      }
    }
    data[field] = rule.transform ? rule.transform(value) : value;
  });
  return { errors, data };
};

const SPECS = {
  login: {
    email: { label: 'Email', required: true, check: (v) => (isEmail(v) ? true : 'Enter a valid email address') },
    password: { label: 'Password', required: true, check: (v) => (v.length >= 6 ? true : 'Password must be at least 6 characters') },
  },
  department: {
    departmentId: { label: 'Department ID', required: true, check: isNonEmptyString },
    departmentCode: {
      label: 'Department code',
      required: true,
      check: (v) => (/^[A-Za-z0-9-]{2,10}$/.test(v) ? true : 'Use 2-10 letters, digits or hyphens'),
      transform: (v) => String(v).toUpperCase(),
    },
    departmentName: { label: 'Department name', required: true, check: (v) => (v.length >= 3 ? true : 'Enter the full department name') },
  },
  student: {
    name: { label: 'Student name', required: true, check: (v) => (v.length >= 2 ? true : 'Enter the student name') },
    registerNumber: { label: 'Register number', required: true, check: isRegisterNumber, transform: (v) => String(v).toUpperCase() },
    email: { label: 'Email', required: true, check: isEmail, transform: (v) => String(v).toLowerCase() },
    password: { label: 'Password', required: true, check: (v) => (v.length >= 8 ? true : 'Password must be at least 8 characters') },
    phone: { label: 'Phone', check: (v) => (/^[0-9+\-\s]{6,15}$/.test(v) ? true : 'Enter a valid phone number') },
    semester: { label: 'Semester', required: true, check: (v) => (isSemester(v) ? true : 'Semester must be between 1 and 10'), transform: (v) => Number(v) },
    departmentId: { label: 'Department', check: isNonEmptyString },
    batch: { label: 'Batch', check: (v) => (/^[A-Za-z0-9-]{1,15}$/.test(v) ? true : 'Batch must be 1-15 letters, digits or hyphens') },
    status: { label: 'Status', check: (v) => (['active', 'inactive'].includes(v.toLowerCase()) ? true : 'Status must be active or inactive'), transform: (v) => String(v).toLowerCase() },
  },
  faculty: {
    name: { label: 'Faculty name', required: true, check: (v) => (v.length >= 2 ? true : 'Enter the faculty name') },
    employeeId: { label: 'Employee ID', required: true, check: isRegisterNumber, transform: (v) => String(v).toUpperCase() },
    email: { label: 'Email', required: true, check: isEmail, transform: (v) => String(v).toLowerCase() },
    password: { label: 'Password', required: true, check: (v) => (v.length >= 8 ? true : 'Password must be at least 8 characters') },
    phone: { label: 'Phone', check: (v) => (/^[0-9+\-\s]{6,15}$/.test(v) ? true : 'Enter a valid phone number') },
    designation: { label: 'Designation', check: isNonEmptyString },
    departmentId: { label: 'Department', check: isNonEmptyString },
    status: { label: 'Status', check: (v) => (['active', 'inactive'].includes(v.toLowerCase()) ? true : 'Status must be active or inactive'), transform: (v) => String(v).toLowerCase() },
  },
  hod: {
    name: { label: 'HOD name', required: true, check: (v) => (v.length >= 2 ? true : 'Enter the HOD name') },
    employeeId: { label: 'Employee ID', required: true, check: isRegisterNumber, transform: (v) => String(v).toUpperCase() },
    email: { label: 'Email', required: true, check: isEmail, transform: (v) => String(v).toLowerCase() },
    password: { label: 'Password', required: true, check: (v) => (v.length >= 8 ? true : 'Password must be at least 8 characters') },
    phone: { label: 'Phone', check: (v) => (/^[0-9+\-\s]{6,15}$/.test(v) ? true : 'Enter a valid phone number') },
    designation: { label: 'Designation', check: isNonEmptyString },
    // The single-department deployment derives departmentId server-side, so it
    // is accepted but never required from the client.
    departmentId: { label: 'Department', check: isNonEmptyString },
    status: { label: 'Status', check: (v) => (['active', 'inactive'].includes(v.toLowerCase()) ? true : 'Status must be active or inactive'), transform: (v) => String(v).toLowerCase() },
  },
  subject: {
    subjectCode: { label: 'Subject code', required: true, check: isSubjectCode, transform: (v) => String(v).toUpperCase() },
    subjectName: { label: 'Subject name', required: true, check: (v) => (v.length >= 2 ? true : 'Enter the subject name') },
    semester: { label: 'Semester', required: true, check: (v) => (isSemester(v) ? true : 'Semester must be between 1 and 10'), transform: (v) => Number(v) },
    credits: { label: 'Credits', required: true, check: (v) => (isNumberInRange(v, 0, 20) ? true : 'Credits must be between 0 and 20'), transform: (v) => Number(v) },
    departmentId: { label: 'Department', check: isNonEmptyString },
    status: { label: 'Status', check: (v) => (['active', 'inactive'].includes(v.toLowerCase()) ? true : 'Status must be active or inactive'), transform: (v) => String(v).toLowerCase() },
  },
  subjectAllocation: {
    facultyId: { label: 'Faculty member', required: true, check: isNonEmptyString },
    subjectCode: { label: 'Subject code', required: true, check: isSubjectCode, transform: (v) => String(v).toUpperCase() },
    semester: { label: 'Semester', required: true, check: (v) => (isSemester(v) ? true : 'Semester must be between 1 and 10'), transform: (v) => Number(v) },
    departmentId: { label: 'Department', check: isNonEmptyString },
    assignedDate: { label: 'Assigned date', check: (v) => (isDate(v) ? true : 'Use a valid date (YYYY-MM-DD)') },
    notes: { label: 'Notes', check: isNonEmptyString },
    status: { label: 'Status', check: (v) => (['active', 'inactive'].includes(v.toLowerCase()) ? true : 'Status must be active or inactive'), transform: (v) => String(v).toLowerCase() },
  },
  attendance: {
    date: { label: 'Date', required: true, check: (v) => (isDate(v) ? true : 'Use a valid date (YYYY-MM-DD)') },
    semester: { label: 'Semester', required: true, check: (v) => (isSemester(v) ? true : 'Semester must be between 1 and 10'), transform: (v) => Number(v) },
    subjectCode: { label: 'Subject code', required: true, check: isSubjectCode, transform: (v) => String(v).toUpperCase() },
  },
  material: {
    title: { label: 'Material title', required: true, check: (v) => (v.length >= 2 ? true : 'Enter a title') },
    description: { label: 'Description', check: isNonEmptyString },
    subjectCode: { label: 'Subject code', required: true, check: isSubjectCode, transform: (v) => String(v).toUpperCase() },
    subjectName: { label: 'Subject name', check: isNonEmptyString },
    semester: { label: 'Semester', check: (v) => (isSemester(v) ? true : 'Semester must be between 1 and 10'), transform: (v) => Number(v) },
    facultyId: { label: 'Faculty member', check: isNonEmptyString },
    facultyName: { label: 'Faculty name', check: isNonEmptyString },
    visibility: {
      label: 'Visibility',
      check: (v) => (['all', 'faculty', 'hod', 'students'].includes(String(v).toLowerCase()) ? true : 'Visibility must be all, faculty, hod or students'),
      transform: (v) => String(v).toLowerCase(),
    },
    fileUrl: { label: 'File URL', check: (v) => (/^https?:\/\/\S+$/i.test(v) ? true : 'Enter a valid file URL') },
    fileName: { label: 'File name', check: isNonEmptyString },
  },
  assignment: {
    title: { label: 'Assignment title', required: true, check: (v) => (v.length >= 2 ? true : 'Enter a title') },
    description: { label: 'Description', check: isNonEmptyString },
    subjectCode: { label: 'Subject code', required: true, check: isSubjectCode, transform: (v) => String(v).toUpperCase() },
    subjectName: { label: 'Subject name', check: isNonEmptyString },
    semester: { label: 'Semester', required: true, check: (v) => (isSemester(v) ? true : 'Semester must be between 1 and 10'), transform: (v) => Number(v) },
    assignedDate: { label: 'Assigned date', required: true, check: (v) => (isDate(v) ? true : 'Use a valid date (YYYY-MM-DD)') },
    dueDate: { label: 'Due date', required: true, check: (v) => (isDate(v) ? true : 'Use a valid date (YYYY-MM-DD)') },
  },
  marks: {
    registerNumber: { label: 'Register number', required: true, check: isRegisterNumber, transform: (v) => String(v).toUpperCase() },
    subjectCode: { label: 'Subject code', required: true, check: isSubjectCode, transform: (v) => String(v).toUpperCase() },
    internalMark: { label: 'Internal mark', required: true, check: (v) => (isNumberInRange(v, 0, 100) ? true : 'Mark must be between 0 and 100'), transform: (v) => Number(v) },
    examMark: { label: 'Exam mark', check: (v) => (isNumberInRange(v, 0, 100) ? true : 'Mark must be between 0 and 100'), transform: (v) => Number(v) },
    assignmentMark: { label: 'Assignment mark', check: (v) => (isNumberInRange(v, 0, 100) ? true : 'Mark must be between 0 and 100'), transform: (v) => Number(v) },
  },
  timetable: {
    day: { label: 'Day', required: true, check: (v) => (['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].includes(v) ? true : 'Enter a valid day') },
    startTime: { label: 'Start time', required: true, check: (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? true : 'Use 24-hour HH:MM') },
    endTime: { label: 'End time', required: true, check: (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? true : 'Use 24-hour HH:MM') },
    subjectCode: { label: 'Subject code', required: true, check: isSubjectCode, transform: (v) => String(v).toUpperCase() },
    subjectName: { label: 'Subject name', check: isNonEmptyString },
    room: { label: 'Room', check: isNonEmptyString },
    semester: { label: 'Semester', check: (v) => (isSemester(v) ? true : 'Semester must be between 1 and 10'), transform: (v) => Number(v) },
  },
  exam: {
    examName: { label: 'Exam name', required: true, check: (v) => (v.length >= 2 ? true : 'Enter the exam name') },
    examType: {
      label: 'Exam type',
      required: true,
      check: (v) => (['internal', 'assignment', 'model', 'semester', 'practical'].includes(String(v).toLowerCase()) ? true : 'Enter a valid exam type'),
      transform: (v) => String(v).toLowerCase(),
    },
    subjectCode: { label: 'Subject code', required: true, check: isSubjectCode, transform: (v) => String(v).toUpperCase() },
    subjectName: { label: 'Subject name', check: isNonEmptyString },
    semester: { label: 'Semester', required: true, check: (v) => (isSemester(v) ? true : 'Semester must be between 1 and 10'), transform: (v) => Number(v) },
    date: { label: 'Date', required: true, check: (v) => (isDate(v) ? true : 'Use a valid date (YYYY-MM-DD)') },
    startTime: { label: 'Start time', required: true, check: (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? true : 'Use 24-hour HH:MM') },
    endTime: { label: 'End time', required: true, check: (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? true : 'Use 24-hour HH:MM') },
    room: { label: 'Room', check: isNonEmptyString },
  },
  announcement: {
    title: { label: 'Title', required: true, check: (v) => (v.length >= 3 ? true : 'Enter a title (min 3 characters)') },
    description: { label: 'Description', required: true, check: (v) => (v.length >= 3 ? true : 'Enter a description (min 3 characters)') },
    category: { label: 'Category', required: true, check: isNonEmptyString },
    priority: {
      label: 'Priority',
      required: true,
      check: (v) => (['low', 'medium', 'high'].includes(String(v).toLowerCase()) ? true : 'Priority must be low, medium or high'),
      transform: (v) => String(v).toLowerCase(),
    },
    targetRole: {
      label: 'Target role',
      required: true,
      check: (v) => (['all', 'student', 'faculty', 'hod'].includes(String(v).toLowerCase()) ? true : 'Target role must be all, student, faculty or hod'),
      transform: (v) => String(v).toLowerCase(),
    },
    publishDate: { label: 'Publish date', required: true, check: (v) => (isDate(v) ? true : 'Use a valid date (YYYY-MM-DD)') },
  },
  notification: {
    title: { label: 'Title', required: true, check: (v) => (v.length >= 2 ? true : 'Enter a title') },
    message: { label: 'Message', required: true, check: (v) => (v.length >= 2 ? true : 'Enter a message') },
    type: {
      label: 'Type',
      check: (v) => (['info', 'warning', 'success', 'alert'].includes(String(v).toLowerCase()) ? true : 'Type must be info, warning, success or alert'),
      transform: (v) => String(v).toLowerCase(),
    },
  },
  adminUser: {
    name: { label: 'Name', required: true, check: (v) => (v.length >= 2 ? true : 'Enter the name') },
    email: { label: 'Email', required: true, check: isEmail, transform: (v) => String(v).toLowerCase() },
    password: { label: 'Password', required: true, check: (v) => (v.length >= 8 ? true : 'Password must be at least 8 characters') },
    role: {
      label: 'Role',
      required: true,
      check: (v) => (['student', 'faculty', 'hod', 'admin'].includes(String(v).toLowerCase()) ? true : 'Role must be student, faculty, hod or admin'),
      transform: (v) => String(v).toLowerCase(),
    },
    departmentId: { label: 'Department', check: isNonEmptyString },
    status: { label: 'Status', check: (v) => (['active', 'inactive'].includes(String(v).toLowerCase()) ? true : 'Status must be active or inactive'), transform: (v) => String(v).toLowerCase() },
  },
};

/** Blocks writes once attendance submission time (5:00 PM IST) has passed. */
const currentIstParts = () => {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: env.attendanceTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = {};
  formatter.formatToParts(new Date()).forEach(({ type, value }) => {
    parts[type] = value;
  });
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour === '24' ? '00' : parts.hour),
    minute: Number(parts.minute),
  };
};

const isPastCutoff = (now = currentIstParts()) =>
  now.hour > env.attendanceCutoffHour || (now.hour === env.attendanceCutoffHour && now.minute > 0);

const cutoffMessage = 'Attendance submission is closed after 5:00 PM IST.';

/** Updates must not force a password: blank means "keep the current password". */
const withoutPassword = (spec) => {
  const copy = { ...spec };
  delete copy.password;
  return copy;
};

module.exports = {
  validate, SPECS, withoutPassword, currentIstParts, isPastCutoff, cutoffMessage,
  isEmail, isRegisterNumber, isSubjectCode, isDate, isSemester, byName, byRegisterNumber,
};