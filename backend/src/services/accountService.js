/**
 * Keeps login accounts (Users sheet) in sync with the profile sheets
 * (Students / Faculty / HODs).
 *
 * The ERP has two linked record types per person:
 *   - the profile sheet (department roster, academic data)
 *   - the Users sheet (email + bcrypt hash used by /api/auth/login)
 *
 * Creating a profile without a Users row produces an account that can never sign
 * in, so profile writes always provision or update the matching account here.
 */
const appsScript = require('./appsScriptClient');
const dataService = require('./dataService');
const { hashPassword } = require('./crudFactory');

const ROLE_BY_RESOURCE = { Student: 'student', Faculty: 'faculty', HOD: 'hod' };

const sameEmail = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

const findAccount = (users, { role, email, profileId, idField }) =>
  users.find(
    (u) =>
      String(u.role || '').toLowerCase() === role &&
      (sameEmail(u.email, email) ||
        (profileId && idField && String(u[userIdKeyFor(role)] || '') === String(profileId || '')))
  );

/** Users rows keep a `userId`; mirror the profile primary key onto it. */
const userIdKeyFor = (role) => {
  if (role === 'student') return 'studentId';
  if (role === 'faculty') return 'facultyId';
  if (role === 'hod') return 'hodId';
  return 'userId';
};

const profileIdFieldFor = (role) => userIdKeyFor(role);

/**
 * Create or update the login account that belongs to a profile record.
 *
 * @param {object} options
 * @param {string} options.resource      'Student' | 'Faculty' | 'HOD'
 * @param {object} options.record        the profile record as stored
 * @param {string} [options.password]    plain password supplied by the operator
 * @param {string} [options.action]      'create' | 'update' | 'delete' | 'deactivate'
 * @param {object} [options.previous]    profile record before the change
 * @returns {Promise<object|null>} the account record, or null when nothing changed
 */
const syncProfileAccount = async ({ resource, record, password, action = 'update', previous }) => {
  const role = ROLE_BY_RESOURCE[resource];
  if (!role || !record) return null;

  const idField = profileIdFieldFor(role);
  const profileId = record[idField] || record.userId || '';
  const email = String(record.email || previous?.email || '').trim().toLowerCase();
  const users = await dataService.users();

  let account = findAccount(users, { role, email, profileId, idField });
  if (!account && previous) {
    account = findAccount(users, { role, email: previous.email, profileId: previous[idField], idField });
  }

  const departmentId = String(record.departmentId || '');
  const status = String(record.status || previous?.status || 'active').toLowerCase();
  const name = String(record.name || previous?.name || '').trim();

  // Removing or deactivating a profile must never leave a working login behind.
  if (action === 'delete' || action === 'deactivate' || status === 'inactive') {
    if (!account || String(account.status || 'active').toLowerCase() === 'inactive') return null;
    await appsScript.post('update_user', { id: String(account.userId), record: { status: 'inactive' } });
    return { ...account, status: 'inactive' };
  }

  if (!account) {
    // No account yet: create one so the person can actually sign in.
    if (!email) return null;
    const passwordHash = await hashPassword(password || 'ChangeMe@123');
    const created = await appsScript.post('create_user', {
      record: {
        name,
        email,
        role,
        departmentId,
        departmentName: record.departmentName || previous?.departmentName || '',
        status: 'active',
        [idField]: profileId,
      },
      passwordHash,
    });
    return created && created.data ? created.data : { name, email, role, departmentId, status: 'active' };
  }

  const patch = {};
  if (name && name !== account.name) patch.name = name;
  if (email && !sameEmail(email, account.email)) patch.email = email;
  if (departmentId && departmentId !== String(account.departmentId || '')) patch.departmentId = departmentId;
  if (String(account.status || 'active').toLowerCase() !== 'active') patch.status = 'active';
  if (password) patch.passwordHash = await hashPassword(password);
  if (!Object.keys(patch).length) return null;

  const result = await appsScript.post('update_user', { id: String(account.userId), record: patch });
  return result && result.data ? result.data : { ...account, ...patch };
};

module.exports = { syncProfileAccount, ROLE_BY_RESOURCE };