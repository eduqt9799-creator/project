# Permissions

## Enforcement model

1. The frontend hides what a role cannot use, but that is cosmetic only.
2. Every `/api` request except `POST /api/auth/login` requires a valid JWT.
3. `authenticateUser` re-reads the `Users` sheet on **every** request, so a
   changed role, department or `status` applies immediately - an existing token
   cannot outlive a deactivation.
4. Route-level `requireRole(...)` and the crudFactory `roles` map decide what the
   role may do.
5. Department scope is applied from the session, never from the request body:
   - `admin` may read/write every department and pick one when creating.
   - `hod` and `faculty` are pinned to their own `departmentId`; a different
     value in the body is rejected with 403.
6. Students are additionally restricted to their own semester.
7. Subject-level ownership is applied on top of department scope: a `faculty`
   account may only act on a subject that has an **active** row in
   `SubjectAllocations` for them.

## Subject allocation

`SubjectAllocations` is the authority for "who teaches what". It is checked on
every faculty write, not just at login, so revoking an allocation takes effect
immediately.

| Action | Faculty | HOD | Admin |
| --- | --- | --- | --- |
| Publish / edit material for a subject | allocated subjects only | own department | any department |
| Open and submit an attendance register | allocated subjects only | own department | any department |
| Create / edit an assignment | allocated subjects only | own department | any department |
| Record / correct marks | allocated subjects only | own department | any department |
| See "My Students" | own allocated semesters / subjects | own department | any department |
| Allocate / reassign a subject | – | own department | any department |
| See students' teachers ("My Teachers") | – | – | – (students only) |

- Duplicate allocation of the same subject to the same faculty returns 409.
- Assigning a different faculty member deactivates the previous holder, so a
  subject never appears with two active teachers.
- A subject with no allocation is invisible to faculty everywhere, and is listed
  for the HOD under **unallocated** in the Control Center.

## Matrix

`own` = only the signed-in user's records.

| Capability | Student | Faculty | HOD | Admin |
| --- | :-: | :-: | :-: | :-: |
| Sign in / change own password / edit own profile | Y | Y | Y | Y |
| Dashboard | own | own classes | department | global |
| Department Control Center | – | – | own dept | any dept |
| Reports | – | own dept | own dept | any dept |
| View own attendance, marks, materials, timetable, exams, assignments | Y | – | – | – |
| Submit own assignment | Y | – | – | – |
| View department students | – | Y (allocated subjects) | Y | Y |
| View own teachers | Y | – | – | – |
| Create / edit students | – | – | Y | Y |
| Delete students | – | – | – | Y |
| Create / edit faculty | – | – | Y | Y |
| Delete faculty | – | – | – | Y |
| Create / edit HOD | – | – | – | Y |
| Departments | read | read | read | manage |
| Subjects | own semester | own semester | manage dept | manage all |
| Subject allocation | – | own subjects (read) | manage dept | manage all |
| Materials | own semester | allocated subjects | manage dept | manage all |
| Assignments | own semester (submit) | allocated subjects | manage dept | manage all |
| Marks | own only | allocated subjects | manage dept | manage all |
| Timetable | own semester | read | manage dept | manage all |
| Exams | own semester | read | manage dept | manage all |
| Attendance marking | – | allocated subject, until 17:00 IST | dept, with override | all, with override |
| Attendance correction / deletion (reason required) | – | – | own dept | any |
| Announcements | read | manage | manage dept | manage all |
| Send notifications | – | – | own dept recipients | anyone |
| Users / login accounts | – | – | – | manage |
| Global search | – | – | – | Y |
| Audit log | – | – | – | read |

## Attendance cutoff

- `ATTENDANCE_CUTOFF_HOUR` (default `17`) in `ATTENDANCE_TIMEZONE`
  (default `Asia/Kolkata`).
- Faculty submission outside the window returns 403 and cannot be bypassed.
- HOD/Admin reopen with `overrideCutoff: true` plus a reason of at least 3
  characters. The reopen is written to `AuditLog` as `reopen_update` with the
  performer, role, timestamp and reason.

## Account lifecycle

| Action | Result |
| --- | --- |
| Create student / faculty / HOD profile | A matching `Users` login is provisioned in the same request with the supplied password (bcrypt) |
| Change profile email / name / phone | The linked login is updated in the same request |
| Deactivate a profile | The linked login is set to `inactive` and can no longer sign in |
| Change a password while editing a profile | The linked login's hash is replaced |
| Delete a referenced record | It is deactivated instead of deleted, and the response sets `deactivated: true` |

A profile with no login (for example one imported directly into the sheet) can
still be given an account from the admin Users screen.

## Audit behaviour

`AuditLog` is append-only and records `performedBy`, `performedByName`,
`performedByRole`, `departmentId`, `detail` and `createdAt` for:

- `create`, `update`, `delete` on every resource
- `reopen_update` for attendance overrides and corrections (reason included)
- `login` and `login_failed`
- automatic deactivation when a delete is blocked by references

## Bridge authorisation

The Apps Script web app is the only writer. It rejects every call unless the
`API_KEY` Script Property exists **and** the caller sends the same key, so the
`/exec` URL alone is not enough to read or modify data.

For every department-scoped sheet (`Students`, `Faculty`, `HODs`, `Subjects`,
`SubjectAllocations`, `Attendance`, `Materials`, `Assignments`,
`AssignmentSubmissions`, `Marks`, `Timetable`, `Exams`, `Announcements`) the
bridge additionally requires the backend to send an `actor`
(`{ role, departmentId, userId }`) and re-checks the department on the written
row. A non-admin actor writing to another department fails in the bridge even if
a bug in the backend let the request through.