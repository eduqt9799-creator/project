const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

const Svg = ({ size = 18, children, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...rest}>
    {children}
  </svg>
);

export const IconDashboard = (p) => (
  <Svg {...p}><path {...stroke} d="M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z" /></Svg>
);
export const IconUsers = (p) => (
  <Svg {...p}><path {...stroke} d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19" /><circle {...stroke} cx="10" cy="8" r="3.2" /><path {...stroke} d="M20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 5.2a3.2 3.2 0 0 1 0 5.6" /></Svg>
);
export const IconUser = (p) => (
  <Svg {...p}><circle {...stroke} cx="12" cy="8" r="3.4" /><path {...stroke} d="M4.5 20a7.5 7.5 0 0 1 15 0" /></Svg>
);
export const IconAttendance = (p) => (
  <Svg {...p}><rect {...stroke} x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path {...stroke} d="M8 3v4M16 3v4M3.5 10h17" /><path {...stroke} d="M8.5 14.5l2 2 4-4" /></Svg>
);
export const IconBook = (p) => (
  <Svg {...p}><path {...stroke} d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2.5 2.5 0 0 1 2 2.5V20a2.5 2.5 0 0 0-2-1.5H4V5.5Z" /><path {...stroke} d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2.5 2.5 0 0 0-2 2.5V20a2.5 2.5 0 0 1 2-1.5h6V5.5Z" /></Svg>
);
export const IconBooks = (p) => (
  <Svg {...p}><path {...stroke} d="M4 19V6.5A1.5 1.5 0 0 1 5.5 5H9v14M11.5 5H14a1.5 1.5 0 0 1 1.5 1.5V19M6 19h13" /></Svg>
);
export const IconClipboard = (p) => (
  <Svg {...p}><rect {...stroke} x="5" y="4.5" width="14" height="16" rx="2.5" /><path {...stroke} d="M9 4.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4.5M9 10h6M9 14h4" /></Svg>
);
export const IconMarks = (p) => (
  <Svg {...p}><path {...stroke} d="M4 19.5V6a2 2 0 0 1 2-2h9l4 4v11.5a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 19.5Z" /><path {...stroke} d="M8.5 9.5h6M8.5 13.5h6M8.5 17h3" /></Svg>
);
export const IconCalendar = (p) => (
  <Svg {...p}><rect {...stroke} x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path {...stroke} d="M8 3v4M16 3v4M3.5 10h17" /></Svg>
);
export const IconExam = (p) => (
  <Svg {...p}><path {...stroke} d="M6 3.5h9l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V5a1.5 1.5 0 0 1 1-1.5Z" /><path {...stroke} d="M14.5 3.5V8H19M8.5 12.5h7M8.5 16h4" /></Svg>
);
export const IconMegaphone = (p) => (
  <Svg {...p}><path {...stroke} d="M4 10v4a1.5 1.5 0 0 0 1.5 1.5H8l7 4V5.5L8 9.5H5.5A1.5 1.5 0 0 0 4 11Z" /><path {...stroke} d="M18 9.5a3.5 3.5 0 0 1 0 5" /></Svg>
);
export const IconBell = (p) => (
  <Svg {...p}><path {...stroke} d="M18 15.5V10a6 6 0 1 0-12 0v5.5L4.5 18h15L18 15.5Z" /><path {...stroke} d="M10 21h4" /></Svg>
);
export const IconBuilding = (p) => (
  <Svg {...p}><path {...stroke} d="M4 20.5h16M5.5 20.5V5a1.5 1.5 0 0 1 1.5-1.5h6A1.5 1.5 0 0 1 14.5 5v15.5" /><path {...stroke} d="M14.5 10H18a1 1 0 0 1 1 1v9.5M8 8h3.5M8 12h3.5M8 16h3.5" /></Svg>
);
export const IconShield = (p) => (
  <Svg {...p}><path {...stroke} d="M12 3.5 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-2.5Z" /><path {...stroke} d="M9.2 12.2l2 2 3.6-3.8" /></Svg>
);
export const IconSettings = (p) => (
  <Svg {...p}><circle {...stroke} cx="12" cy="12" r="3" /><path {...stroke} d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.3a1.9 1.9 0 0 1-3.8 0v-.2a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H4a1.9 1.9 0 0 1 0-3.8h.2a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5V4a1.9 1.9 0 0 1 3.8 0v.2a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1h.3a1.9 1.9 0 0 1 0 3.8h-.2a1.6 1.6 0 0 0-1.5 1Z" /></Svg>
);
export const IconSearch = (p) => (
  <Svg {...p}><circle {...stroke} cx="10.5" cy="10.5" r="6.5" /><path {...stroke} d="m20 20-4.8-4.8" /></Svg>
);
export const IconFilter = (p) => (
  <Svg {...p}><path {...stroke} d="M4 6h16M7 12h10M10 18h4" /></Svg>
);
export const IconPlus = (p) => (
  <Svg {...p}><path {...stroke} d="M12 5v14M5 12h14" /></Svg>
);
export const IconEdit = (p) => (
  <Svg {...p}><path {...stroke} d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" /><path {...stroke} d="M14.5 6.5l3 3" /></Svg>
);
export const IconTrash = (p) => (
  <Svg {...p}><path {...stroke} d="M4.5 6.5h15M9.5 6.5V5A1.5 1.5 0 0 1 11 3.5h2A1.5 1.5 0 0 1 14.5 5v1.5M6.5 6.5 7.4 20a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-13.5" /><path {...stroke} d="M10.5 10.5v6.5M13.5 10.5v6.5" /></Svg>
);
export const IconCheck = (p) => (
  <Svg {...p}><path {...stroke} d="m5 12.5 4.5 4.5L19 7" /></Svg>
);
export const IconX = (p) => (
  <Svg {...p}><path {...stroke} d="M6 6l12 12M18 6 6 18" /></Svg>
);
export const IconEye = (p) => (
  <Svg {...p}><path {...stroke} d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle {...stroke} cx="12" cy="12" r="3" /></Svg>
);
export const IconEyeOff = (p) => (
  <Svg {...p}><path {...stroke} d="M4 4l16 16M9.9 5.9A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 4M6.4 8A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5a9.4 9.4 0 0 0 3.5-.65" /></Svg>
);
export const IconMenu = (p) => (
  <Svg {...p}><path {...stroke} d="M4 7h16M4 12h16M4 17h16" /></Svg>
);
export const IconLogout = (p) => (
  <Svg {...p}><path {...stroke} d="M15 17.5V19a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 4 19V5a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 15 5v1.5" /><path {...stroke} d="M10 12h10M17 8.5l3.5 3.5-3.5 3.5" /></Svg>
);
export const IconInbox = (p) => (
  <Svg {...p}><path {...stroke} d="M4 13.5 6 5.5A1.5 1.5 0 0 1 7.4 4.5h9.2A1.5 1.5 0 0 1 19 5.5l2 8" /><path {...stroke} d="M4 13.5h4l1.5 2.5h5l1.5-2.5h4v4A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-4Z" /></Svg>
);
export const IconAlert = (p) => (
  <Svg {...p}><path {...stroke} d="M12 4.5 2.8 20h18.4L12 4.5Z" /><path {...stroke} d="M12 10v4M12 17h.01" /></Svg>
);
export const IconInfo = (p) => (
  <Svg {...p}><circle {...stroke} cx="12" cy="12" r="8.5" /><path {...stroke} d="M12 11v5M12 8h.01" /></Svg>
);
export const IconDownload = (p) => (
  <Svg {...p}><path {...stroke} d="M12 4v10.5M8 11l4 4 4-4M5 19.5h14" /></Svg>
);
export const IconRefresh = (p) => (
  <Svg {...p}><path {...stroke} d="M20 11a8 8 0 1 0-.6 4" /><path {...stroke} d="M20 5v6h-6" /></Svg>
);
export const IconChevronLeft = (p) => (<Svg {...p}><path {...stroke} d="m14.5 6-6 6 6 6" /></Svg>);
export const IconChevronRight = (p) => (<Svg {...p}><path {...stroke} d="m9.5 6 6 6-6 6" /></Svg>);
export const IconClock = (p) => (
  <Svg {...p}><circle {...stroke} cx="12" cy="12" r="8.5" /><path {...stroke} d="M12 7.5V12l3 2" /></Svg>
);
export const IconLogout2 = IconLogout;