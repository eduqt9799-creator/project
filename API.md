# API reference

Base URL: `https://<your-backend>/api`
All requests send `Content-Type: application/json`.
Every route except `POST /auth/login` requires `Authorization: Bearer <JWT>`.
Responses are CORS-restricted to `CLIENT_URL`.

## Envelope

Success:

```json
{ "success": true, "message": "Operation successful", "data": { }, "pagination": { } }
```

Failure:

```json
{ "success": false, "message": "Please correct the highlighted fields.",
  "fieldErrors": { "email": "Enter a valid email address" } }
```

| Status | Meaning |
| --- | --- |
| 200 / 201 | OK / created |
| 400 | Validation failure (`fieldErrors` present) |
| 401 | Missing / invalid / expired token, or wrong credentials |
| 403 | Authenticated but not permitted (role, department, cutoff, reference) |
| 404 | Record not found |
| 409 | Duplicate on a unique key |
| 429 | Rate limited (login: 20 per 10 minutes) |
| 500 | Bridge or server error |

## Pagination and filtering

List endpoints accept:

| Query | Notes |
| --- | --- |
| `page` | 1-based, default 1 |
| `limit` | default 25, max 200 |
| `search` | Case-insensitive across the resource's search fields |
| `sortBy`, `sortDir` | `sortDir` is `asc` (default) or `desc`; values sort naturally (`STU-2` before `STU-10`) |
| `status`, `departmentId`, `semester`, ... | Resource-specific filters |

Responses add `pagination: { page, limit, total, totalPages }`.

Students only ever receive rows for their own semester and department. Admins
may filter by `departmentId` across every department; HOD and faculty are
pinned to their own department regardless of the query.

---

## Auth

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/login` | public | Sign in |
| GET | `/auth/me` | any | Current session profile |
| PUT | `/auth/me` | any | Update own name / email / phone |
| PUT | `/auth/password` | any | Change own password |

### POST /auth/login

```json
{ "email": "you@college.edu", "password": "a-strong-password" }
```

Returns `{ token, expiresIn, user: { userId, name, email, role, departmentId, departmentName, status, profile } }`.
Rate limited to 20 attempts per 10 minutes per IP. Inactive accounts and
unknown roles are rejected. A `login_failed` audit row is written on failure.

### PUT /auth/me

```json
{ "name": "New Name", "email": "new@college.edu", "phone": "9876543210" }
```

`role`, `departmentId`, `status`, `passwordHash` and `userId` are rejected with
400. The linked student/faculty/HOD profile is updated in the same call so the
login and profile never drift apart.

### PUT /auth/password

```json
{ "currentPassword": "old-password", "newPassword": "new-password" }
```

Re-hashes with bcrypt and rewrites the stored hash.

---

## Users (admin only)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/users` | List logins (filters: `role`, `status`, `departmentId`) |
| POST | `/users` | Create a login directly |
| PUT | `/users/:id` | Update a login |
| DELETE | `/users/:id` | Remove / deactivate |
| GET | `/users/search/global?q=` | Cross-department people search |

`passwordHash` is never present in any response.

## Notifications

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| GET | `/notifications` | any | Own notifications (`isRead`, `type`) + `unreadCount` |
| GET | `/notifications/recipients` | admin, hod | Recipient picker (HOD scoped to own department) |
| POST | `/notifications` | admin, hod | Send to one user |
| PUT | `/notifications/:id/read` | any | Mark own notification read |
| PUT | `/notifications/read-all` | any | Mark all own notifications read |

```json
POST /notifications
{ "userId": "USR-6F2K9QX4", "title": "Semester starts Monday", "message": "...", "type": "info" }
```

An HOD targeting another department receives 403.

## Dashboard

`GET /dashboard` - per-role aggregates: student (attendance %, marks, pending
assignments), faculty (today's classes, unmarked attendance, recent
submissions), HOD (department totals, low attendance, faculty counts), admin
(global totals, per-department breakdown, recent audit).

### HOD Control Center

