# Sheet schema

One Google Sheets spreadsheet holds every table. `setupSheets()` in
`apps-script/Code.gs` is the single source of truth for headers (`SCHEMA`),
primary keys (`PK`) and id prefixes (`ID_PREFIX`); running it creates any
missing sheet and **appends** any missing column.

**Re-run `setupSheets()` after deploying a new `Code.gs`** - it is safe to run
repeatedly and does not delete data or touch existing columns. It only ever adds
columns to the right of the existing ones, so a column added in the middle of
`SCHEMA` (like `Students.batch`) still lands after the current last column rather
than shifting the data below it. Existing rows keep their values and read as
empty in the new column until you fill it in.

## Conventions

| Convention | Rule |
| --- | --- |
| Primary key | First id column, e.g. `studentId`. Prefixed + timestamp, e.g. `STU-6F2K9QX4`. |
| Status | `active` / `inactive`. Inactive rows are kept, never deleted, when referenced. |
| Timestamps | ISO-8601 UTC (`createdAt`, `updatedAt`). Sheet timezone is `Asia/Kolkata`. |
| Booleans | Written as the text `TRUE` / `FALSE`. The backend normalises on read. |
| Department | `departmentId` + denormalised `departmentName` for readable exports. |
| Deletion | Referenced rows deactivate; only unreferenced rows are removed. |

## New sheets and columns on an existing spreadsheet

`setupSheets()` only appends. A deployment that predates the allocation work
gains the new sheets and the new columns appended to the right of the existing
ones; existing rows keep their values and get empty values in the new columns.

It never renames, reorders or rewrites a column that is already there. Rewriting
the header row in place would relabel every value below it without moving the
data, which is how `Students.batch` and `Students.semester` came back blank or
shifted on spreadsheets created before those columns existed.

Reads and writes resolve columns by header **name**, never by position in
`SCHEMA`, so a column that has been dragged to a different position still reads
and updates the right cells. `setupSheets()` reports any column it appended, plus
a warning if a sheet's columns are not in schema order.

Verify the migration logic locally with `npm run check`; it runs
`backend/scripts/check-schema-migration.js` against a fake spreadsheet.

Re-run `setupSheets()` once per deployment that changes `SCHEMA`, then check the
header row before entering data.

## Students

`studentId`, `registerNumber`, `name`, `email`, `phone`, `semester`,
`departmentId`, `departmentName`, `batch`, `status`, `createdAt`, `updatedAt`

Unique: `registerNumber` (per department), `email`.

- `batch` is optional. On a spreadsheet created before this column existed it is
  appended last, so it is the **last** column on that sheet rather than the ninth.
  Reads and writes find it by name, so the position does not matter.
- `semester` is required, and every read/write resolves it by name. Do not move
  it by hand.

## Users

`userId`, `name`, `email`, `role`, `departmentId`, `departmentName`,
`passwordHash`, `status`, `studentId`, `facultyId`, `hodId`, `createdAt`,
`updatedAt`, `lastLoginAt`

- `role` is one of `admin`, `hod`, `faculty`, `student`.
- `studentId` / `facultyId` / `hodId` link the login to its profile row, so the
  account keeps working after an email change. Exactly one is set.
- `passwordHash` is bcrypt (`$2a$...`) for every account the backend creates.
  The bootstrap admin uses `hmac-sha256$<iterations>$<salt>$<digest>`.
- Never returned by the API.

## Departments

`departmentId`, `departmentCode`, `departmentName`, `status`, `createdAt`, `updatedAt`

## Faculty / HODs

`facultyId` / `hodId`, `employeeId`, `name`, `email`, `phone`, `designation`,
`departmentId`, `departmentName`, `status`, `createdAt`, `updatedAt`

Unique: `employeeId`, `email`.

## Subjects

`subjectId`, `subjectCode`, `subjectName`, `semester`, `credits`,
`departmentId`, `departmentName`, `status`, `createdAt`, `updatedAt`

Unique: `subjectCode` + `semester` + `departmentId` (the same code may exist in
two departments, or be repeated across semesters).

## Attendance

`attendanceId`, `date`, `registerNumber`, `studentName`, `studentId`,
`subjectCode`, `subjectName`, `semester`, `departmentId`, `departmentName`,
`status`, `facultyId`, `facultyName`, `createdAt`, `updatedAt`, `updatedBy`,
`updatedByRole`

- `status` is `present` or `absent`.
- One row per student per subject per day: `registerNumber` + `subjectCode` +
  `date`. `save_attendance` upserts on that key.
