import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  departmentsApi, examsApi, facultyApi, hodsApi, materialsApi, marksApi,
  studentsApi, subjectAllocationsApi, subjectsApi, timetableApi, usersApi,
} from '../../services/api';
import {
  Alert, Badge, Card, CardBody, CardHeader, ConfirmDialog, DataTable, ErrorState, LoadingState,
  Modal, PageHeader, Pagination, PasswordInput, SearchBar, SelectInput, StatusBadge, TextArea,
  TextInput, useToast,
} from '../../components/ui';
import { IconEdit, IconPlus, IconRefresh, IconShield, IconTrash } from '../../components/Icons';
import { SEMESTERS, DAYS } from '../student/index';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const isEmailRule = { label: 'Email', required: true, check: (v) => (EMAIL_RE.test(String(v).trim()) ? true : 'Enter a valid email address') };
const today = () => new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------ helpers */

const useDepartmentOptions = (enabled) => {
  const [departments, setDepartments] = useState([]);
  useEffect(() => {
    if (!enabled) return;
    departmentsApi.list().then((res) => setDepartments(res.data || [])).catch(() => setDepartments([]));
  }, [enabled]);
  return departments;
};

/**
 * UI-side capability map. The backend re-checks every rule on each request, so
 * these flags only decide which buttons are rendered.
 */
const usePermissions = () => {
  const { role, isAdmin } = useAuth();
  return useMemo(
    () => ({
      role,
      isAdmin,
      isHod: role === 'hod',
      isFaculty: role === 'faculty',
      canManageAcademics: role === 'faculty' || role === 'hod' || role === 'admin',
      canManagePeople: role === 'hod' || role === 'admin',
      canConfigure: role === 'admin',
    }),
    [role, isAdmin]
  );
};

const validate = (values, rules) => {
  const errors = {};
  Object.entries(rules).forEach(([field, rule]) => {
    const value = values[field];
    if (rule.required && (value === undefined || value === null || String(value).trim() === '')) {
      errors[field] = `${rule.label} is required`;
      return;
    }
    if (!rule.required && !value) return;
    const result = rule.check ? rule.check(value) : true;
    if (result !== true) errors[field] = result;
  });
  return errors;
};

const RULES = {
  studentName: { label: 'Student name', required: true, check: (v) => (String(v).trim().length >= 2 ? true : 'Enter the student name') },
  registerNumber: { label: 'Register number', required: true, check: (v) => (/^[A-Za-z0-9][A-Za-z0-9/-]{1,19}$/.test(String(v).trim()) ? true : 'Use 2-20 letters, digits, - or /') },
  email: { label: 'Email', required: true, check: (v) => (EMAIL_RE.test(String(v).trim()) ? true : 'Enter a valid email address') },
  phone: { label: 'Phone', check: (v) => (/^[0-9+\-\s]{6,15}$/.test(String(v)) ? true : 'Enter a valid phone number') },
  password: { label: 'Password', required: true, check: (v) => (String(v).length >= 8 ? true : 'Minimum 8 characters') },
  employeeId: { label: 'Employee ID', required: true, check: (v) => (/^[A-Za-z0-9][A-Za-z0-9-]{1,19}$/.test(String(v).trim()) ? true : 'Use 2-20 letters, digits or -') },
  designation: { label: 'Designation', check: (v) => (String(v).trim().length >= 2 ? true : 'Enter a designation') },
  semester: { label: 'Semester', required: true, check: (v) => (Number(v) >= 1 && Number(v) <= 10 ? true : 'Semester must be 1-10') },
  batch: { label: 'Batch', check: (v) => (/^[A-Za-z0-9-]{1,15}$/.test(String(v)) ? true : 'Use 1-15 letters, digits or -') },
  subjectCode: { label: 'Subject code', required: true, check: (v) => (/^[A-Za-z0-9][A-Za-z0-9/&-]{1,19}$/.test(String(v).trim()) ? true : 'Use 2-20 letters, digits, /, & or -') },
  subjectName: { label: 'Subject name', required: true, check: (v) => (String(v).trim().length >= 2 ? true : 'Enter the subject name') },
  credits: { label: 'Credits', required: true, check: (v) => (Number(v) >= 0 && Number(v) <= 20 ? true : 'Credits must be 0-20') },
  departmentId: { label: 'Department', required: true, check: (v) => (String(v).trim() !== '' ? true : 'Select a department') },
  title: { label: 'Title', required: true, check: (v) => (String(v).trim().length >= 3 ? true : 'Enter at least 3 characters') },
  description: { label: 'Description', check: (v) => (String(v).trim().length >= 3 ? true : 'Enter at least 3 characters') },
  assignedDate: { label: 'Assigned date', required: true, check: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? true : 'Use YYYY-MM-DD') },
  dueDate: { label: 'Due date', required: true, check: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? true : 'Use YYYY-MM-DD') },
  fileUrl: { label: 'File URL', check: (v) => (!String(v).trim() || /^https?:\/\/\S+$/i.test(String(v).trim()) ? true : 'Enter a valid http(s) URL') },
  date: { label: 'Date', required: true, check: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? true : 'Use YYYY-MM-DD') },
  startTime: { label: 'Start time', required: true, check: (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)) ? true : 'Use 24-hour HH:MM') },
  endTime: { label: 'End time', required: true, check: (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)) ? true : 'Use 24-hour HH:MM') },
  room: { label: 'Room', check: (v) => (String(v).trim().length >= 1 ? true : 'Enter a room') },
  examName: { label: 'Exam name', required: true, check: (v) => (String(v).trim().length >= 2 ? true : 'Enter the exam name') },
  category: { label: 'Category', required: true, check: (v) => (String(v).trim().length >= 2 ? true : 'Enter a category') },
  priority: { label: 'Priority', required: true, check: (v) => (['low', 'medium', 'high'].includes(String(v)) ? true : 'Choose low, medium or high') },
  targetRole: { label: 'Target role', required: true, check: (v) => (['all', 'student', 'faculty', 'hod'].includes(String(v)) ? true : 'Choose a target role') },
  internalMark: { label: 'Internal mark', required: true, check: (v) => (Number(v) >= 0 && Number(v) <= 40 ? true : 'Internal mark must be 0-40') },
  examMark: { label: 'Exam mark', check: (v) => (Number(v) >= 0 && Number(v) <= 60 ? true : 'Exam mark must be 0-60') },
  assignmentMark: { label: 'Assignment mark', check: (v) => (Number(v) >= 0 && Number(v) <= 20 ? true : 'Assignment mark must be 0-20') },
  name: { label: 'Name', required: true, check: (v) => (String(v).trim().length >= 2 ? true : 'Enter the name') },
  role: { label: 'Role', required: true, check: (v) => (['student', 'faculty', 'hod', 'admin'].includes(String(v)) ? true : 'Choose a role') },
  departmentCode: { label: 'Department code', required: true, check: (v) => (/^[A-Za-z0-9-]{2,10}$/.test(String(v).trim()) ? true : 'Use 2-10 letters, digits or -') },
  departmentName: { label: 'Department name', required: true, check: (v) => (String(v).trim().length >= 3 ? true : 'Enter the department name') },
};