`GET /dashboard/control-center` - **HOD and admin only**; any other role gets
403. An HOD is always pinned to their own department; an admin may pass
`?departmentId=`.

Answers the three questions an HOD actually has:

| Block | Contents |
| --- | --- |
| `totals` | subjects, allocated/unallocated subjects, allocation coverage %, faculty, students, at-risk students |
| `subjects` / `unallocated` | Every subject with its allocated teacher, or flagged as unallocated |
| `workload` | Per faculty member: subjects, credits, semesters, student count |
| `atRiskStudents` | Students below 75% attendance, lowest first |
| `recentAllocations` | Last 8 allocation changes |

Optional `?semester=` filters the whole response.

## Reports

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| GET | `/reports/catalogue` | faculty,hod,admin | Reports the caller may run, with role + field notes |
| GET | `/reports/:report` | faculty,hod,admin | Preview rows (paged) |
| GET | `/reports/:report/download` | faculty,hod,admin | Same rows as a CSV attachment |

Supported reports: `students`, `faculty`, `subjects`, `subject-allocations`,
`attendance`, `assignments`, `marks`, `materials`, `announcements`, `exams`.

Every download is **server-scoped**, never a client-side filter: a faculty
member only ever exports their own department (and, for teaching reports, their
allocated subjects), an HOD only their own department, an admin any department
via `?departmentId=`. CSVs start with a UTF-8 BOM and quote commas, quotes and
newlines so Excel opens them correctly. Each download is written to the audit
log with the row count.

---

## CRUD resources

| Resource | Base path | id | Roles (read / create / update / delete) |
| --- | --- | --- | --- |
| Students | `/students` | `studentId` | student(own) / admin,hod / admin,hod / admin |
| Faculty | `/faculty` | `facultyId` | admin,hod / admin,hod / admin,hod / admin |
| HODs | `/hods` | `hodId` | admin / admin / admin / admin |
| Departments | `/departments` | `departmentId` | any / admin / admin / admin |
| Subjects | `/subjects` | `subjectId` | admin,hod,faculty / admin,hod / admin,hod / admin |
| Subject allocations | `/subject-allocations` | `allocationId` | admin,hod / admin,hod / admin,hod / admin |
| Materials | `/materials` | `materialId` | admin,hod,faculty,student / admin,hod,faculty / admin,hod,faculty / admin,hod,faculty |
| Assignments | `/assignments` | `assignmentId` | admin,hod,faculty,student / admin,hod,faculty / admin,hod,faculty / admin,hod,faculty |
| Marks | `/marks` | `marksId` | admin,hod,faculty / admin,hod / admin,hod / admin,hod |
| Timetable | `/timetable` | `timetableId` | admin,hod,faculty,student / admin,hod / admin,hod / admin,hod |
| Exams | `/exams` | `examId` | admin,hod,faculty,student / admin,hod / admin,hod / admin,hod |
| Announcements | `/announcements` | `announcementId` | any / admin,hod,faculty / admin,hod,faculty / admin,hod,faculty |

Each supports:

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/<resource>` | Filtered, sorted, paginated list |
| POST | `/<resource>` | 201 with the created record |
| PUT | `/<resource>/:id` | Partial update; unspecified fields are untouched |
| DELETE | `/<resource>/:id` | Deactivates instead of deleting when referenced |

`POST`/`PUT` bodies are validated field by field; unknown fields are ignored
and `fieldErrors` names the offending input.

## Subject allocations

Assigns each department subject to exactly one faculty member per semester. This
is the record every other faculty-scoped screen keys off.

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| GET | `/subject-allocations` | admin,hod | Allocations (filters: `semester`, `subjectCode`, `departmentId`, `facultyId`, `status`) |
| GET | `/subject-allocations/mine` | faculty,hod,admin | Subjects currently allocated to the signed-in faculty member |
| GET | `/subject-allocations/teachers` | student | Teachers who teach the signed-in student's semester |
| POST | `/subject-allocations` | admin,hod | Allocate a subject to a faculty member |
| PUT | `/subject-allocations/:id` | admin,hod | Change status / dates of an allocation |
| DELETE | `/subject-allocations/:id` | admin,hod | Deactivate an allocation (blocked if the subject still has records) |

```json
POST /subject-allocations
{ "semester": 5, "subjectCode": "CS501", "facultyId": "FAC-7QX2M4K",
  "assignedDate": "2026-06-01", "note": "Database Systems" }
