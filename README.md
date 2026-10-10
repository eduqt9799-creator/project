# Hindusthan Department ERP

Role-scoped ERP for a department: **Student**, **Faculty**, **HOD** and **Admin**.
Google Sheets is the only data store; the Node backend is the only writer.

```
frontend/   React 19 + Vite (JavaScript/JSX, plain CSS)
backend/    Express (CommonJS) - auth, RBAC, validation, audit, Apps Script client
apps-script/Code.gs   Google Apps Script web app (Sheets bridge)
```

## Data flow

```
Browser --JWT--> Express API --HTTPS--> Apps Script /exec --> Google Sheets
                  ^                       |
                  +-- audit log + notifications written back ----+
```

The frontend never talks to Apps Script or Sheets directly. Every request is
re-authorised against the live `Users` sheet, so role, department and account
status changes take effect immediately instead of waiting for a token to expire.

## Quick start

```powershell
npm run install:all     # installs backend and frontend dependencies
```

```powershell
# 1. Backend
cd backend
Copy-Item .env.example .env        # then fill in JWT_SECRET
npm run dev                        # http://localhost:5000

# 2. Frontend (separate terminal)
cd ..\frontend
Copy-Item .env.example .env.local  # VITE_API_BASE_URL
npm run dev                        # http://localhost:5173
```

See `DEPLOYMENT.md` for the Google Sheets / Apps Script setup, the mandatory
bridge API key, and how to bootstrap the first administrator.

## Verification

From the project root:

```powershell
npm run verify         # check + test + lint + build
```

Or individually:

| Command | What it does |
| --- | --- |
| `npm run check` | Parses all 31 backend source files |
| `npm test` | Asserts password hashing, assignment status, sorting, boolean parsing, validation specs, allocation validation/normalisation, CSV escaping, material visibility, subject ordering |
| `npm run lint` | Frontend lint (0 errors; Fast-Refresh/style warnings only) |
| `npm run build` | `tsc -b` + Vite production build |

## Roles and scope

| Area | Student | Faculty | HOD | Admin |
| --- | --- | --- | --- | --- |
| Dashboard | own record | own classes | department | all departments |
| Control Center | – | – | own department | any department |
| Reports | – | own department | own department | any department |
| Attendance | own %, marked read-only | allocated subject, closed 17:00 IST | reopen/correct with reason | reopen/correct with reason |
| Students | own profile only | own allocated subjects, read-only | own department, manage | all departments |
| My teachers | own semester | – | – | – |
| Faculty / HOD | – | – | manage own department | manage all |
| Subjects | own semester | own semester | manage own department | manage all |
| Subject allocation | – | own subjects (read) | manage own department | manage all |
| Materials / Assignments | own semester | allocated subjects | manage own department | manage all |
| Marks | own marks | allocated subjects | own department | all |
| Timetable / Exams | own semester | read | manage own department | manage all |
| Announcements | read | manage | manage | manage |
| Notifications | own only | own only | own only | own only |
| Users | – | – | – | manage |

Students never see another semester's rows; the factory resolves the student's
profile once per request and filters on `semester`.

## Subject allocation

`SubjectAllocations` assigns each department subject to exactly one faculty
member per semester, and is the key to every faculty-scoped screen: material,
attendance, assignments, marks and "My Students" all follow it. A faculty
member can therefore only touch what they actually teach, and a subject with no
allocation stays out of faculty view until the HOD allocates it.

- HOD allocates within their own department; admin in any department.
- The same allocation twice is rejected; assigning a different teacher
  deactivates the previous holder instead of creating a second teacher for the
  subject.
- The HOD Control Center lists unallocated subjects, the teaching load per
  faculty member, and students below 75% attendance.

## Documentation

- `DEPLOYMENT.md` - Apps Script deployment, Script Properties, first admin, env vars, host options.
- `SCHEMA.md` - every sheet, its columns, key columns and uniqueness rules.
- `API.md` - all endpoints, request/response shape and error codes.
- `PERMISSIONS.md` - the full role/endpoint matrix and audit behaviour.

## Security notes

- Passwords are bcrypt hashes (`$2a$`) written only by the backend.
  The one exception is the first admin created from the Apps Script editor,
  which uses an iterated HMAC-SHA256 hash because Apps Script cannot run
  bcrypt; the backend verifies both and rewrites it as bcrypt on first password
  change.
- `passwordHash` is never included in any API response.
- The Apps Script bridge fails closed: it rejects every request unless the
  `API_KEY` Script Property is set and the caller presents the same key.
- Role/department/status are always taken from the authenticated session, never
  from the request body.
- Subject-level ownership follows `SubjectAllocations` and is re-checked on every
  faculty write, so revoking an allocation takes effect immediately.
- The Apps Script bridge re-checks the department for every department-scoped
  write using the actor the backend sends, so a backend bug still cannot put one
  department's data into another's rows.
- Destructive actions (delete, reopen, correct, deactivate) write an `AuditLog`
  row with the performer, role, timestamp and reason.