/** Generic CRUD management page used by faculty, HOD and admin modules. */
export const CrudPage = ({
  title,
  subtitle,
  resource,               // { label, idField, list, create, update, remove }
  columns,
  filters = [],
  formFields,
  defaultValues = {},
  canCreate = true,
  canEdit = true,
  canDelete = true,
  searchPlaceholder = 'Search...',
  emptyTitle,
  rowKey = 'id',
  addLabel = 'Add',
  onAfterChange,
  onFieldChange,
  headerExtra,
  modalSize = '',
  listParams = {},
}) => {
  const toast = useToast();
  const [params, setParams] = useState({ limit: 25, page: 1, ...listParams });
  const [state, setState] = useState({ loading: true, error: '', rows: [], pagination: null });
  const [editing, setEditing] = useState(null);      // null | 'new' | row
  const [values, setValues] = useState(defaultValues);
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [deleteReason, setDeleteReason] = useState('');

  // `resource` is declared inline by each page, so keep the latest in a ref and
  // drive list loading from `params` only. Otherwise every parent render would
  // produce a new callback identity and re-fetch in a loop.
  const resourceRef = useRef(resource);
  resourceRef.current = resource;
  const requestId = useRef(0);
  const resourceLabel = resource.label;

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    // The bridge takes seconds, so two overlapping searches can resolve out of
    // order. Only the newest request may write state, otherwise a slow earlier
    // response leaves stale rows on screen.
    const ticket = ++requestId.current;
    try {
      const res = await resourceRef.current.list(params);
      if (ticket !== requestId.current) return;
      setState({ loading: false, error: '', rows: res.data || [], pagination: res.pagination || null });
    } catch (error) {
      if (ticket !== requestId.current) return;
      setState({ loading: false, error: error.message, rows: [], pagination: null });
    }
  }, [params]);

  useEffect(() => { load(); }, [load]);

  const setParam = (key, value) => setParams((p) => ({ ...p, [key]: value, page: key === 'page' ? value : 1 }));

  const openCreate = () => { setEditing('new'); setValues({ status: 'active', ...defaultValues }); setFormErrors({}); };
  const openEdit = (row) => {
    const next = { ...defaultValues };
    Object.keys(formFields).forEach((key) => {
      if (row[key] !== undefined && row[key] !== null) next[key] = String(row[key]);
    });
    setEditing(row);
    setValues(next);
    setFormErrors({});
  };
  const close = () => { setEditing(null); setFormErrors({}); };

  /**
   * Lets a page react to a field changing so dependent dropdowns (e.g. the
   * subject list for a chosen semester) can be reloaded.
   */
  const onFieldChangeRef = useRef(onFieldChange);
  onFieldChangeRef.current = onFieldChange;
  const changeValue = useCallback((name, value) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    onFieldChangeRef.current?.(name, value);
  }, []);

  /**
   * Primary key for a row. This deployment keys its sheets with a generated `id`,
   * so a row often has no `<resource>Id` and `row[rowKey]` is undefined — which
   * produced requests like `PUT /api/materials/undefined`. Fall back to `id`.
   */
  const keyOf = (row) => {
    if (!row || typeof row !== 'object') return undefined;
    const value = row[rowKey];
    if (value !== undefined && value !== null && value !== '') return value;
    return row.id;
  };

  const submit = async (event) => {
    event.preventDefault();
    const isCreate = editing === 'new';
    const rules = {};
    formFields.forEach((f) => {
      if (!f.rules) return;
      // Fields flagged `requiredOnCreate` are only mandatory when adding a record,
      // so editing a student/faculty/HOD does not force a new password.
      if (f.requiredOnCreate && !isCreate) return;
      rules[f.name] = f.rules;
    });
    const errors = validate(values, rules);
    setFormErrors(errors);
    if (Object.keys(errors).length) return;

    const payload = { ...values };
    formFields.forEach((f) => {
      if (payload[f.name] === '' || payload[f.name] === undefined) delete payload[f.name];
      else if (f.type === 'number') payload[f.name] = Number(payload[f.name]);
    });

    setSaving(true);
    try {
      if (isCreate) {
        await resourceRef.current.create(payload);
        toast.success(`${resourceLabel} created`, 'The record was saved successfully.');
      } else {
        await resourceRef.current.update(keyOf(editing), payload);
        toast.success(`${resourceLabel} updated`, 'Your changes were saved.');
      }
      close();
      await load();
      onAfterChange?.();
    } catch (error) {
      if (error.fieldErrors) setFormErrors(error.fieldErrors);
      toast.error(`Could not save ${resourceLabel.toLowerCase()}`, error.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    setSaving(true);
    try {
      const res = await resourceRef.current.remove(keyOf(deleting), deleteReason ? { reason: deleteReason } : undefined);
      toast.success(res.message || `${resourceLabel} removed`);
      setDeleting(null);
      setDeleteReason('');
      await load();
      onAfterChange?.();
    } catch (error) {
      toast.error(`Could not remove ${resourceLabel.toLowerCase()}`, error.message);
    } finally {
      setSaving(false);
    }
  };

  const allColumns = useMemo(() => {
    const cols = [...columns];
    if (canEdit || canDelete) {
      cols.push({
        key: '__actions',
        header: 'Actions',
        className: 'actions',
        render: (row) => (
          <div style={{ display: 'inline-flex', gap: 6 }}>
            {canEdit ? (
              <button type="button" className="icon-btn" onClick={() => openEdit(row)} aria-label={`Edit ${resourceLabel}`} title="Edit">
                <IconEdit size={17} />
              </button>
            ) : null}
            {canDelete ? (
              <button type="button" className="icon-btn danger" onClick={() => setDeleting(row)} aria-label={`Delete ${resourceLabel}`} title="Delete">
                <IconTrash size={17} />
              </button>
            ) : null}
          </div>
        ),
      });
    }
    return cols;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, canEdit, canDelete, resourceLabel, rowKey]);

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={(
          <>
            <button type="button" className="btn btn-secondary" onClick={load}><IconRefresh size={16} />Refresh</button>
            {canCreate ? <button type="button" className="btn btn-primary" onClick={openCreate}><IconPlus size={16} />{addLabel}</button> : null}
          </>
        )}
      />
      {headerExtra}

      <Card>
        <CardHeader title={`${title} list`} actions={(
          <div className="filterbar">
            <div style={{ minWidth: 230 }}>
              <SearchBar value={params.search || ''} onChange={(v) => setParam('search', v)} placeholder={searchPlaceholder} />
            </div>
            {filters.map((f) => (
              <SelectInput
                key={f.name}
                label={f.label}
                value={params[f.name] ?? ''}
                onChange={(e) => setParam(f.name, e.target.value)}
                placeholder={f.placeholder || `All ${f.label.toLowerCase()}`}
                options={f.options}
              />
            ))}
          </div>
        )} />
        <CardBody tight>
          {state.loading ? <LoadingState label={`Loading ${resourceLabel.toLowerCase()}...`} />
            : state.error ? <ErrorState message={state.error} onRetry={load} />
            : (
              <DataTable
                rows={state.rows}
                keyField={rowKey}
                emptyTitle={emptyTitle || `No ${resourceLabel.toLowerCase()} records available.`}
                columns={allColumns}
              />
            )}
        </CardBody>
        <Pagination pagination={state.pagination} onPageChange={(page) => setParam('page', page)} />
      </Card>

      <Modal
        open={editing !== null}
title={editing === 'new' ? `${addLabel} ${resourceLabel}` : `${resourceLabel} details`}
        onClose={close}
        size={modalSize}
        footer={(
          <>
            <button type="button" className="btn btn-secondary" onClick={close} disabled={saving}>Cancel</button>
            <button type="submit" form="crud-form" className="btn btn-primary" disabled={saving}>
              {saving ? <span className="spinner" /> : null}{editing === 'new' ? `Create ${resourceLabel.toLowerCase()}` : 'Save changes'}
            </button>
          </>
        )}
      >
        <form id="crud-form" onSubmit={submit} noValidate>
          {state.error ? <div className="mb-2"><Alert tone="error">{state.error}</Alert></div> : null}
          <div className="form-grid">
            {formFields.map((f) => (
              <FormControl key={f.name} field={f} value={values[f.name] ?? ''} error={formErrors[f.name]}
                required={f.required && (!f.requiredOnCreate || editing === 'new')}
                onChange={(v) => changeValue(f.name, v)} />
            ))}
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title={`Remove ${resourceLabel.toLowerCase()}`}
        message={
          <>
            Remove <strong>{deleting?.[columns[0]?.key] ?? deleting?.id ?? 'this record'}</strong>? Records referenced by
            academic history are deactivated automatically instead of being deleted.
          </>
        }
        confirmLabel="Remove"
        loading={saving}
        onCancel={() => { setDeleting(null); setDeleteReason(''); }}
        onConfirm={confirmDelete}
      />
    </>
  );
};

const FormControl = ({ field, value, error, required, onChange }) => {
  // No `id` here: TextInput/SelectInput generate one with useId() and pair it
  // with the <label htmlFor>. Spreading an `id` over that breaks the pairing,
  // so clicking a label stops focusing its field.
  const common = { name: field.name, value, placeholder: field.placeholder || '' };
  if (field.type === 'select') {
    return (
      <SelectInput
        label={field.label}
        required={required}
        error={error}
        hint={field.hint}
        className={field.span ? 'span-2' : ''}
        options={field.options || []}
        placeholder={field.placeholder}
        disabled={field.disabled}
        onChange={(e) => onChange(e.target.value)}
        {...common}
      />
    );
  }
  if (field.type === 'textarea') {
    return (
      <TextArea
        label={field.label}
        required={required}
        error={error}
        hint={field.hint}
        className={field.span ? 'span-2' : ''}
        disabled={field.disabled}
        onChange={(e) => onChange(e.target.value)}
        {...common}
      />
    );
  }
  if (field.type === 'password') {
    return (
      <PasswordInput
        label={field.label}
        required={required}
        error={error}
        hint={field.hint || 'Leave blank to keep the current password'}
        className={field.span ? 'span-2' : ''}
        disabled={field.disabled}
        onChange={(e) => onChange(e.target.value)}
        {...common}
      />
    );
  }
  return (
    <TextInput
      label={field.label}
      required={required}
      error={error}
      hint={field.hint}
      type={field.type || 'text'}
      min={field.min}
      max={field.max}
      step={field.step}
      className={field.span ? 'span-2' : ''}
      disabled={field.disabled}
      onChange={(e) => onChange(e.target.value)}
      {...common}
    />
  );
};

/* ------------------------------------------------------------- departments */