```

Rules:

- `subjectCode` is normalised to upper case and resolved against the real
  `Subjects` sheet, so `cs501` and `CS501` can never create two rows.
- An HOD may only allocate subjects and faculty of their own department; another
  department returns 403.
- The faculty member must exist and be active in that department.
- Unique on `(departmentId, semester, subjectCode, facultyId)` - the same
  allocation twice returns 409.
- Assigning a different faculty member to an already-allocated subject inserts
  the new row and deactivates the previous holder, so a subject never shows two
  teachers.
- Deactivating is refused while attendance, materials, assignments or marks
  still reference the allocation.

## Materials (extra routes)

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| GET | `/materials/mine` | faculty | Own uploads plus material for allocated subjects |
| GET | `/materials/teachable` | faculty | Allocated subject codes for the publish form |

- Faculty may create, edit and delete material **only** for a subject they hold
  an active allocation for (403 otherwise).
- Students see material for their own department + semester whose `visibility`
  is `all`, plus their own teachers' uploads.

## Faculty students

`GET /students/mine` - students of the semesters/subjects currently allocated to
the signed-in faculty member, sorted naturally by register number. Optional
`semester` or `subjectCode` narrows further; asking for a subject they do not
teach returns 403.

## Attendance

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| GET | `/attendance/me` | student | Own records + percentage |
| GET | `/attendance/roster` | faculty,hod,admin | Class list for a subject/date |
| GET | `/attendance/summary` | faculty,hod,admin | Subject-wise summary |
| POST | `/attendance` | faculty,hod,admin | Submit a session |
| PUT | `/attendance/:id` | hod,admin | Correct one record (reason required) |
| DELETE | `/attendance/:id` | hod,admin | Remove one record (reason required) |

```json
POST /attendance
{ "semester": 5, "subjectCode": "CS501", "date": "2026-02-18",
  "students": [ { "registerNumber": "STU-001", "status": "present" } ],
  "overrideCutoff": false, "reason": "" }
```

- Faculty are blocked after **17:00 IST** with 403 and a message explaining
  the cutoff.
- A faculty member can only open and submit a register for a subject they hold
  an active allocation for; HOD and admin may act department-wide.
- Re-submitting an already-marked session requires
  `"overrideCutoff": true` **and** a `reason` (min. 3 characters); only HOD/Admin
  may override. Every override is audited.
- Unknown register numbers are ignored; an empty valid roster returns 400.
- Each affected student receives their own notification.

## Assignments (extra routes)

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| GET | `/assignments/mine` | student | Own assignments with **that student's** submission |
| POST | `/assignments/:id/submit` | student | Save own submission (note and/or file link) |
| DELETE | `/assignments/:id/submit` | student | Withdraw own submission |
| GET | `/assignments/:id/submissions` | faculty,hod,admin | Who has submitted (HOD dept-scoped) |

Submissions are stored as one `AssignmentSubmissions` row per
`(assignmentId, studentId)`, so students never overwrite each other.

Faculty may create, edit or remove an assignment only for a subject they hold an
active allocation for; HOD and admin keep department-wide control.

## Marks

`GET /marks/mine` (student) returns the signed-in student's own marks with
totals and percentage, including `semesterResult`.

Faculty may record or correct marks only for an allocated subject. Mark caps are
enforced: internal ≤ 40, exam ≤ 60, assignment ≤ 20.

## Subjects

`GET /subjects/lookup?semester=5` - lightweight list for pickers (title,
code, semester). Student reads are restricted to their own semester.

## Search

`GET /users/search/global?q=term` (admin) searches users, students, faculty and
HODs across every department and returns grouped results.