- `facultyId` is the **Faculty sheet row id** of the teacher who marked the
  session (not the login `userId`); a sheet edited by hand may leave it blank,
  which the backend treats as "unknown marker" rather than failing.
- Faculty submission closes at **17:00 IST**. Only HOD/Admin can reopen, and a
  reason (min. 3 characters) is required and audited.

## SubjectAllocations

`allocationId`, `departmentId`, `departmentName`, `semester`, `subjectCode`,
`subjectName`, `facultyId`, `facultyName`, `assignedDate`, `assignedBy`,
`note`, `status`, `createdAt`, `updatedAt`

- The link between a subject and the teacher who owns it. Faculty-scoped
  screens (materials, attendance, assignments, marks, students) key off this
  table, so an unallocated subject is invisible to faculty.
- `status` is `active` or `inactive`. Reassigning a subject inserts the new row
  and sets the previous holder to `inactive`, so history is kept and a subject
  never has two active teachers.
- `facultyId` / `departmentId` are stored on the row so reads never need a join.
  When a teacher is renamed, the live `Faculty` row wins; `facultyName` is only
  a fallback.

Unique: `departmentId` + `semester` + `subjectCode` + `facultyId`.

## Materials

`materialId`, `title`, `description`, `subjectCode`, `subjectName`, `semester`,
`fileUrl`, `fileId`, `fileName`, `uploadedBy`, `uploadedById`, `departmentId`,
`departmentName`, `createdAt`, `updatedAt`, `facultyId`, `facultyName`,
`visibility`, `status`, `uploadDate`, `uploadedDate`

- `visibility` is `all` (students may see it), `hod` or `faculty` (staff only).
- `uploadedById` is the Faculty row id of the uploader; the department may only
  publish material for a subject one of its faculty is allocated to.
- `uploadDate` mirrors `uploadedDate`, and `status` defaults to `active` on
  create. Both are stamped by `beforeCreate` in `backend/src/routes/materials.js`
  so a row is never written with an empty status (which the list filters drop).
- The last six columns were appended after the sheet already existed, so on an
  older spreadsheet they sit further right than the order shown above.

## Assignments

`assignmentId`, `title`, `description`, `subjectCode`, `subjectName`,
`semester`, `assignedDate`, `dueDate`, `assignedBy`, `assignedById`, `status`,
`departmentId`, `departmentName`, `createdAt`, `updatedAt`

## AssignmentSubmissions

`submissionId`, `assignmentId`, `studentId`, `registerNumber`, `studentName`,
`submittedAt`, `submissionNote`, `fileUrl`, `status`, `departmentId`,
`createdAt`, `updatedAt`

Unique: `assignmentId` + `studentId`. One row per student, so submissions never
overwrite each other or the shared assignment row.

## Marks

`marksId`, `registerNumber`, `studentName`, `studentId`, `subjectCode`,
`subjectName`, `semester`, `internalMark`, `assignmentMark`, `examMark`,
`semesterResult`, `departmentId`, `departmentName`, `createdAt`, `updatedAt`,
`updatedBy`, `updatedByRole`

Unique: `registerNumber` + `subjectCode` + `departmentId`.

## Timetable

`timetableId`, `day`, `startTime`, `endTime`, `subjectCode`, `subjectName`,
`semester`, `room`, `facultyName`, `departmentId`, `departmentName`,
`createdAt`, `updatedAt`

Unique: `day` + `startTime` + `semester` + `departmentId` + `subjectCode`.
`endTime` must be later than `startTime` (24-hour `HH:MM`).

## Exams

`examId`, `examName`, `examType`, `subjectCode`, `subjectName`, `semester`,
`date`, `startTime`, `endTime`, `room`, `departmentId`, `departmentName`,
`createdAt`, `updatedAt`

Unique: `subjectCode` + `date` + `departmentId`.

## Announcements

`announcementId`, `title`, `description`, `category`, `priority`,
`publishDate`, `targetRole`, `departmentId`, `departmentName`, `createdBy`,
`createdByName`, `createdAt`, `updatedAt`, `updatedBy`

## Notifications

`notificationId`, `userId`, `title`, `message`, `type`, `isRead`, `readAt`,
`createdAt`

`userId` holds the recipient's `userId`, or the register number / employee id
where no linked login exists. `type` is `info`, `success`, `warning` or `error`.

## AuditLog

`auditId`, `action`, `resource`, `recordId`, `performedBy`, `performedByName`,
`performedByRole`, `departmentId`, `detail`, `createdAt`

Append-only. `action` is one of `create`, `update`, `delete`, `login`,
`login_failed`, `reopen_update`. `detail` carries the reason for destructive
actions.