export const DepartmentsPage = ({ adminOnly = false }) => {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [params, setParams] = useState({ search: '' });
  const [state, setState] = useState({ loading: true, error: '', rows: [] });
  const [editing, setEditing] = useState(null);
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const res = await departmentsApi.list({ search: params.search });
      setState({ loading: false, error: '', rows: res.data || [] });
    } catch (error) {
      setState({ loading: false, error: error.message, rows: [] });
    }
  }, [params.search]);

  useEffect(() => { load(); }, [load]);

  const submit = async (event) => {
    event.preventDefault();
    const nextErrors = validate(values, {
      departmentId: { label: 'Department ID', required: true, check: (v) => (/^[A-Za-z0-9-]{2,20}$/.test(String(v).trim()) ? true : 'Use 2-20 letters, digits or -') },
      departmentCode: RULES.departmentCode,
      departmentName: RULES.departmentName,
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSaving(true);
    try {
      if (editing === 'new') {
        await departmentsApi.create(values);
        toast.success('Department created');
      } else {
        await departmentsApi.update(editing.departmentId, { departmentCode: values.departmentCode, departmentName: values.departmentName, status: values.status || 'active' });
        toast.success('Department updated');
      }
      setEditing(null);
      load();
    } catch (error) {
      if (error.fieldErrors) setErrors(error.fieldErrors);
      toast.error('Could not save department', error.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      const res = await departmentsApi.remove(deleting.departmentId);
      toast.success(res.message || 'Department removed');
      setDeleting(null);
      load();
    } catch (error) {
      toast.error('Could not remove department', error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Department Management"
        subtitle={adminOnly ? 'Create, update and archive departments. Departments with records are deactivated, never deleted.' : 'Departments configured in the department data store.'}
        actions={isAdmin ? <button type="button" className="btn btn-primary" onClick={() => { setEditing('new'); setValues({ status: 'active' }); setErrors({}); }}><IconPlus size={16} />Add department</button> : null}
      />
      <Card>
        <CardHeader title="Departments" actions={<div style={{ minWidth: 240 }}><SearchBar value={params.search} onChange={(v) => setParams((p) => ({ ...p, search: v }))} placeholder="Search departments" /></div>} />
        <CardBody tight>
          {state.loading ? <LoadingState label="Loading departments..." />
            : state.error ? <ErrorState message={state.error} onRetry={load} />
            : (
              <DataTable
                rows={state.rows}
                keyField="departmentId"
                emptyTitle="No department records available."
                columns={[
                  { key: 'departmentId', header: 'Department ID', render: (r) => <span className="mono strong">{r.departmentId}</span> },
                  { key: 'departmentCode', header: 'Code', render: (r) => <span className="mono">{r.departmentCode}</span> },
                  { key: 'departmentName', header: 'Department Name' },
                  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                  { key: 'createdAt', header: 'Created', render: (r) => (r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—') },
                  ...(isAdmin ? [{
                    key: '__actions',
                    header: 'Actions',
                    className: 'actions',
                    render: (r) => (
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button type="button" className="icon-btn" onClick={() => { setEditing(r); setValues({ departmentId: r.departmentId, departmentCode: r.departmentCode, departmentName: r.departmentName, status: r.status }); setErrors({}); }} aria-label="Edit department"><IconEdit size={17} /></button>
                        <button type="button" className="icon-btn danger" onClick={() => setDeleting(r)} aria-label="Delete department"><IconTrash size={17} /></button>
                      </div>
                    ),
                  }] : []),
                ]}
              />
            )}
        </CardBody>
      </Card>

      <Modal
        open={editing !== null}
        title={editing === 'new' ? 'Add department' : 'Edit department'}
        onClose={() => setEditing(null)}
        footer={(
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
            <button type="submit" form="department-form" className="btn btn-primary" disabled={saving}>{saving ? <span className="spinner" /> : 'Save'}</button>
          </>
        )}
      >
        <form id="department-form" onSubmit={submit} noValidate>
          <div className="form-grid">
            <TextInput label="Department ID" required disabled={editing !== 'new'} value={values.departmentId || ''} onChange={(e) => setValues((p) => ({ ...p, departmentId: e.target.value }))} error={errors.departmentId} hint="Permanent identifier, e.g. CSE" />
            <TextInput label="Department Code" required value={values.departmentCode || ''} onChange={(e) => setValues((p) => ({ ...p, departmentCode: e.target.value }))} error={errors.departmentCode} />
            <TextInput label="Department Name" required className="span-2" value={values.departmentName || ''} onChange={(e) => setValues((p) => ({ ...p, departmentName: e.target.value }))} error={errors.departmentName} />
            {editing !== 'new' ? (
              <SelectInput label="Status" value={values.status || 'active'} onChange={(e) => setValues((p) => ({ ...p, status: e.target.value }))} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
            ) : null}
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete department"
        message={`Delete ${deleting?.departmentName}? If students, faculty, HODs or subjects still reference it, the department is deactivated instead.`}
        confirmLabel="Delete"
        loading={saving}
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
      />
    </>
  );
};

/* ---------------------------------------------------------------- students */

/**
 * Faculty "My Students".
 *
 * Reads `/students/mine`, so the list is built from the semesters the caller is
 * allocated to rather than the whole department, and is always returned in
 * ascending register-number order (the natural comparator, so 22CS010 follows
 * 22CS009).
 */
export const FacultyStudentsPage = () => {
  const toast = useToast();
  const [subjects, setSubjects] = useState([]);
  const [params, setParams] = useState({ search: '', subjectCode: '', semester: '', page: 1, limit: 200 });
  const [state, setState] = useState({ loading: true, error: '', rows: [], pagination: null, subject: null, semesters: null });

  useEffect(() => {
    let cancelled = false;
    subjectAllocationsApi
      .mine()
      .then((res) => {
        if (cancelled) return;
        const rows = res.data || [];
        setSubjects(rows.map((a) => ({ value: a.subjectCode, label: `${a.subjectCode} · ${a.subjectName} (Sem ${a.semester})` })));
      })
      .catch(() => { if (!cancelled) setSubjects([]); });
    return () => { cancelled = true; };
  }, []);

  const requestId = useRef(0);
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    const ticket = ++requestId.current;
    try {
      const res = await studentsApi.mine(params);
      if (ticket !== requestId.current) return;
      setState({
        loading: false, error: '', rows: res.data || [], pagination: res.pagination || null,
        subject: res.raw?.subject || null, semesters: res.raw?.semesters || null,
      });
    } catch (error) {
      if (ticket !== requestId.current) return;
      setState({ loading: false, error: error.message, rows: [], pagination: null, subject: null, semesters: null });
    }
  }, [params]);

  useEffect(() => { load(); }, [load]);

  const setParam = (key, value) => setParams((p) => ({ ...p, [key]: value, page: key === 'page' ? value : 1 }));

  return (
    <>
      <PageHeader
        title="My Students"
        subtitle="Students of the subjects allocated to you, in ascending register-number order."
        actions={(
          <>
            <div style={{ minWidth: 240 }}>
              <SearchBar value={params.search} onChange={(v) => setParam('search', v)} placeholder="Search name or register number" />
            </div>
            <SelectInput
              label="Subject"
              value={params.subjectCode}
              onChange={(e) => setParam('subjectCode', e.target.value)}
              placeholder="All my subjects"
              options={subjects}
            />
            <SelectInput
              label="Semester"
              value={params.semester}
              onChange={(e) => setParam('semester', e.target.value)}
              placeholder="All semesters"
              options={SEMESTERS}
            />
            <button type="button" className="btn btn-secondary" onClick={load}><IconRefresh size={16} />Refresh</button>
          </>
        )}
      />

      {subjects.length === 0 && !state.loading ? (
        <div className="mb-2">
          <Alert tone="warning" title="You have no allocated subjects yet.">
            Ask your HOD to allocate you a subject from Subject Allocation. Only students of an allocated
            subject appear here, so there is nothing to show until then.
          </Alert>
        </div>
      ) : null}

      <Card>
        <CardHeader
          title={state.subject ? `${state.subject.subjectCode} · ${state.subject.subjectName}` : 'Student list'}
          subtitle={
            state.semesters
              ? `Semester${state.semesters.length === 1 ? '' : 's'} ${state.semesters.join(', ')} · sorted by register number`
              : 'Sorted by register number ascending'
          }
          actions={state.pagination ? <Badge tone="info">{state.pagination.total} student{state.pagination.total === 1 ? '' : 's'}</Badge> : null}
        />
        <CardBody tight>
          {state.loading ? <LoadingState label="Loading your students..." />
            : state.error ? <ErrorState message={state.error} onRetry={load} />
            : (
              <DataTable
                rows={state.rows}
                keyField="studentId"
                emptyTitle="No students found."
                emptyDescription="No student matches these filters."
                columns={[
                  { key: 'registerNumber', header: 'Register Number', render: (r) => <span className="mono strong">{r.registerNumber}</span> },
                  { key: 'name', header: 'Name' },
                  { key: 'semester', header: 'Semester', className: 'num' },
                  { key: 'batch', header: 'Batch', render: (r) => r.batch || '—' },
                  { key: 'email', header: 'Email' },
                  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                ]}
              />
            )}
        </CardBody>
        <Pagination pagination={state.pagination} onPageChange={(page) => setParam('page', page)} />
      </Card>
    </>
  );
};

export const StudentsPage = ({ scope }) => {
  const { isAdmin, departmentName } = useAuth();
  const permissions = usePermissions();
  const departments = useDepartmentOptions(isAdmin);
  const canManage = permissions.canManagePeople;
  const label = scope === 'faculty' ? 'My Students' : 'Student Management';

  const departmentField = (required) => ({
    name: 'departmentId',
    label: 'Department',
    type: 'select',
    required: isAdmin,
    requiredOnCreate: required && isAdmin,
    rules: isAdmin ? RULES.departmentId : undefined,
    disabled: !isAdmin,
    placeholder: isAdmin ? 'Select department' : departmentName,
    options: departments.map((d) => ({ value: d.departmentId, label: `${d.departmentCode} · ${d.departmentName}` })),
    hint: isAdmin ? undefined : 'Taken from your authenticated account',
  });

  return (
    <CrudPage
      title={label}
      subtitle={
        isAdmin
          ? 'Global student records. Sorted by register number ascending by default.'
          : `Students of ${departmentName || 'your department'}, sorted by register number ascending.`
      }
      rowKey="studentId"
      canCreate={canManage}
      canEdit={canManage}
      canDelete={isAdmin}
      emptyTitle="No student records available."
      searchPlaceholder="Search name, register number or email"
      addLabel="Add student"
      resource={{
        label: 'Student',
        idField: 'studentId',
        list: (params) => studentsApi.list({ ...params, sortBy: 'registerNumber', sortDir: 'asc' }),
        create: (body) => studentsApi.create(body),
        update: (id, body) => studentsApi.update(id, body),
        remove: (id) => studentsApi.remove(id),
      }}
      columns={[
        { key: 'registerNumber', header: 'Register Number', render: (r) => <span className="mono strong">{r.registerNumber}</span> },
        { key: 'name', header: 'Name' },
        { key: 'email', header: 'Email' },
        { key: 'phone', header: 'Phone', render: (r) => r.phone || '—' },
        { key: 'semester', header: 'Semester', className: 'num' },
        { key: 'batch', header: 'Batch', render: (r) => r.batch || '—' },
        ...(isAdmin ? [{ key: 'departmentName', header: 'Department' }] : []),
        { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
      ]}
      filters={[
        { name: 'semester', label: 'Semester', options: SEMESTERS },
        { name: 'status', label: 'Status', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
        ...(isAdmin ? [{ name: 'departmentId', label: 'Department', options: departments.map((d) => ({ value: d.departmentId, label: d.departmentName })) }] : []),
      ]}
      formFields={[
        { name: 'registerNumber', label: 'Register Number', required: true, rules: RULES.registerNumber, requiredOnCreate: true },
        { name: 'name', label: 'Student Name', required: true, rules: RULES.studentName, requiredOnCreate: true },
        { name: 'email', label: 'Email', type: 'email', required: true, rules: RULES.email, requiredOnCreate: true },
        { name: 'phone', label: 'Phone', rules: RULES.phone },
        { name: 'semester', label: 'Semester', type: 'number', required: true, min: 1, max: 10, rules: RULES.semester, requiredOnCreate: true },
        { name: 'batch', label: 'Batch', rules: RULES.batch, placeholder: 'e.g. 2022' },
        departmentField(true),
        { name: 'password', label: 'Login Password', type: 'password', required: true, rules: RULES.password, requiredOnCreate: true, hint: 'Minimum 8 characters. Hashed before storage.' },
        { name: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
      ]}
    />
  );
};

/* ----------------------------------------------------------------- faculty */

export const FacultyPage = () => {
  const { isAdmin, departmentName } = useAuth();
  const permissions = usePermissions();
  const departments = useDepartmentOptions(isAdmin);

  return (
    <CrudPage
      title="Faculty Management"
      subtitle={isAdmin ? 'Global faculty records.' : `Faculty of ${departmentName || 'your department'}.`}
      rowKey="facultyId"
      canCreate={permissions.canManagePeople}
      canEdit={permissions.canManagePeople}
      canDelete={isAdmin}
      emptyTitle="No faculty records available."
      searchPlaceholder="Search name, employee ID or email"
      addLabel="Add faculty"
      resource={{
        label: 'Faculty',
        idField: 'facultyId',
        list: (params) => facultyApi.list(params),
        create: (body) => facultyApi.create(body),
        update: (id, body) => facultyApi.update(id, body),
        remove: (id) => facultyApi.remove(id),
      }}
      columns={[
        { key: 'employeeId', header: 'Employee ID', render: (r) => <span className="mono strong">{r.employeeId}</span> },
        { key: 'name', header: 'Name' },
        { key: 'email', header: 'Email' },
        { key: 'phone', header: 'Phone', render: (r) => r.phone || '—' },
        { key: 'designation', header: 'Designation', render: (r) => r.designation || '—' },
        ...(isAdmin ? [{ key: 'departmentName', header: 'Department' }] : []),
        { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
      ]}
      filters={[
        { name: 'status', label: 'Status', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
        ...(isAdmin ? [{ name: 'departmentId', label: 'Department', options: departments.map((d) => ({ value: d.departmentId, label: d.departmentName })) }] : []),
      ]}
      formFields={[
        { name: 'employeeId', label: 'Employee ID', required: true, rules: RULES.employeeId, requiredOnCreate: true },
        { name: 'name', label: 'Faculty Name', required: true, rules: RULES.name, requiredOnCreate: true },
        { name: 'email', label: 'Email', type: 'email', required: true, rules: RULES.email, requiredOnCreate: true },
        { name: 'phone', label: 'Phone', rules: RULES.phone },
        { name: 'designation', label: 'Designation', rules: RULES.designation, placeholder: 'e.g. Assistant Professor' },
        ...(isAdmin ? [{
          name: 'departmentId', label: 'Department', type: 'select', required: true, requiredOnCreate: true, rules: RULES.departmentId,
          options: departments.map((d) => ({ value: d.departmentId, label: `${d.departmentCode} · ${d.departmentName}` })),
        }] : []),
        { name: 'password', label: 'Login Password', type: 'password', required: true, rules: RULES.password, requiredOnCreate: true, hint: 'Minimum 8 characters. Hashed before storage.' },
        { name: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
      ]}
    />
  );
};

/* -------------------------------------------------------------------- HODs */

export const HodsPage = () => {
  const departments = useDepartmentOptions(true);
  return (
    <CrudPage
      title="HOD Management"
      subtitle="Head of Department accounts. Departments are configured in the department data store."
      rowKey="hodId"
      emptyTitle="No HOD records available."
      searchPlaceholder="Search name, employee ID or email"
      addLabel="Add HOD"
      resource={{
        label: 'HOD',
        idField: 'hodId',
        list: (params) => hodsApi.list(params),
        create: (body) => hodsApi.create(body),
        update: (id, body) => hodsApi.update(id, body),
        remove: (id) => hodsApi.remove(id),
      }}
      columns={[
        { key: 'employeeId', header: 'Employee ID', render: (r) => <span className="mono strong">{r.employeeId}</span> },
        { key: 'name', header: 'Name' },
        { key: 'email', header: 'Email' },
        { key: 'phone', header: 'Phone', render: (r) => r.phone || '—' },
        { key: 'designation', header: 'Designation', render: (r) => r.designation || '—' },
        { key: 'departmentName', header: 'Department' },
        { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
      ]}
      filters={[
        { name: 'status', label: 'Status', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
        { name: 'departmentId', label: 'Department', options: departments.map((d) => ({ value: d.departmentId, label: d.departmentName })) },
      ]}
      formFields={[
        { name: 'employeeId', label: 'Employee ID', required: true, rules: RULES.employeeId, requiredOnCreate: true },
        { name: 'name', label: 'HOD Name', required: true, rules: RULES.name, requiredOnCreate: true },
        { name: 'email', label: 'Email', type: 'email', required: true, rules: RULES.email, requiredOnCreate: true },
        { name: 'phone', label: 'Phone', rules: RULES.phone },
        { name: 'designation', label: 'Designation', rules: RULES.designation },
        { name: 'departmentId', label: 'Department', type: 'select', required: true, requiredOnCreate: true, rules: RULES.departmentId,
          options: departments.map((d) => ({ value: d.departmentId, label: `${d.departmentCode} · ${d.departmentName}` })) },
        { name: 'password', label: 'Login Password', type: 'password', required: true, rules: RULES.password, requiredOnCreate: true, hint: 'Minimum 8 characters. Hashed before storage.' },
        { name: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
      ]}
    />
  );
};

/* ---------------------------------------------------------------- subjects */

export const SubjectsPage = ({ canEdit }) => {
  const { isAdmin, departmentName } = useAuth();
  const permissions = usePermissions();
  const departments = useDepartmentOptions(isAdmin);
  const editable = canEdit ?? permissions.canManagePeople;

  return (
    <CrudPage
      title="Subject Management"
      subtitle={isAdmin ? 'Subjects across all departments.' : `Subjects of ${departmentName || 'your department'}.`}
      rowKey="subjectId"
      emptyTitle="No subject records available."
      searchPlaceholder="Search subject code or name"
      addLabel="Add subject"
      canCreate={editable}
      canEdit={editable}
      canDelete={isAdmin}
      resource={{
        label: 'Subject',
        idField: 'subjectId',
        list: (params) => subjectsApi.list(params),
        create: (body) => subjectsApi.create(body),
        update: (id, body) => subjectsApi.update(id, body),
        remove: (id) => subjectsApi.remove(id),
      }}
      columns={[
        { key: 'subjectCode', header: 'Subject Code', render: (r) => <span className="mono strong">{r.subjectCode}</span> },
        { key: 'subjectName', header: 'Subject Name' },
        { key: 'semester', header: 'Semester', className: 'num' },
        { key: 'credits', header: 'Credits', className: 'num' },
        ...(isAdmin ? [{ key: 'departmentName', header: 'Department' }] : []),
        { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
      ]}
      filters={[
        { name: 'semester', label: 'Semester', options: SEMESTERS },
        { name: 'status', label: 'Status', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
        ...(isAdmin ? [{ name: 'departmentId', label: 'Department', options: departments.map((d) => ({ value: d.departmentId, label: d.departmentName })) }] : []),
      ]}
      formFields={[
        { name: 'subjectCode', label: 'Subject Code', required: true, rules: RULES.subjectCode, requiredOnCreate: true },
        { name: 'subjectName', label: 'Subject Name', required: true, rules: RULES.subjectName, requiredOnCreate: true },
        { name: 'semester', label: 'Semester', type: 'number', required: true, min: 1, max: 10, rules: RULES.semester, requiredOnCreate: true },
        { name: 'credits', label: 'Credits', type: 'number', required: true, min: 0, max: 20, rules: RULES.credits, requiredOnCreate: true },
        ...(isAdmin ? [{
          name: 'departmentId', label: 'Department', type: 'select', required: true, requiredOnCreate: true, rules: RULES.departmentId,
          options: departments.map((d) => ({ value: d.departmentId, label: `${d.departmentCode} · ${d.departmentName}` })),
        }] : []),
        { name: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
      ]}
    />
  );
};

/* ----------------------------------------------------- subject allocation */

/**
 * HOD Subject Allocation.
 *
 * An allocation is the single source of truth for "who teaches what", so this
 * page is what makes a subject teachable: faculty materials, assignments and
 * attendance are all gated on an active allocation existing here.
 *
 * Reassigning a subject to a different faculty member deactivates the previous
 * holder on the server, so a subject never has two active teachers.
 */
export const SubjectAllocationPage = () => {
  const { isAdmin, departmentName } = useAuth();
  const permissions = usePermissions();
  const departments = useDepartmentOptions(isAdmin);
  const canAllocate = permissions.canManagePeople;
  const [facultyOptions, setFacultyOptions] = useState([]);
  const [subjectOptions, setSubjectOptions] = useState([]);

  useEffect(() => {
    if (!canAllocate) return;
    let cancelled = false;
    facultyApi
      .list({ limit: 200 })
      .then((res) => {
        if (cancelled) return;
        setFacultyOptions((res.data || []).map((f) => ({
          value: f.facultyId,
          label: `${f.name}${f.employeeId ? ` · ${f.employeeId}` : ''}${f.designation ? ` · ${f.designation}` : ''}`,
        })));
      })
      .catch(() => { if (!cancelled) setFacultyOptions([]); });
    return () => { cancelled = true; };
  }, [canAllocate]);

  // Subject options follow the department + semester chosen in the form, so an
  // allocation can never be created against a subject that does not exist.
  const [watch, setWatch] = useState({});
  useEffect(() => {
    const params = {
      limit: 200,
      semester: watch.semester || undefined,
      departmentId: isAdmin ? watch.departmentId || undefined : undefined,
    };
    let cancelled = false;
    subjectsApi
      .list(params)
      .then((res) => {
        if (cancelled) return;
        setSubjectOptions((res.data || []).map((s) => ({
          value: s.subjectCode,
          label: `${s.subjectCode} · ${s.subjectName} (Sem ${s.semester})`,
          semester: s.semester,
        })));
      })
      .catch(() => { if (!cancelled) setSubjectOptions([]); });
    return () => { cancelled = true; };
  }, [watch.semester, watch.departmentId, isAdmin]);

  const onFieldChange = (name, value) => setWatch((w) => ({ ...w, [name]: value }));

  return (
    <CrudPage
      title="Subject Allocation"
      subtitle={
        isAdmin
          ? 'Assign subjects to faculty across all departments. Each subject has one active teacher.'
          : `Assign subjects to faculty of ${departmentName || 'your department'}. Each subject has one active teacher.`
      }
      rowKey="allocationId"
      canCreate={canAllocate}
      canEdit={canAllocate}
      canDelete={canAllocate}
      emptyTitle="No subject allocations available."
      searchPlaceholder="Search subject code or faculty name"
      addLabel="Allocate subject"
      onFieldChange={onFieldChange}
      resource={{
        label: 'Subject allocation',
        idField: 'allocationId',
        list: (params) => subjectAllocationsApi.list({ ...params, limit: 50 }),
        create: (body) => subjectAllocationsApi.create(body),
        update: (id, body) => subjectAllocationsApi.update(id, body),
        remove: (id) => subjectAllocationsApi.remove(id),
      }}
      columns={[
        { key: 'semester', header: 'Semester', className: 'num' },
        { key: 'subjectCode', header: 'Subject Code', render: (r) => <span className="mono strong">{r.subjectCode}</span> },
        { key: 'subjectName', header: 'Subject' },
        { key: 'facultyName', header: 'Faculty', render: (r) => <span className="strong">{r.facultyName || '—'}</span> },
        { key: 'facultyDesignation', header: 'Designation', render: (r) => r.facultyDesignation || '—' },
        { key: 'assignedDate', header: 'Allocated On', render: (r) => (r.assignedDate ? new Date(r.assignedDate).toLocaleDateString() : '—') },
        { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
      ]}
      filters={[
        { name: 'semester', label: 'Semester', options: SEMESTERS },
        { name: 'status', label: 'Status', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
        ...(isAdmin ? [{ name: 'departmentId', label: 'Department', options: departments.map((d) => ({ value: d.departmentId, label: d.departmentName })) }] : []),
      ]}
      formFields={[
        ...(isAdmin ? [{
          name: 'departmentId', label: 'Department', type: 'select', required: true, requiredOnCreate: true, rules: RULES.departmentId,
          options: departments.map((d) => ({ value: d.departmentId, label: `${d.departmentCode} · ${d.departmentName}` })),
        }] : []),
        { name: 'semester', label: 'Semester', type: 'select', required: true, rules: RULES.semester, requiredOnCreate: true, options: SEMESTERS },
        {
          name: 'subjectCode', label: 'Subject', type: 'select', required: true, rules: RULES.subjectCode, requiredOnCreate: true,
          options: subjectOptions,
          placeholder: isAdmin && !watch.semester ? 'Choose a semester first' : 'Select a subject',
          disabled: isAdmin && !watch.semester,
          hint: !isAdmin && subjectOptions.length === 0 ? 'Add subjects for this semester before allocating them.' : undefined,
        },
        {
          name: 'facultyId', label: 'Faculty Member', type: 'select', required: true,
          rules: { label: 'Faculty member', required: true, check: (v) => (String(v || '').trim() !== '' ? true : 'Select a faculty member') },
          requiredOnCreate: true,
          options: facultyOptions,
          placeholder: 'Select a faculty member',
          hint: facultyOptions.length === 0 ? 'Add faculty members to your department first.' : undefined,
        },
        { name: 'assignedDate', label: 'Allocated On', type: 'date', rules: RULES.assignedDate },
        { name: 'notes', label: 'Notes', type: 'textarea', span: true },
        { name: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
      ]}
    />
  );
};

/* --------------------------------------------------------------- materials */

/**
 * Subject options for a material form.
 *
 * A faculty member may only publish for a subject allocated to them, so the
 * dropdown is built from `/materials/teachable` rather than the whole department.
 * An empty list means the HOD has not allocated any subject yet, and the backend
 * rejects the write with the same explanation.
 */
const useTeachableSubjects = (enabled) => {
  const [subjects, setSubjects] = useState([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    materialsApi
      .teachable()
      .then((res) => { if (!cancelled) setSubjects(res.data || []); })
      .catch(() => { if (!cancelled) setSubjects([]); });
    return () => { cancelled = true; };
  }, [enabled]);
  return subjects;
};

export const MaterialsPage = () => {
  const { isAdmin, role, departmentName } = useAuth();
  const permissions = usePermissions();
  const toast = useToast();
  const departments = useDepartmentOptions(isAdmin);
  const canManage = permissions.canManageAcademics;
  const teachable = useTeachableSubjects(canManage);
  // A faculty member uploads against one of their allocated subjects; the admin
  // and HOD may post department-wide material for any subject.
  const subjectOptions = (
    role === 'faculty'
      ? teachable.map((s) => ({ value: s.subjectCode, label: `${s.subjectCode} · ${s.subjectName} (Sem ${s.semester})` }))
      : []
  );

  const saveFromForm = async (values) => {
    const payload = {
      title: values.title,
      description: values.description,
      subjectCode: String(values.subjectCode || '').toUpperCase(),
      semester: Number(values.semester),
      visibility: values.visibility || 'all',
      fileUrl: values.fileUrl,
      fileName: values.fileName,
      departmentId: isAdmin ? values.departmentId : undefined,
    };
    await materialsApi.create(payload);
    toast.success('Material created');
  };

  return (
    <CrudPage
      title="Study Materials"
      subtitle={
        isAdmin
          ? 'Materials for all departments. File URLs must point to real stored files.'
          : role === 'faculty'
            ? 'Materials for the subjects allocated to you. Ask your HOD if a subject is missing.'
            : `Materials for ${departmentName || 'your department'}.`
      }
      rowKey="materialId"
      canCreate={canManage}
      canEdit={canManage}
      canDelete={canManage}
      emptyTitle="No materials available."
      searchPlaceholder="Search title or subject"
      addLabel="Add material"
      resource={{
        label: 'Material',
        idField: 'materialId',
        list: (params) => materialsApi.list({ ...params, limit: 50 }),
        create: async (body) => { await saveFromForm(body); },
        update: (id, body) => materialsApi.update(id, {
          title: body.title, description: body.description, subjectCode: body.subjectCode,
          semester: Number(body.semester), visibility: body.visibility, fileUrl: body.fileUrl, fileName: body.fileName,
        }),
        remove: (id) => materialsApi.remove(id),
      }}
      columns={[
        { key: 'title', header: 'Title', render: (r) => <span className="strong">{r.title}</span> },
        { key: 'subjectCode', header: 'Subject', render: (r) => <span className="mono">{r.subjectCode}</span> },
        { key: 'semester', header: 'Semester', className: 'num' },
        { key: 'facultyName', header: 'Faculty', render: (r) => r.facultyName || r.uploadedBy || '—' },
        ...(role === 'faculty' ? [] : [{ key: 'visibility', header: 'Visibility', render: (r) => <Badge tone={r.visibility === 'all' ? 'info' : 'neutral'}>{r.visibility || 'all'}</Badge> }]),
        { key: 'createdAt', header: 'Date', render: (r) => (r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—') },
        {
          key: 'fileUrl',
          header: 'File',
          render: (r) => (r.fileUrl
            ? <a className="btn btn-ghost btn-sm" href={r.fileUrl} target="_blank" rel="noreferrer">Open</a>
            : <span className="muted">No file</span>),
        },
      ]}
      filters={[
        { name: 'semester', label: 'Semester', options: SEMESTERS },
        ...(isAdmin ? [{ name: 'departmentId', label: 'Department', options: departments.map((d) => ({ value: d.departmentId, label: d.departmentName })) }] : []),
      ]}
      formFields={[
        { name: 'title', label: 'Material Title', required: true, rules: RULES.title, requiredOnCreate: true, span: true },
        { name: 'description', label: 'Description', type: 'textarea', span: true, rules: RULES.description },
        {
          name: 'subjectCode', label: 'Subject', required: true, rules: RULES.subjectCode, requiredOnCreate: true,
          type: role === 'faculty' ? 'select' : 'text',
          placeholder: role === 'faculty' ? undefined : 'e.g. CS3A',
          options: role === 'faculty' ? subjectOptions : undefined,
          hint: role === 'faculty' && teachable.length === 0 ? 'You have no allocated subjects yet. Ask your HOD to allocate one.' : undefined,
        },
        { name: 'semester', label: 'Semester', type: 'number', required: true, min: 1, max: 10, rules: RULES.semester, requiredOnCreate: true },
        { name: 'visibility', label: 'Visibility', type: 'select', options: [
          { value: 'all', label: 'All (students + staff)' },
          { value: 'students', label: 'Students only' },
          { value: 'faculty', label: 'Faculty only' },
          { value: 'hod', label: 'Staff only (HOD + faculty)' },
        ] },
        { name: 'fileUrl', label: 'File URL', span: true, rules: RULES.fileUrl, placeholder: 'https://drive.google.com/...' },
        { name: 'fileName', label: 'File Name', span: true, rules: RULES.description, placeholder: 'e.g. unit-1-notes.pdf' },
        ...(isAdmin ? [{
          name: 'departmentId', label: 'Department', type: 'select', required: true, requiredOnCreate: true, rules: RULES.departmentId,
          options: departments.map((d) => ({ value: d.departmentId, label: `${d.departmentCode} · ${d.departmentName}` })),
        }] : []),
      ]}
    />
  );
};

/* ------------------------------------------------------------- assignments */

export const AssignmentsPage = ({ scope }) => {
  const { isAdmin, departmentName } = useAuth();
  const permissions = usePermissions();
  const departments = useDepartmentOptions(isAdmin);

  return (
    <CrudPage
      title="Assignments"
      subtitle={isAdmin ? 'Assignments across all departments.' : `Assignments for ${departmentName || 'your department'}.`}
      rowKey="assignmentId"
      canCreate={permissions.canManageAcademics}
      canEdit={permissions.canManageAcademics}
      canDelete={permissions.canManageAcademics}
      emptyTitle="No assignments available."
      searchPlaceholder="Search title or subject"
      addLabel="Add assignment"
      resource={{
        label: 'Assignment',
        idField: 'assignmentId',
        list: (params) => (scope === 'student' ? assignmentsApi.mine(params) : assignmentsApi.list({ ...params, limit: 50 })),
        create: (body) => assignmentsApi.create({ ...body, semester: Number(body.semester) }),
        update: (id, body) => assignmentsApi.update(id, { ...body, semester: Number(body.semester) }),
        remove: (id) => assignmentsApi.remove(id),
      }}
      columns={[
        { key: 'title', header: 'Assignment', render: (r) => <span className="strong">{r.title}</span> },
        { key: 'subjectCode', header: 'Subject', render: (r) => <span className="mono">{r.subjectCode}</span> },
        { key: 'semester', header: 'Semester', className: 'num' },
        { key: 'assignedDate', header: 'Assigned' },
        { key: 'dueDate', header: 'Due' },
        ...(isAdmin ? [{ key: 'departmentName', header: 'Department' }] : []),
        { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
      ]}
      filters={[
        { name: 'semester', label: 'Semester', options: SEMESTERS },
        ...(isAdmin ? [{ name: 'departmentId', label: 'Department', options: departments.map((d) => ({ value: d.departmentId, label: d.departmentName })) }] : []),
      ]}
      defaultValues={{ assignedDate: today(), dueDate: today() }}
      formFields={[
        { name: 'title', label: 'Assignment Title', required: true, rules: RULES.title, requiredOnCreate: true, span: true },
        { name: 'description', label: 'Description', type: 'textarea', span: true, rules: RULES.description },
        { name: 'subjectCode', label: 'Subject Code', required: true, rules: RULES.subjectCode, requiredOnCreate: true },
        { name: 'semester', label: 'Semester', type: 'number', required: true, min: 1, max: 10, rules: RULES.semester, requiredOnCreate: true },
        { name: 'assignedDate', label: 'Assigned Date', type: 'date', required: true, rules: RULES.assignedDate, requiredOnCreate: true },
        { name: 'dueDate', label: 'Due Date', type: 'date', required: true, rules: RULES.dueDate, requiredOnCreate: true },
        ...(isAdmin ? [{
          name: 'departmentId', label: 'Department', type: 'select', required: true, requiredOnCreate: true, rules: RULES.departmentId,
          options: departments.map((d) => ({ value: d.departmentId, label: `${d.departmentCode} · ${d.departmentName}` })),
        }] : []),
      ]}
    />
  );
};

/* ------------------------------------------------------------------- marks */

export const MarksPage = ({ scope }) => {
  const { isAdmin, departmentName } = useAuth();
  const permissions = usePermissions();
  const departments = useDepartmentOptions(isAdmin);

  return (
    <CrudPage
      title="Marks"
      subtitle={isAdmin ? 'Marks across all departments, sorted by register number.' : `Marks for ${departmentName || 'your department'}.`}
      rowKey="marksId"
      canCreate={permissions.canManageAcademics}
      canEdit={permissions.canManageAcademics}
      canDelete={permissions.canManagePeople}
      emptyTitle="No marks records available."
      searchPlaceholder="Search register number or subject"
      addLabel="Add marks"
      defaultValues={{ internalMark: 0, examMark: 0, assignmentMark: 0 }}
      resource={{
        label: 'Marks',
        idField: 'marksId',
        list: (params) => (scope === 'student' ? marksApi.mine(params) : marksApi.list({ ...params, sortBy: 'registerNumber', sortDir: 'asc' })),
        create: (body) => marksApi.create({ ...body, internalMark: Number(body.internalMark), examMark: Number(body.examMark || 0), assignmentMark: Number(body.assignmentMark || 0) }),
        update: (id, body) => marksApi.update(id, { ...body, internalMark: Number(body.internalMark), examMark: Number(body.examMark || 0), assignmentMark: Number(body.assignmentMark || 0) }),
        remove: (id) => marksApi.remove(id),
      }}
      columns={[
        { key: 'registerNumber', header: 'Register Number', render: (r) => <span className="mono strong">{r.registerNumber}</span> },
        { key: 'studentName', header: 'Student' },
        { key: 'subjectCode', header: 'Subject', render: (r) => <span className="mono">{r.subjectCode}</span> },
        { key: 'semester', header: 'Semester', className: 'num' },
        { key: 'internalMark', header: 'Internal', className: 'num' },
        { key: 'assignmentMark', header: 'Assignment', className: 'num' },
        { key: 'examMark', header: 'Exam', className: 'num' },
        ...(isAdmin ? [{ key: 'departmentName', header: 'Department' }] : []),
      ]}
      filters={[
        { name: 'semester', label: 'Semester', options: SEMESTERS },
        ...(isAdmin ? [{ name: 'departmentId', label: 'Department', options: departments.map((d) => ({ value: d.departmentId, label: d.departmentName })) }] : []),
      ]}
      formFields={[
        { name: 'registerNumber', label: 'Register Number', required: true, rules: RULES.registerNumber, requiredOnCreate: true },
        { name: 'subjectCode', label: 'Subject Code', required: true, rules: RULES.subjectCode, requiredOnCreate: true },
        { name: 'semester', label: 'Semester', type: 'number', rules: RULES.semester, hint: 'Must match the student semester' },
        { name: 'internalMark', label: 'Internal Mark (max 40)', type: 'number', required: true, min: 0, max: 40, rules: RULES.internalMark, requiredOnCreate: true },
        { name: 'assignmentMark', label: 'Assignment Mark (max 20)', type: 'number', min: 0, max: 20, rules: RULES.assignmentMark },
        { name: 'examMark', label: 'Exam Mark (max 60)', type: 'number', min: 0, max: 60, rules: RULES.examMark },
        ...(isAdmin ? [{
          name: 'departmentId', label: 'Department', type: 'select', required: true, requiredOnCreate: true, rules: RULES.departmentId,
          options: departments.map((d) => ({ value: d.departmentId, label: `${d.departmentCode} · ${d.departmentName}` })),
        }] : []),
      ]}
    />
  );
};

/* --------------------------------------------------------------- timetable */

export const TimetablePage = () => {
  const { isAdmin, departmentName } = useAuth();
  const permissions = usePermissions();
  const departments = useDepartmentOptions(isAdmin);
  const canManage = permissions.isHod || permissions.isAdmin;

  return (
    <CrudPage
      title="Timetable"
      subtitle={isAdmin ? 'Weekly schedule for all departments.' : `Weekly schedule for ${departmentName || 'your department'}.`}
      rowKey="timetableId"
      canCreate={canManage}
      canEdit={canManage}
      canDelete={canManage}
      emptyTitle="No timetable records available."
      searchPlaceholder="Search subject or room"
      addLabel="Add slot"
      defaultValues={{ day: 'Monday', startTime: '09:00', endTime: '09:50' }}
      resource={{
        label: 'Timetable',
        idField: 'timetableId',
        list: (params) => timetableApi.list({ ...params, limit: 200 }),
        create: (body) => timetableApi.create(body),
        update: (id, body) => timetableApi.update(id, body),
        remove: (id) => timetableApi.remove(id),
      }}
      columns={[
        { key: 'day', header: 'Day' },
        { key: 'time', header: 'Time', render: (r) => `${r.startTime} – ${r.endTime}` },
        { key: 'subjectCode', header: 'Subject Code', render: (r) => <span className="mono strong">{r.subjectCode}</span> },
        { key: 'subjectName', header: 'Subject' },
        { key: 'semester', header: 'Semester', className: 'num' },
        { key: 'room', header: 'Room', render: (r) => r.room || '—' },
        ...(isAdmin ? [{ key: 'departmentName', header: 'Department' }] : []),
      ]}
      filters={[
        { name: 'day', label: 'Day', options: DAYS.map((d) => ({ value: d, label: d })) },
        { name: 'semester', label: 'Semester', options: SEMESTERS },
        ...(isAdmin ? [{ name: 'departmentId', label: 'Department', options: departments.map((d) => ({ value: d.departmentId, label: d.departmentName })) }] : []),
      ]}
      formFields={[
        { name: 'day', label: 'Day', type: 'select', required: true, requiredOnCreate: true, options: DAYS.map((d) => ({ value: d, label: d })) },
        { name: 'startTime', label: 'Start Time', required: true, requiredOnCreate: true, rules: RULES.startTime, placeholder: '09:00' },
        { name: 'endTime', label: 'End Time', required: true, requiredOnCreate: true, rules: RULES.endTime, placeholder: '09:50' },
        { name: 'subjectCode', label: 'Subject Code', required: true, requiredOnCreate: true, rules: RULES.subjectCode },
        { name: 'subjectName', label: 'Subject Name', rules: RULES.subjectName },
        { name: 'semester', label: 'Semester', type: 'number', min: 1, max: 10, rules: RULES.semester },
        { name: 'room', label: 'Room', rules: RULES.room, placeholder: 'e.g. LT-3' },
        ...(isAdmin ? [{
          name: 'departmentId', label: 'Department', type: 'select', required: true, requiredOnCreate: true, rules: RULES.departmentId,
          options: departments.map((d) => ({ value: d.departmentId, label: `${d.departmentCode} · ${d.departmentName}` })),
        }] : []),
      ]}
    />
  );
};

/* ------------------------------------------------------------------ exams */

export const ExamsPage = () => {
  const { isAdmin, departmentName } = useAuth();
  const permissions = usePermissions();
  const departments = useDepartmentOptions(isAdmin);
  const canManage = permissions.isHod || permissions.isAdmin;

  return (
    <CrudPage
      title="Examinations"
      subtitle={isAdmin ? 'Examination schedule for all departments.' : `Examination schedule for ${departmentName || 'your department'}.`}
      rowKey="examId"
      canCreate={canManage}
      canEdit={canManage}
      canDelete={canManage}
      emptyTitle="No examination records available."
      searchPlaceholder="Search exam or subject"
      addLabel="Add exam"
      defaultValues={{ examType: 'internal', startTime: '10:00', endTime: '12:00' }}
      resource={{
        label: 'Exam',
        idField: 'examId',
        list: (params) => examsApi.list({ ...params, limit: 100 }),
        create: (body) => examsApi.create({ ...body, semester: Number(body.semester) }),
        update: (id, body) => examsApi.update(id, { ...body, semester: Number(body.semester) }),
        remove: (id) => examsApi.remove(id),
      }}
      columns={[
        { key: 'examName', header: 'Exam', render: (r) => <span className="strong">{r.examName}</span> },
        { key: 'examType', header: 'Type', render: (r) => <Badge tone="info">{r.examType}</Badge> },
        { key: 'subjectCode', header: 'Subject', render: (r) => <span className="mono">{r.subjectCode}</span> },
        { key: 'semester', header: 'Semester', className: 'num' },
        { key: 'date', header: 'Date' },
        { key: 'time', header: 'Time', render: (r) => `${r.startTime} – ${r.endTime}` },
        { key: 'room', header: 'Room', render: (r) => r.room || '—' },
        ...(isAdmin ? [{ key: 'departmentName', header: 'Department' }] : []),
      ]}
      filters={[
        { name: 'examType', label: 'Exam Type', options: ['internal', 'assignment', 'model', 'semester', 'practical'].map((t) => ({ value: t, label: t })) },
        { name: 'semester', label: 'Semester', options: SEMESTERS },
        ...(isAdmin ? [{ name: 'departmentId', label: 'Department', options: departments.map((d) => ({ value: d.departmentId, label: d.departmentName })) }] : []),
      ]}
      formFields={[
        { name: 'examName', label: 'Exam Name', required: true, requiredOnCreate: true, rules: RULES.examName, span: true },
        { name: 'examType', label: 'Exam Type', type: 'select', required: true, requiredOnCreate: true,
          options: ['internal', 'assignment', 'model', 'semester', 'practical'].map((t) => ({ value: t, label: t })) },
        { name: 'subjectCode', label: 'Subject Code', required: true, requiredOnCreate: true, rules: RULES.subjectCode },
        { name: 'semester', label: 'Semester', type: 'number', required: true, min: 1, max: 10, requiredOnCreate: true, rules: RULES.semester },
        { name: 'date', label: 'Date', type: 'date', required: true, requiredOnCreate: true, rules: RULES.date },
        { name: 'startTime', label: 'Start Time', required: true, requiredOnCreate: true, rules: RULES.startTime },
        { name: 'endTime', label: 'End Time', required: true, requiredOnCreate: true, rules: RULES.endTime },
        { name: 'room', label: 'Room', rules: RULES.room },
        ...(isAdmin ? [{
          name: 'departmentId', label: 'Department', type: 'select', required: true, requiredOnCreate: true, rules: RULES.departmentId,
          options: departments.map((d) => ({ value: d.departmentId, label: `${d.departmentCode} · ${d.departmentName}` })),
        }] : []),
      ]}
    />
  );
};

/* ------------------------------------------------------------------- users */

export const UsersPage = () => {
  const toast = useToast();
  const departments = useDepartmentOptions(true);
  const [params, setParams] = useState({ search: '', role: '', status: '', departmentId: '', page: 1, limit: 25 });
  const [state, setState] = useState({ loading: true, error: '', rows: [], pagination: null });
  const [editing, setEditing] = useState(null);
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const res = await usersApi.list(params);
      setState({ loading: false, error: '', rows: res.data || [], pagination: res.pagination || null });
    } catch (error) {
      setState({ loading: false, error: error.message, rows: [], pagination: null });
    }
  }, [params]);

  useEffect(() => { load(); }, [load]);

  const submit = async (event) => {
    event.preventDefault();
    const nextErrors = validate(values, {
      name: RULES.name,
      email: RULES.email,
      role: RULES.role,
      password: { label: 'Password', check: (v) => (String(v).length >= 8 ? true : 'Minimum 8 characters') },
      departmentId: { label: 'Department', check: (v) => (values.role === 'admin' ? true : (String(v || '').trim() ? true : 'Required for non-admin accounts')) },
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSaving(true);
    try {
      if (editing === 'new') {
        await usersApi.create({ ...values, departmentId: values.role === 'admin' ? undefined : values.departmentId });
        toast.success('User account created');
      } else {
        const payload = { name: values.name, email: values.email, status: values.status };
        if (values.password) payload.password = values.password;
        await usersApi.update(editing.userId, payload);
        toast.success('User account updated');
      }
      setEditing(null);
      load();
    } catch (error) {
      if (error.fieldErrors) setErrors(error.fieldErrors);
      toast.error('Could not save user', error.message);
    } finally {
      setSaving(false);
    }
  };

  const setParam = (key, value) => setParams((p) => ({ ...p, [key]: value, page: 1 }));

  return (
    <>
      <PageHeader
        title="User Management"
        subtitle="All accounts. Passwords are hashed and never displayed."
        actions={<button type="button" className="btn btn-primary" onClick={() => { setEditing('new'); setValues({ role: 'student', status: 'active' }); setErrors({}); }}><IconPlus size={16} />Add user</button>}
      />
      <Card>
        <CardHeader title="Accounts" actions={(
          <div className="filterbar">
            <div style={{ minWidth: 220 }}><SearchBar value={params.search} onChange={(v) => setParam('search', v)} placeholder="Search name or email" /></div>
            <SelectInput label="Role" value={params.role} onChange={(e) => setParam('role', e.target.value)} placeholder="All roles"
              options={['student', 'faculty', 'hod', 'admin'].map((r) => ({ value: r, label: r }))} />
            <SelectInput label="Status" value={params.status} onChange={(e) => setParam('status', e.target.value)} placeholder="All statuses"
              options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
            <SelectInput label="Department" value={params.departmentId} onChange={(e) => setParam('departmentId', e.target.value)} placeholder="All departments"
              options={departments.map((d) => ({ value: d.departmentId, label: d.departmentName }))} />
          </div>
        )} />
        <CardBody tight>
          {state.loading ? <LoadingState label="Loading users..." />
            : state.error ? <ErrorState message={state.error} onRetry={load} />
            : (
              <DataTable
                rows={state.rows}
                keyField="userId"
                emptyTitle="No user records available."
                columns={[
                  { key: 'name', header: 'Name', render: (r) => <span className="strong">{r.name}</span> },
                  { key: 'email', header: 'Email' },
                  { key: 'role', header: 'Role', render: (r) => <Badge tone="info">{r.role}</Badge> },
                  { key: 'departmentName', header: 'Department', render: (r) => r.departmentName || 'All departments' },
                  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                  { key: 'createdAt', header: 'Created', render: (r) => (r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—') },
                  {
                    key: '__actions',
                    header: 'Actions',
                    className: 'actions',
                    render: (r) => (
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button type="button" className="icon-btn" onClick={() => { setEditing(r); setValues({ name: r.name, email: r.email, role: r.role, departmentId: r.departmentId, status: r.status, password: '' }); setErrors({}); }} aria-label="Edit user"><IconEdit size={17} /></button>
                        <button type="button" className="icon-btn" onClick={() => setResetting(r)} aria-label="Reset password"><IconShield size={17} /></button>
                      </div>
                    ),
                  },
                ]}
              />
            )}
        </CardBody>
        <Pagination pagination={state.pagination} onPageChange={(page) => setParams((p) => ({ ...p, page }))} />
      </Card>

      <Modal
        open={editing !== null}
        title={editing === 'new' ? 'Add user account' : 'Edit user account'}
        onClose={() => setEditing(null)}
        footer={(
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
            <button type="submit" form="user-form" className="btn btn-primary" disabled={saving}>{saving ? <span className="spinner" /> : 'Save'}</button>
          </>
        )}
      >
        <form id="user-form" onSubmit={submit} noValidate>
          <div className="form-grid">
            <TextInput label="Name" required value={values.name || ''} onChange={(e) => setValues((p) => ({ ...p, name: e.target.value }))} error={errors.name} />
            <TextInput label="Email" type="email" required value={values.email || ''} onChange={(e) => setValues((p) => ({ ...p, email: e.target.value }))} error={errors.email} />
            <SelectInput label="Role" required value={values.role || ''} onChange={(e) => setValues((p) => ({ ...p, role: e.target.value }))} error={errors.role}
              options={['student', 'faculty', 'hod', 'admin'].map((r) => ({ value: r, label: r }))} disabled={editing !== 'new'} />
            {editing === 'new' && values.role !== 'admin' ? (
              <SelectInput label="Department" required value={values.departmentId || ''} onChange={(e) => setValues((p) => ({ ...p, departmentId: e.target.value }))} error={errors.departmentId}
                options={departments.map((d) => ({ value: d.departmentId, label: d.departmentName }))} />
            ) : null}
            <PasswordInput
              label={editing === 'new' ? 'Password' : 'New password'}
              required={editing === 'new'}
              value={values.password || ''}
              onChange={(e) => setValues((p) => ({ ...p, password: e.target.value }))}
              error={errors.password}
              hint={editing === 'new' ? 'Minimum 8 characters' : 'Leave blank to keep the current password'}
            />
            <SelectInput label="Status" value={values.status || 'active'} onChange={(e) => setValues((p) => ({ ...p, status: e.target.value }))}
              options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
          </div>
        </form>
      </Modal>

      <PasswordResetDialog
        user={resetting}
        onClose={() => setResetting(null)}
        onDone={() => { setResetting(null); load(); }}
      />
    </>
  );
};

const PasswordResetDialog = ({ user, onClose, onDone }) => {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setPassword(''); setError(''); }, [user]);

  const submit = async (event) => {
    event.preventDefault();
    if (password.length < 8) { setError('Minimum 8 characters'); return; }
    setSaving(true);
    try {
      await usersApi.update(user.userId, { password });
      toast.success('Password reset', `${user.email} can now sign in with the new password.`);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={Boolean(user)}
      title="Reset password"
      size="narrow"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form="reset-form" className="btn btn-primary" disabled={saving}>{saving ? <span className="spinner" /> : 'Reset password'}</button>
        </>
      )}
    >
      <form id="reset-form" onSubmit={submit} noValidate>
        <p className="muted mb-2">Set a new password for <strong>{user?.email}</strong>. Communicate it securely to the user.</p>
        <PasswordInput label="New password" required value={password} onChange={(e) => setPassword(e.target.value)} error={error} />
      </form>
    </Modal>
  );
};

export { isEmailRule };