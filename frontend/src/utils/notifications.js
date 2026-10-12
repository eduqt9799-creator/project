/* Maps a notification to the portal page that shows its actual content.
 *
 * Notifications broadcast by the bridge only carry a `type` ("material",
 * "assignment", "announcement", "attendance", ...). The content lives in its
 * own module, so clicking a notification opens the matching page instead of a
 * dead-end text line. Images a `link`/`entityId` fall out of an Apps Script
 * redeploy, the module page is still the correct destination.
 */
export const notificationRoute = (role, notification) => {
  const area = ['admin', 'hod', 'faculty', 'student'].includes(String(role)) ? role : 'student';
  switch (String((notification && notification.type) || '').toLowerCase()) {
    case 'material':
      return `/${area}/materials`;
    case 'assignment':
      return `/${area}/assignments`;
    case 'announcement':
      return `/${area}/announcements`;
    case 'attendance':
      return area === 'faculty' ? '/faculty/attendance' : `/${area}/attendance`;
    case 'marks':
    case 'result':
      return `/${area}/marks`;
    case 'exam':
      return `/${area}/exams`;
    case 'timetable':
      return `/${area}/timetable`;
    default:
      return null;
  }
};