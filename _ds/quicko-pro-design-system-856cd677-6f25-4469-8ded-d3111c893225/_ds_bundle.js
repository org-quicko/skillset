/* @ds-bundle: {"format":3,"namespace":"QuickoProDesignSystem_856cd6","components":[],"sourceHashes":{"ui_kits/quicko-pro/ContactsPage.jsx":"a82dccd763ce","ui_kits/quicko-pro/DrivePage.jsx":"32f5e8a5c6a9","ui_kits/quicko-pro/EarningsPage.jsx":"fbf54628dd4e","ui_kits/quicko-pro/HomePage.jsx":"6a57c4cf018a","ui_kits/quicko-pro/NavRail.jsx":"40c7f17878e1","ui_kits/quicko-pro/OrdersPage.jsx":"f9828ae0e590","ui_kits/quicko-pro/PageHeader.jsx":"db6830336a3f","ui_kits/quicko-pro/Primitives.jsx":"83d03875f817","ui_kits/quicko-pro/RightPane.jsx":"70e23aac0f8e","ui_kits/quicko-pro/SecondaryNav.jsx":"a40f21eab8b1","ui_kits/quicko-pro/Shell.jsx":"c7ee85f82d22","ui_kits/quicko-pro/TopNav.jsx":"8b0a57bbb648"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.QuickoProDesignSystem_856cd6 = window.QuickoProDesignSystem_856cd6 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// ui_kits/quicko-pro/ContactsPage.jsx
try { (() => {
// ContactsPage.jsx — the People feature: client directory.

const CONTACTS = [{
  name: 'Aarav Mehta',
  pan: 'AAAPM1234K',
  type: 'Individual',
  orders: 3,
  last: '2 days ago',
  verified: true
}, {
  name: 'Kunal Desai',
  pan: 'BQXPD5821F',
  type: 'Individual',
  orders: 2,
  last: '5 hr ago',
  verified: true
}, {
  name: 'Priya Patel',
  pan: 'CZKPP9104L',
  type: 'Individual',
  orders: 4,
  last: '12 min ago',
  verified: true
}, {
  name: 'Nisha Kapoor',
  pan: 'DKLPK7788M',
  type: 'Individual',
  orders: 1,
  last: 'Yesterday',
  verified: false
}, {
  name: 'Raj Sharma',
  pan: 'AAACR1122B',
  type: 'Company',
  orders: 6,
  last: '3 hr ago',
  verified: true
}, {
  name: 'Meera Iyer',
  pan: 'EXZPI3344N',
  type: 'Individual',
  orders: 2,
  last: '1 week ago',
  verified: true
}, {
  name: 'Vikram Rao',
  pan: 'AAACV5566Q',
  type: 'Company',
  orders: 8,
  last: '18 min ago',
  verified: true
}];
function ContactsPage() {
  const [tab, setTab] = React.useState('all');
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 24
    }
  }, /*#__PURE__*/React.createElement(PageHeader, {
    title: "Contacts",
    subtitle: "84 clients \xB7 6 added this month \xB7 3 unverified",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "outlined",
      icon: "upload"
    }, "Import CSV"), /*#__PURE__*/React.createElement(Button, {
      variant: "filled",
      icon: "person_add"
    }, "Add contact"))
  }), /*#__PURE__*/React.createElement(Tabs, {
    value: tab,
    onChange: setTab,
    tabs: [{
      id: 'all',
      label: 'All',
      count: 84
    }, {
      id: 'individual',
      label: 'Individuals',
      count: 62
    }, {
      id: 'company',
      label: 'Companies',
      count: 22
    }, {
      id: 'unverified',
      label: 'Unverified',
      count: 3
    }]
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(TextField, {
    placeholder: "Search by name or PAN\u2026",
    icon: "search",
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(Chip, {
    label: "Sort: recent",
    leading: "sort"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      border: '1px solid var(--qp-divider)',
      borderRadius: 16,
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'minmax(240px, 1.6fr) 160px 140px 120px 60px',
      gap: 16,
      padding: '12px 20px',
      borderBottom: '1px solid var(--qp-divider)',
      font: '500 11px/1 var(--qp-font-sans)',
      color: 'var(--qp-fg-3)',
      letterSpacing: '.06em',
      textTransform: 'uppercase',
      background: 'var(--qp-surface-container-low)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Name"), /*#__PURE__*/React.createElement("span", null, "PAN"), /*#__PURE__*/React.createElement("span", null, "Type"), /*#__PURE__*/React.createElement("span", null, "Orders"), /*#__PURE__*/React.createElement("span", null)), CONTACTS.map((c, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'grid',
      gridTemplateColumns: 'minmax(240px, 1.6fr) 160px 140px 120px 60px',
      gap: 16,
      padding: '14px 20px',
      alignItems: 'center',
      borderBottom: i === CONTACTS.length - 1 ? 0 : '1px solid var(--qp-divider)',
      cursor: 'pointer'
    },
    onMouseEnter: e => e.currentTarget.style.background = 'var(--qp-surface-container-low)',
    onMouseLeave: e => e.currentTarget.style.background = 'transparent'
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: c.name.split(' ').map(w => w[0]).join(''),
    size: 40,
    verified: c.verified
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '600 14px/1.2 var(--qp-font-sans)',
      color: 'var(--qp-fg-1)'
    }
  }, c.name), /*#__PURE__*/React.createElement("div", {
    style: {
      font: '500 12px/1.3 var(--qp-font-sans)',
      color: 'var(--qp-fg-3)'
    }
  }, "Last activity \xB7 ", c.last))), /*#__PURE__*/React.createElement("div", {
    style: {
      font: '500 13px/1 var(--qp-font-sans)',
      color: 'var(--qp-fg-2)',
      fontFamily: 'var(--qp-font-mono)',
      letterSpacing: '.02em'
    }
  }, c.pan), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Badge, {
    tone: c.type === 'Company' ? 'primary' : 'neutral'
  }, c.type)), /*#__PURE__*/React.createElement("div", {
    style: {
      font: '500 13px/1 var(--qp-font-sans)',
      color: 'var(--qp-fg-2)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, c.orders), /*#__PURE__*/React.createElement(IconButton, {
    icon: "more_vert",
    ariaLabel: "More"
  })))));
}
window.ContactsPage = ContactsPage;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/quicko-pro/ContactsPage.jsx", error: String((e && e.message) || e) }); }

// ui_kits/quicko-pro/DrivePage.jsx
try { (() => {
// DrivePage.jsx — My Drive, personal file library.
//
// PRINCIPLES (from workspace-app-design skill / references/lists.md):
//
// WHY contained cards (not flat rows):
//   Files are independent entities — no two files share a relationship simply by
//   being in the same folder. A PDF and a spreadsheet uploaded by different people
//   are not contextually related. Cards communicate independence correctly.
//
// WHY no lifecycle filter toolbar (All/Open/Closed):
//   Drive has no lifecycle. Files don't progress through states — they exist or they don't.
//   The toolbar reflects what IS meaningful: file filters and sort, nothing else.
//   Adding lifecycle buttons where there's no lifecycle would be semantic noise.
//
// WHY colored file type icon containers (not bare Material icons):
//   The file type container serves as the visual identity of the file — equivalent to
//   a person's avatar. The colour carries immediate type recognition:
//   PDF=red, spreadsheet=green, image=blue, generic=slate.
//   A bare icon without container context loses this identity function.
//
// WHY no status chips:
//   Files have no workflow lifecycle. Adding status would invent meaning that doesn't exist.
//   The visible information (name, date, creator, size) is everything needed to act.
//
// WHY creator + size columns:
//   Principle — "show only what the viewer needs to act." For files, the viewer needs:
//   1. What is it? (name + type icon)
//   2. Who made it / owns it? (creator)
//   3. How big is it? (size — storage management)
//   Date is secondary context (upload/created date below file name).

const DRIVE_FILES = [{
  name: 'ITR Forms_Shrey Kumar',
  ext: 'pdf',
  date: 'Created on 15th Jun, 2025',
  creator: 'Aarav Sharma',
  creatorRole: 'Creator',
  size: '816 KB'
}, {
  name: 'Aadhar Card_Ashish...',
  ext: 'image',
  date: 'Uploaded on 15th Jun, 2025',
  creator: 'Anjali Verma',
  creatorRole: 'Creator',
  size: '816 KB'
}, {
  name: 'Tax Computation_Rahul.xlsx',
  ext: 'xlsx',
  date: 'Uploaded on 11th Jun, 2025',
  creator: 'Anjali Verma',
  creatorRole: 'Creator',
  size: '816 KB'
}, {
  name: 'PAN Card_Ashish...',
  ext: 'image',
  date: 'Uploaded on 11th Jun, 2025',
  creator: 'Anjali Verma',
  creatorRole: 'Creator',
  size: '816 KB'
}, {
  name: 'Form16_Ashish...',
  ext: 'pdf',
  date: 'Uploaded on 11th Jun, 2025',
  creator: 'Anjali Verma',
  creatorRole: 'Creator',
  size: '816 KB'
}, {
  name: 'Form16_Ashish...',
  ext: 'pdf',
  date: 'Uploaded on 11th Jun, 2025',
  creator: 'Anjali Verma',
  creatorRole: 'Creator',
  size: '816 KB'
}];

// File type icon config — colored container with white icon inside
// WHY these specific colours: established file type conventions that users recognise
// universally. Deviating would introduce cognitive friction.
const FILE_TYPE_CONFIG = {
  pdf: {
    icon: 'picture_as_pdf',
    bg: '#E53935',
    fg: '#fff'
  },
  xlsx: {
    icon: 'table_chart',
    bg: '#2E7D32',
    fg: '#fff'
  },
  image: {
    icon: 'image',
    bg: '#F57C00',
    fg: '#fff'
  },
  doc: {
    icon: 'description',
    bg: '#1565C0',
    fg: '#fff'
  },
  zip: {
    icon: 'folder_zip',
    bg: '#6A1B9A',
    fg: '#fff'
  },
  json: {
    icon: 'code',
    bg: '#37474F',
    fg: '#fff'
  },
  other: {
    icon: 'insert_drive_file',
    bg: 'var(--qp-surface-container-high)',
    fg: 'var(--qp-on-surface)'
  }
};
function DrivePage() {
  const [sortOpen, setSortOpen] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 24
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    style: {
      font: '500 22px/28px var(--qp-font-sans)',
      color: 'var(--qp-on-surface)',
      margin: '0 0 8px'
    }
  }, "My Drive.", ' ', /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--qp-outline)'
    }
  }, "Your personal library.")), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--qp-t-body-medium)',
      color: 'var(--qp-on-surface-variant)',
      margin: 0
    }
  }, "Store, organise, and access all your files in one place.")), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 200,
      height: 80,
      flexShrink: 0,
      marginLeft: 16,
      background: 'var(--qp-surface-container)',
      borderRadius: 8,
      opacity: .6,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 36,
      color: 'var(--qp-primary)'
    }
  }, "folder_open"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("button", {
    style: {
      all: 'unset',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 32,
      padding: '0 16px 0 8px',
      borderRadius: 9999,
      border: '1px solid var(--qp-outline-variant)',
      font: 'var(--qp-t-label-large)',
      color: 'var(--qp-primary)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 20,
      fontVariationSettings: "'wght' 300"
    }
  }, "filter_list"), "Filters"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("button", {
    style: {
      all: 'unset',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '9px 16px',
      borderRadius: 8,
      border: '1px solid var(--qp-outline-variant)',
      font: 'var(--qp-t-title-small)',
      color: 'var(--qp-on-surface)'
    }
  }, "Name", /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 20,
      fontVariationSettings: "'wght' 300"
    }
  }, "arrow_downward_alt")), /*#__PURE__*/React.createElement("button", {
    style: {
      all: 'unset',
      cursor: 'pointer',
      width: 40,
      height: 40,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
      border: '1px solid var(--qp-outline-variant)',
      color: 'var(--qp-on-surface-variant)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 20,
      fontVariationSettings: "'wght' 300"
    }
  }, "grid_view"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, DRIVE_FILES.map((file, i) => /*#__PURE__*/React.createElement(DriveFileCard, {
    key: i,
    file: file
  }))));
}

// Drive file card — contained card
// Column layout (fixed widths per lists.md principle):
//   [40px icon container] [file name + date — flex fill] [creator — 160px] [size — 80px] [menu — 40px]
//
// WHY these column widths: sized to realistic data, not available space.
// File names can be long — they get the flex fill and truncate.
// Creator names are typically "First Last" — 160px covers this.
// File sizes are short numeric strings — 80px is generous.
function DriveFileCard({
  file
}) {
  const [hover, setHover] = React.useState(false);
  const ftConfig = FILE_TYPE_CONFIG[file.ext] || FILE_TYPE_CONFIG.other;
  const creatorInitials = file.creator.split(' ').map(w => w[0]).join('').slice(0, 2);
  return /*#__PURE__*/React.createElement("div", {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      padding: '12px 16px',
      background: hover ? 'var(--qp-surface-container-low)' : 'var(--qp-surface-container-lowest)',
      border: '1px solid var(--qp-outline-variant)',
      borderRadius: 8,
      cursor: 'pointer',
      transition: 'background 150ms var(--qp-ease-standard)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 40,
      height: 40,
      borderRadius: 8,
      flexShrink: 0,
      background: ftConfig.bg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 20,
      color: ftConfig.fg,
      fontVariationSettings: "'wght' 300, 'FILL' 1, 'GRAD' 0, 'opsz' 20"
    }
  }, ftConfig.icon)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--qp-t-body-large)',
      color: 'var(--qp-on-surface)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, file.name), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--qp-t-body-small)',
      color: 'var(--qp-on-surface-variant)',
      marginTop: 2
    }
  }, file.date)), /*#__PURE__*/React.createElement("div", {
    style: {
      flexShrink: 0,
      width: 160,
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: creatorInitials,
    size: 24
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--qp-t-body-medium)',
      color: 'var(--qp-on-surface)'
    }
  }, file.creator), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--qp-t-body-small)',
      color: 'var(--qp-on-surface-variant)'
    }
  }, file.creatorRole))), /*#__PURE__*/React.createElement("div", {
    style: {
      flexShrink: 0,
      width: 80
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--qp-t-body-medium)',
      color: 'var(--qp-on-surface)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, file.size), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--qp-t-body-small)',
      color: 'var(--qp-on-surface-variant)'
    }
  }, "Size")), /*#__PURE__*/React.createElement("button", {
    style: {
      all: 'unset',
      cursor: 'pointer',
      width: 40,
      height: 40,
      borderRadius: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--qp-on-surface-variant)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 20,
      fontVariationSettings: "'wght' 300"
    }
  }, "more_vert")));
}
window.DrivePage = DrivePage;
window.DriveFileCard = DriveFileCard;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/quicko-pro/DrivePage.jsx", error: String((e && e.message) || e) }); }

// ui_kits/quicko-pro/EarningsPage.jsx
try { (() => {
// EarningsPage.jsx — Earnings feature under Insights.
//
// PRINCIPLES (from workspace-app-design skill / references/lists.md):
//
// WHY Feature with Tabs header (not Feature with CTA):
//   No secondary nav for Earnings — content splits into Overview and Transactions.
//   Tabs are the right pattern because Overview and Transactions are genuinely different
//   content types for the same feature, not sub-sections filterable from the same data.
//
// WHY flat divider rows for Transactions (not contained cards):
//   Transactions form a financial sequence — a refund belongs to a payment, settlements
//   relate to the same period. Items share temporal and financial context.
//   Flat rows visually communicate this continuity. Cards would imply independence that
//   does not exist between related financial entries.
//
// WHY section headers with aggregates:
//   Transactions are grouped by month. Each month header shows the net total — this is
//   the most actionable summary for a financial audience scanning periods.
//   The aggregate is right-aligned, green for positive net (colour communicates outcome).
//
// WHY transaction type chips classify type not lifecycle:
//   Payments, Refunds, Settlements are not lifecycle stages — they are transaction types.
//   The skill principle: "labels adapt their meaning to the entity type."
//   Using Active/Success/Warning here would be semantically wrong.
//   Type classification uses distinct colours (blue=payment, amber=refund, purple=settlement).
//
// WHY "All · Payments · Refunds · Settlements" instead of "All · Open · Closed":
//   The "All/Open/Closed" rule applies to lifecycle entities (orders, leads).
//   Transactions have no lifecycle — they are immutable records once created.
//   The toolbar reflects what is meaningful: type classification, not status.

const TRANSACTION_GROUPS = [{
  month: 'August 2024',
  aggregate: '+₹4,849',
  positiveAggregate: true,
  rows: [{
    customer: 'Arjun Patil',
    title: 'GST Registration for E-commerce Sellers',
    id: 'CDD12345678',
    time: '12:00 PM, 12th Jan 2025',
    type: 'payment',
    amount: '+₹12,500'
  }, {
    customer: 'Deepika Dutta',
    title: 'ITR For Salaried Individuals',
    id: 'CDD12345678',
    time: '12:00 PM, 12th Jan 2025',
    type: 'refund',
    amount: '+₹4,250'
  }, {
    customer: 'Deepika Dutta',
    title: 'ITR For Salaried Individuals',
    id: 'CDD12345678',
    time: '12:00 PM, 12th Jan 2025',
    type: 'payment',
    amount: '+₹4,250'
  }, {
    customer: 'Prakash Verma',
    title: 'ITR for Capital Gains from Investments',
    id: 'CDD12345678',
    time: '12:00 PM, 12th Jan 2025',
    type: 'settlement',
    amount: '-₹3,179'
  }, {
    customer: 'Sneha Bansal',
    title: 'Consultation for Tax Notice',
    id: 'CDD12345678',
    time: '12:00 PM, 12th Jan 2025',
    type: 'payment',
    amount: '+₹4,250'
  }]
}, {
  month: 'July 2024',
  aggregate: '+₹8,200',
  positiveAggregate: true,
  rows: [{
    customer: 'Arjun Patil',
    title: 'ITR-3 Filing AY 2024-25',
    id: 'CDD12345679',
    time: '10:00 AM, 28th Jul 2024',
    type: 'payment',
    amount: '+₹5,500'
  }, {
    customer: 'Meera Iyer',
    title: 'GSTR-1 Monthly Return',
    id: 'CDD12345680',
    time: '2:00 PM, 15th Jul 2024',
    type: 'settlement',
    amount: '+₹2,700'
  }]
}];

// Transaction type chip config
// WHY these colours:
//   Payment = Active (blue) — money coming in, action has happened, requires acknowledgement
//   Refund   = Warning (amber) — money going out, warrants attention
//   Settlement = a distinct purple (tertiary) — bank settlement, operationally different
const TX_TYPE_CONFIG = {
  payment: {
    label: 'Payment',
    icon: 'payments',
    bg: 'var(--qp-primary-container)',
    fg: 'var(--qp-secondary)'
  },
  refund: {
    label: 'Refund',
    icon: 'replay',
    bg: 'var(--qp-warning-container)',
    fg: 'var(--qp-on-warning-container)'
  },
  settlement: {
    label: 'Settlement',
    icon: 'account_balance',
    bg: 'var(--qp-tertiary-container)',
    fg: 'var(--qp-on-tertiary-container)'
  }
};
function EarningsPage() {
  const [tab, setTab] = React.useState('overview');
  const [txFilter, setTxFilter] = React.useState('all');
  const [selectedTx, setSelectedTx] = React.useState(null);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      font: '500 22px/28px var(--qp-font-sans)',
      color: 'var(--qp-on-surface)',
      margin: '0 0 12px'
    }
  }, "Earnings.", ' ', /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--qp-outline)'
    }
  }, "See your growth unfold.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      borderBottom: '2px solid var(--qp-outline-variant)',
      marginBottom: 0
    }
  }, [{
    id: 'overview',
    label: 'Overview'
  }, {
    id: 'transactions',
    label: 'Transactions'
  }].map(t => /*#__PURE__*/React.createElement("button", {
    key: t.id,
    onClick: () => setTab(t.id),
    style: {
      all: 'unset',
      cursor: 'pointer',
      padding: '0 4px 12px',
      marginRight: 24,
      font: 'var(--qp-t-title-small)',
      color: tab === t.id ? 'var(--qp-primary)' : 'var(--qp-on-surface-variant)',
      borderBottom: tab === t.id ? '2px solid var(--qp-primary)' : '2px solid transparent',
      marginBottom: -2,
      transition: 'color 150ms'
    }
  }, t.label))), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--qp-t-body-medium)',
      color: 'var(--qp-on-surface-variant)',
      margin: '12px 0 0'
    }
  }, tab === 'overview' ? 'Get a snapshot of your earnings trends and performance' : 'View all payments, refunds, and settlements')), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 200,
      height: 80,
      flexShrink: 0,
      marginLeft: 16,
      background: 'var(--qp-surface-container)',
      borderRadius: 8,
      opacity: .6,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 36,
      color: 'var(--qp-primary)'
    }
  }, "payments"))), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 24
    }
  }), tab === 'overview' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(StatTile, {
    icon: "payments",
    label: "Balance as of today",
    value: "\u20B916,675",
    sub: ".32%"
  }), /*#__PURE__*/React.createElement(StatTile, {
    icon: "trending_up",
    label: "Revenue this month",
    value: "\u20B94,82,500",
    sub: "+18% MoM"
  }), /*#__PURE__*/React.createElement(StatTile, {
    icon: "check_circle",
    label: "Collected",
    value: "\u20B93,64,200",
    sub: "76% of revenue"
  }), /*#__PURE__*/React.createElement(StatTile, {
    icon: "pending",
    label: "Outstanding",
    value: "\u20B91,18,300",
    sub: "3 overdue"
  }))), tab === 'transactions' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      height: 44,
      padding: '0 16px',
      border: '1px solid var(--qp-outline-variant)',
      borderRadius: 9999,
      background: 'var(--qp-surface-container-lowest)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 20,
      color: 'var(--qp-on-surface-variant)',
      fontVariationSettings: "'wght' 300"
    }
  }, "search"), /*#__PURE__*/React.createElement("input", {
    placeholder: "Search by order or payment link ID",
    style: {
      flex: 1,
      border: 0,
      background: 'transparent',
      outline: 'none',
      font: 'var(--qp-t-body-medium)',
      color: 'var(--qp-on-surface)'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      flexWrap: 'wrap'
    }
  }, [{
    id: 'all',
    label: 'All'
  }, {
    id: 'payment',
    label: 'Payments'
  }, {
    id: 'refund',
    label: 'Refunds'
  }, {
    id: 'settlement',
    label: 'Settlements'
  }].map(f => /*#__PURE__*/React.createElement(RoundedFilterButton, {
    key: f.id,
    label: f.label,
    selected: txFilter === f.id,
    onClick: () => setTxFilter(f.id)
  })), /*#__PURE__*/React.createElement("button", {
    style: {
      all: 'unset',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 32,
      padding: '0 16px 0 8px',
      borderRadius: 9999,
      border: '1px solid var(--qp-outline-variant)',
      font: 'var(--qp-t-label-large)',
      color: 'var(--qp-primary)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 20,
      fontVariationSettings: "'wght' 300"
    }
  }, "filter_list"), "Filters")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column'
    }
  }, TRANSACTION_GROUPS.map((group, gi) => {
    const rows = txFilter === 'all' ? group.rows : group.rows.filter(r => r.type === txFilter);
    if (!rows.length) return null;
    return /*#__PURE__*/React.createElement("div", {
      key: gi
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        height: 40,
        padding: '0 0 0 0',
        font: 'var(--qp-t-title-small)',
        color: 'var(--qp-on-surface)'
      }
    }, /*#__PURE__*/React.createElement("span", null, group.month), /*#__PURE__*/React.createElement("span", {
      style: {
        color: group.positiveAggregate ? 'var(--qp-green)' : 'var(--qp-error)'
      }
    }, group.aggregate)), /*#__PURE__*/React.createElement("div", {
      style: {
        height: 1,
        background: 'var(--qp-outline-variant)'
      }
    }), rows.map((row, ri) => /*#__PURE__*/React.createElement(TransactionRow, {
      key: ri,
      row: row,
      isLast: ri === rows.length - 1,
      selected: selectedTx === `${gi}-${ri}`,
      onClick: () => setSelectedTx(prev => prev === `${gi}-${ri}` ? null : `${gi}-${ri}`)
    })));
  }))));
}

// Transaction row — flat divider row
// Anatomy (matches screenshot exactly):
//   [20px avatar] Customer name
//   Order title              [Type chip]        +₹amount
//   📄 #ID  📅 date
//
// WHY no card border: rows share temporal/financial context — visual continuity is the message.
// The divider line is the only separator — it signals "same list" not "separate entities".
function TransactionRow({
  row,
  isLast,
  selected,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  const type = TX_TYPE_CONFIG[row.type] || TX_TYPE_CONFIG.payment;
  const initials = row.customer.split(' ').map(w => w[0]).join('').slice(0, 2);
  const isPositive = row.amount.startsWith('+');
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      padding: '16px 0',
      borderBottom: isLast ? 'none' : '1px solid var(--qp-outline-variant)',
      background: selected ? 'var(--qp-secondary-container)' : hover ? 'var(--qp-surface-container-low)' : 'transparent',
      cursor: 'pointer',
      transition: 'background 150ms var(--qp-ease-standard)',
      borderRadius: selected ? 8 : 0,
      paddingLeft: selected ? 12 : 0,
      paddingRight: selected ? 12 : 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 3
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: initials,
    size: 20
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--qp-t-label-small)',
      color: selected ? 'var(--qp-on-secondary-container)' : 'var(--qp-on-surface-variant)'
    }
  }, row.customer)), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--qp-t-body-large)',
      color: selected ? 'var(--qp-on-secondary-container)' : 'var(--qp-on-surface)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, row.title), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      font: 'var(--qp-t-body-small)',
      color: selected ? 'var(--qp-on-secondary-container)' : 'var(--qp-on-surface-variant)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 14,
      fontVariationSettings: "'wght' 300"
    }
  }, "description"), "#", row.id), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 14,
      fontVariationSettings: "'wght' 300"
    }
  }, "calendar_today"), row.time))), /*#__PURE__*/React.createElement("div", {
    style: {
      flexShrink: 0,
      width: 120
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 10px 4px 8px',
      borderRadius: 9999,
      background: type.bg,
      color: type.fg,
      font: 'var(--qp-t-label-medium)',
      whiteSpace: 'nowrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 14,
      fontVariationSettings: "'wght' 300"
    }
  }, type.icon), type.label)), /*#__PURE__*/React.createElement("div", {
    style: {
      flexShrink: 0,
      width: 100,
      textAlign: 'right',
      font: 'var(--qp-t-body-large)',
      color: selected ? 'var(--qp-on-secondary-container)' : isPositive ? 'var(--qp-green)' : 'var(--qp-error)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, row.amount));
}

// Stat tile — for Overview tab
// 1px Outline Variant stroke, 8dp corners, no fill elevation (stroke defines tile)
// WHY no fill: tile sits on Surface Container Lowest — a lighter fill would imply
// z-elevation that doesn't exist. The stroke is the container, not the fill.
function StatTile({
  icon,
  label,
  value,
  sub
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      border: '1px solid var(--qp-outline-variant)',
      borderRadius: 8,
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      background: 'var(--qp-surface-container-lowest)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--qp-t-label-medium)',
      color: 'var(--qp-on-surface-variant)'
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 20,
      color: 'var(--qp-primary)',
      fontVariationSettings: "'wght' 300, 'FILL' 0"
    }
  }, icon)), /*#__PURE__*/React.createElement("div", {
    style: {
      font: '500 24px/1.2 var(--qp-font-sans)',
      color: 'var(--qp-on-surface)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, value), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--qp-t-body-small)',
      color: 'var(--qp-on-surface-variant)'
    }
  }, sub));
}
window.EarningsPage = EarningsPage;
window.TransactionRow = TransactionRow;
window.StatTile = StatTile;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/quicko-pro/EarningsPage.jsx", error: String((e && e.message) || e) }); }

// ui_kits/quicko-pro/HomePage.jsx
try { (() => {
// HomePage.jsx — primary landing for the advisor. Uses the central pane +
// right-side Glance pane for alerts and upcoming items.

function HomePage({
  setRoute
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 24,
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 28
    }
  }, /*#__PURE__*/React.createElement(PageHeader, {
    title: "Good morning, Raj",
    subtitle: "Tuesday, 22 April \xB7 6 filings due this week, 4 meetings today.",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "outlined",
      icon: "upload"
    }, "Import"), /*#__PURE__*/React.createElement(Button, {
      variant: "filled",
      icon: "add"
    }, "New order"))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Kpi, {
    label: "Active orders",
    value: "23",
    trend: "+4 this week"
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Filings due",
    value: "6",
    trend: "2 today"
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Revenue (MTD)",
    value: "\u20B94.8L",
    trend: "+18% MoM"
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Awaiting client",
    value: "9",
    trend: "follow up"
  })), /*#__PURE__*/React.createElement("section", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.4fr 1fr',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, {
    padding: 0
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '18px 20px 12px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '600 16px/1.3 var(--qp-font-sans)'
    }
  }, "Today's schedule"), /*#__PURE__*/React.createElement("button", {
    style: {
      all: 'unset',
      cursor: 'pointer',
      font: '500 13px/1 var(--qp-font-sans)',
      color: 'var(--qp-primary)'
    }
  }, "Open calendar")), [{
    t: '09:30',
    title: 'Aarav Mehta · Quarterly sync',
    mode: 'Meet · 30m'
  }, {
    t: '11:00',
    title: 'Kunal Desai · Discovery call',
    mode: 'Meet · 45m'
  }, {
    t: '13:00',
    title: 'Priya Patel · GST review',
    mode: 'Office · 60m'
  }, {
    t: '16:00',
    title: 'Team standup',
    mode: 'Internal · 20m'
  }].map((e, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      gap: 16,
      padding: '12px 20px',
      borderTop: '1px solid var(--qp-divider)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 48,
      font: '600 13px/1.2 var(--qp-font-sans)',
      color: 'var(--qp-fg-1)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, e.t), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '500 14px/1.3 var(--qp-font-sans)',
      color: 'var(--qp-fg-1)'
    }
  }, e.title), /*#__PURE__*/React.createElement("div", {
    style: {
      font: '500 12px/1.3 var(--qp-font-sans)',
      color: 'var(--qp-fg-3)',
      marginTop: 2
    }
  }, e.mode)), /*#__PURE__*/React.createElement(IconButton, {
    icon: "videocam",
    ariaLabel: "Join"
  })))), /*#__PURE__*/React.createElement(Card, {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '600 16px/1.3 var(--qp-font-sans)',
      marginBottom: 4
    }
  }, "Quick actions"), [{
    icon: 'auto_awesome',
    title: 'Draft with Ask AI',
    meta: 'Summarize a client\'s filing in seconds'
  }, {
    icon: 'receipt_long',
    title: 'Create an order',
    meta: 'For a new ITR, GST return, or MCA filing'
  }, {
    icon: 'upload',
    title: 'Upload documents',
    meta: 'Drop client files into Drive'
  }, {
    icon: 'mail',
    title: 'Send reminder',
    meta: 'Nudge a client for missing docs'
  }].map((a, i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    style: {
      all: 'unset',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 12px',
      borderRadius: 12
    },
    onMouseEnter: e => e.currentTarget.style.background = 'var(--qp-surface-container-low)',
    onMouseLeave: e => e.currentTarget.style.background = 'transparent'
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 36,
      height: 36,
      borderRadius: 10,
      background: 'var(--qp-primary-container)',
      color: 'var(--qp-on-primary-container)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 20
    }
  }, a.icon)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '500 14px/1.3 var(--qp-font-sans)'
    }
  }, a.title), /*#__PURE__*/React.createElement("div", {
    style: {
      font: '500 12px/1.3 var(--qp-font-sans)',
      color: 'var(--qp-fg-3)',
      marginTop: 2
    }
  }, a.meta)), /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 18,
      color: 'var(--qp-fg-3)'
    }
  }, "chevron_right"))))), /*#__PURE__*/React.createElement("section", null, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '600 16px/1.3 var(--qp-font-sans)',
      marginBottom: 12
    }
  }, "Recent activity"), /*#__PURE__*/React.createElement(Card, {
    padding: 0
  }, [{
    who: 'Priya Patel',
    did: 'uploaded',
    what: 'Form 16 · FY 24-25',
    when: '12 min ago',
    icon: 'upload_file'
  }, {
    who: 'Kunal Desai',
    did: 'paid',
    what: 'Invoice #2026-041',
    when: '1 hr ago',
    icon: 'payments'
  }, {
    who: 'You',
    did: 'filed',
    what: 'GSTR-3B — Mar 2026',
    when: '3 hr ago',
    icon: 'assignment_turned_in'
  }, {
    who: 'Nisha Kapoor',
    did: 'signed',
    what: 'Engagement letter',
    when: 'Yesterday',
    icon: 'edit_note'
  }].map((a, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      padding: '14px 20px',
      borderTop: i ? '1px solid var(--qp-divider)' : 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 32,
      height: 32,
      borderRadius: 9999,
      background: 'var(--qp-surface-container-low)',
      color: 'var(--qp-fg-2)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 18
    }
  }, a.icon)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      font: '500 14px/1.4 var(--qp-font-sans)',
      color: 'var(--qp-fg-1)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600
    }
  }, a.who), ' ', /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--qp-fg-2)'
    }
  }, a.did), ' ', /*#__PURE__*/React.createElement("span", null, a.what)), /*#__PURE__*/React.createElement("div", {
    style: {
      font: '500 12px/1 var(--qp-font-sans)',
      color: 'var(--qp-fg-3)'
    }
  }, a.when)))))), /*#__PURE__*/React.createElement(RightPane, {
    title: "At a glance"
  }, /*#__PURE__*/React.createElement(GlanceCard, {
    tone: "warn",
    icon: "warning",
    title: "Aarav Mehta \xB7 ITR-3",
    meta: "Due tomorrow \u2014 ready to file",
    action: /*#__PURE__*/React.createElement(Button, {
      variant: "outlined",
      size: "compact",
      style: {
        alignSelf: 'flex-start'
      }
    }, "Review")
  }), /*#__PURE__*/React.createElement(GlanceCard, {
    tone: "primary",
    icon: "schedule",
    title: "Quarter-end approaching",
    meta: "31 March \u2192 14 GST returns pending"
  }, "Bulk-generate reminders for all clients with outstanding docs."), /*#__PURE__*/React.createElement(GlanceCard, {
    tone: "neutral",
    icon: "payments",
    title: "\u20B91.2L unpaid",
    meta: "3 invoices overdue >15 days",
    action: /*#__PURE__*/React.createElement(Button, {
      variant: "text",
      size: "compact",
      style: {
        alignSelf: 'flex-start',
        paddingLeft: 0
      }
    }, "View invoices \u2192")
  }), /*#__PURE__*/React.createElement(GlanceCard, {
    tone: "success",
    icon: "check_circle",
    title: "GSTR-3B filed",
    meta: "Vikram Rao \xB7 Mar 2026 \xB7 18 min ago"
  })));
}
function Kpi({
  label,
  value,
  trend
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--qp-surface-container-low)',
      borderRadius: 16,
      padding: '16px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '500 12px/1 var(--qp-font-sans)',
      color: 'var(--qp-fg-3)',
      letterSpacing: '.02em'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      font: '600 28px/1.1 var(--qp-font-sans)',
      color: 'var(--qp-fg-1)',
      letterSpacing: '-.01em',
      fontVariantNumeric: 'tabular-nums'
    }
  }, value), /*#__PURE__*/React.createElement("div", {
    style: {
      font: '500 12px/1 var(--qp-font-sans)',
      color: 'var(--qp-fg-3)',
      marginTop: 2
    }
  }, trend));
}
window.HomePage = HomePage;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/quicko-pro/HomePage.jsx", error: String((e && e.message) || e) }); }

// ui_kits/quicko-pro/NavRail.jsx
try { (() => {
// NavRail.jsx — 72px primary navigation rail, full viewport height.
// Source of truth: workspace-app-design skill / references/nav.md
//
// Item order:
//   [right_panel_close]  toggle only, no label, no active state
//   Home
//   AI
//   ── divider ──
//   Orders
//   Schedule
//   Drive
//   People     → extended menu (Contacts, Directory)
//   Insights   → extended menu (Earnings, Reports)
//   More       → extended menu (Leads, Catalogue, Meetings)
//   ── spacer ──
//   [FAB +]   Surface Container Highest, 24px icon

const NAV_ITEMS = [{
  id: 'home',
  label: 'Home',
  icon: 'home',
  menu: null
}, {
  id: 'ai',
  label: 'AI',
  icon: 'auto_awesome',
  menu: null
},
// divider after index 1
{
  id: 'orders',
  label: 'Orders',
  icon: 'orders',
  menu: null
}, {
  id: 'schedule',
  label: 'Schedule',
  icon: 'calendar_today',
  menu: null
}, {
  id: 'drive',
  label: 'Drive',
  icon: 'folder',
  menu: null
}, {
  id: 'people',
  label: 'People',
  icon: 'group',
  menu: {
    title: 'People',
    items: [{
      id: 'contacts',
      label: 'Contacts',
      icon: 'account_box',
      desc: 'Signups and customers of your business'
    }, {
      id: 'directory',
      label: 'Directory',
      icon: 'domain',
      desc: 'Members and teams in your workspace'
    }]
  }
}, {
  id: 'insights',
  label: 'Insights',
  icon: 'analytics',
  menu: {
    title: 'Insights',
    items: [{
      id: 'earnings',
      label: 'Earnings',
      icon: 'payments',
      desc: 'Monitor financial trends over time'
    }, {
      id: 'reports',
      label: 'Reports',
      icon: 'assignment',
      desc: 'Track operational and financial performance'
    }]
  }
}, {
  id: 'more',
  label: 'More',
  icon: 'more_horiz',
  menu: {
    title: 'More',
    items: [{
      id: 'leads',
      label: 'Leads',
      icon: 'person_search',
      desc: 'Track prospective customers'
    }, {
      id: 'catalogue',
      label: 'Catalogue',
      icon: 'import_contacts',
      desc: 'Browse and share workspace plans'
    }, {
      id: 'meetings',
      label: 'Meetings',
      icon: 'calendar_month',
      desc: 'See all your meetings in one place'
    }]
  }
}];

// Maps any sub-feature id back to its parent rail id
const PARENT_MAP = {};
NAV_ITEMS.forEach(item => {
  if (item.menu) item.menu.items.forEach(sub => {
    PARENT_MAP[sub.id] = item.id;
  });
});
function NavRail({
  active,
  onChange,
  onToggleSecondary
}) {
  const [openMenu, setOpenMenu] = React.useState(null); // id of item whose menu is open
  const [hoverMenu, setHoverMenu] = React.useState(null); // hover target

  const railActiveId = PARENT_MAP[active] || active;
  const handleItemClick = item => {
    if (item.menu) {
      setOpenMenu(prev => prev === item.id ? null : item.id);
    } else {
      setOpenMenu(null);
      onChange(item.id);
    }
  };
  const handleMenuItemClick = subId => {
    setOpenMenu(null);
    onChange(subId);
  };

  // Close menu when clicking outside
  React.useEffect(() => {
    const handler = e => {
      if (!e.target.closest('[data-nav-rail]')) setOpenMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  return /*#__PURE__*/React.createElement("aside", {
    "data-nav-rail": true,
    style: {
      width: 72,
      flexShrink: 0,
      height: '100vh',
      background: 'var(--qp-surface-container-nav)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      position: 'sticky',
      top: 0,
      zIndex: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => onToggleSecondary && onToggleSecondary(),
    "aria-label": "Toggle secondary nav",
    style: {
      all: 'unset',
      cursor: 'pointer',
      width: 72,
      height: 60,
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--qp-on-surface-variant)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 20,
      fontVariationSettings: "'wght' 300, 'FILL' 0, 'GRAD' 0, 'opsz' 20"
    }
  }, "right_panel_close")), /*#__PURE__*/React.createElement("nav", {
    style: {
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative'
    }
  }, NAV_ITEMS.map((item, idx) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: item.id
  }, idx === 2 && /*#__PURE__*/React.createElement("div", {
    style: {
      width: 40,
      height: 1,
      background: 'var(--qp-outline-variant)',
      margin: '4px auto',
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement(NavRailItem, {
    item: item,
    active: railActiveId === item.id,
    menuOpen: openMenu === item.id,
    onClick: () => handleItemClick(item),
    onHover: setHoverMenu
  }), item.menu && openMenu === item.id && /*#__PURE__*/React.createElement(ExtendedMenu, {
    menu: item.menu,
    activeId: active,
    onSelect: handleMenuItemClick,
    onClose: () => setOpenMenu(null)
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px 12px',
      width: '100%',
      boxSizing: 'border-box'
    }
  }, /*#__PURE__*/React.createElement("button", {
    "aria-label": "New",
    style: {
      all: 'unset',
      cursor: 'pointer',
      width: 48,
      height: 48,
      borderRadius: 9999,
      background: 'var(--qp-surface-container-highest)',
      color: 'var(--qp-on-surface)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      margin: '0 auto',
      transition: 'background 150ms var(--qp-ease-standard)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 24,
      fontVariationSettings: "'wght' 300, 'FILL' 0, 'GRAD' 0, 'opsz' 24"
    }
  }, "add"))), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 8
    }
  }));
}
function NavRailItem({
  item,
  active,
  menuOpen,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      all: 'unset',
      cursor: 'pointer',
      width: 72,
      height: 64,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      // Outer wrapper NEVER gets a fill — only inner chip does
      background: hover && !active ? 'rgba(0,0,0,0.04)' : 'transparent',
      transition: 'background 150ms var(--qp-ease-standard)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: active ? 48 : 44,
      height: 28,
      borderRadius: 1000,
      background: active ? 'var(--qp-secondary-container)' : 'transparent',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'background 150ms var(--qp-ease-standard), width 150ms'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 20,
      color: active ? 'var(--qp-secondary)' : 'var(--qp-on-surface)',
      fontVariationSettings: active ? "'wght' 400, 'FILL' 1, 'GRAD' 0, 'opsz' 20" : "'wght' 300, 'FILL' 0, 'GRAD' 0, 'opsz' 20",
      transition: 'color 150ms'
    }
  }, item.icon)), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--qp-t-label-small)',
      color: 'var(--qp-on-surface)',
      textAlign: 'center',
      width: 56,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, item.label));
}

// Extended menu — 312px card, Surface Container Overlay, 12dp radius, M3 Level 2 elevation
function ExtendedMenu({
  menu,
  activeId,
  onSelect,
  onClose
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: 72,
      top: 0,
      width: 312,
      background: 'var(--qp-surface-container-overlay)',
      borderRadius: 12,
      boxShadow: 'var(--qp-elev-2)',
      zIndex: 20,
      overflow: 'hidden',
      padding: '8px 0'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--qp-t-label-medium)',
      color: 'var(--qp-on-surface-variant)',
      padding: '8px 16px 4px'
    }
  }, menu.title), menu.items.map(sub => /*#__PURE__*/React.createElement("button", {
    key: sub.id,
    onClick: () => onSelect(sub.id),
    style: {
      all: 'unset',
      cursor: 'pointer',
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: '12px 16px',
      width: '100%',
      boxSizing: 'border-box',
      background: activeId === sub.id ? 'var(--qp-secondary-container)' : 'transparent',
      transition: 'background 150ms'
    },
    onMouseEnter: e => {
      if (activeId !== sub.id) e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
    },
    onMouseLeave: e => {
      e.currentTarget.style.background = activeId === sub.id ? 'var(--qp-secondary-container)' : 'transparent';
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 20,
      flexShrink: 0,
      color: 'var(--qp-on-surface)',
      fontVariationSettings: "'wght' 300, 'FILL' 0, 'GRAD' 0, 'opsz' 20"
    }
  }, sub.icon), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--qp-t-body-large)',
      color: 'var(--qp-on-surface)'
    }
  }, sub.label), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--qp-t-body-small)',
      color: 'var(--qp-on-surface-variant)'
    }
  }, sub.desc)))));
}
window.NavRail = NavRail;
window.NAV_ITEMS = NAV_ITEMS;
window.PARENT_MAP = PARENT_MAP;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/quicko-pro/NavRail.jsx", error: String((e && e.message) || e) }); }

// ui_kits/quicko-pro/OrdersPage.jsx
try { (() => {
// OrdersPage.jsx — Orders list view, My Orders + All Orders sub-sections.
//
// PRINCIPLES (from workspace-app-design skill / references/lists.md):
//
// WHY contained cards:
//   Each order is an independent entity. Two orders cannot be "related" to each other
//   in the way ledger entries relate — they are discrete jobs. Cards visually communicate
//   independence. Flat rows would imply a shared context that doesn't exist.
//
// WHY customer above order title:
//   Principle 7 — "Primary entity above, meta below — never reversed."
//   The viewer needs to identify WHO first (the customer), then WHAT (the filing).
//   Reversing this would force the viewer to read the filing name before knowing whose it is.
//
// WHY "All · Open · Closed" only for toolbar:
//   Principle — broad lifecycle buckets, never granular stages.
//   "Open" = all active/in-progress/draft/waiting states.
//   "Closed" = all terminal states (filed, completed, cancelled).
//   Granular stage labels (e.g. "Draft", "In review") live ON the card chip — not as filter buttons.
//   This keeps the toolbar scannable and prevents cognitive overload.
//
// WHY assignee column only in "All Orders":
//   Principle 3 — workspace views add an assignee column; personal (My) views omit it.
//   In "My Orders", everything is already scoped to the viewer — showing "Me" everywhere is noise.
//   In "All Orders", the assignee is essential context for scanning who owns what.
//
// WHY status chip hugs its content:
//   The column has fixed width; the chip hugs content and left-aligns.
//   Never stretch a chip to fill the column — that destroys visual rhythm across rows.

const ORDER_DATA = [{
  id: 'CDD2944822',
  customer: 'Arjun Patil',
  title: 'GST Registration for E-commerce Sellers',
  time: '12:00 PM, 12th Jan 2025',
  status: 'active',
  assignee: 'Anjali Verma',
  assigneeRole: 'Member'
}, {
  id: 'CDD2944822',
  customer: 'Deepika Dutta',
  title: 'ITR for Investors',
  time: '12:00 PM, 12th Jan 2025',
  status: 'success',
  assignee: 'Anjali Verma',
  assigneeRole: 'Member',
  reactions: 5
}, {
  id: 'CDD2944822',
  customer: 'Prakash Verma',
  title: 'ITR For Salaried Individuals',
  time: '12:00 PM, 12th Jan 2025',
  status: 'success',
  assignee: 'Anjali Verma',
  assigneeRole: 'Member',
  reactions: 1
}, {
  id: 'CDD2944822',
  customer: 'Sneha Bansal',
  title: 'ITR for Freelancers and Small Business O…',
  time: '12:00 PM, 12th Jan 2025',
  status: 'default',
  assignee: 'Anjali Verma',
  assigneeRole: 'Member'
}, {
  id: 'CDD2944822',
  customer: 'Arjun Patil',
  title: 'GST Registration for E-commerce Sellers',
  time: '12:00 PM, 12th Jan 2025',
  status: 'warning',
  assignee: 'Anjali Verma',
  assigneeRole: 'Member'
}, {
  id: 'CDD2944822',
  customer: 'Deepika Dutta',
  title: 'ITR for Investors',
  time: '12:00 PM, 12th Jan 2025',
  status: 'active',
  assignee: 'Anjali Verma',
  assigneeRole: 'Member'
}];

// Status chip config — 5 states only (Default, Active, Success, Warning, Error)
// Color choice follows the skill principle:
//   Active (blue)  = user must still take action (In progress, Pending)
//   Default (gray) = terminal/closed state, no further action (Cancelled)
//   Success        = positive outcome worth surfacing (Completed, Filed)
//   Warning        = genuine attention needed (Needs action, Overdue)
//   Error          = failure outcome (Failed payment, Rejected)
const STATUS_CONFIG = {
  active: {
    label: 'In progress',
    icon: 'receipt_long',
    bg: 'var(--qp-primary-container)',
    fg: 'var(--qp-secondary)'
  },
  success: {
    label: 'Completed',
    icon: 'check_circle',
    bg: 'var(--qp-success-container)',
    fg: 'var(--qp-on-success-container)'
  },
  default: {
    label: 'Cancelled',
    icon: 'cancel',
    bg: 'var(--qp-surface-container-high)',
    fg: 'var(--qp-on-surface-variant)'
  },
  warning: {
    label: 'Needs action',
    icon: 'warning',
    bg: 'var(--qp-warning-container)',
    fg: 'var(--qp-on-warning-container)'
  },
  error: {
    label: 'Failed',
    icon: 'error',
    bg: 'var(--qp-error-container)',
    fg: 'var(--qp-on-error-container)'
  }
};
function OrdersPage({
  setRoute
}) {
  const [activeFilter, setActiveFilter] = React.useState('all');
  const [activeSection, setActiveSection] = React.useState('my-orders');
  const isWorkspace = activeSection === 'all-orders';

  // Filter counts
  const allCount = ORDER_DATA.length;
  const openCount = ORDER_DATA.filter(o => o.status === 'active').length;
  const closedCount = ORDER_DATA.filter(o => ['success', 'default'].includes(o.status)).length;
  const filtered = activeFilter === 'open' ? ORDER_DATA.filter(o => o.status === 'active') : activeFilter === 'closed' ? ORDER_DATA.filter(o => ['success', 'default'].includes(o.status)) : ORDER_DATA;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      font: '500 22px/28px var(--qp-font-sans)',
      color: 'var(--qp-on-surface)',
      margin: 0
    }
  }, isWorkspace ? 'All Orders.' : 'My Orders.', ' ', /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--qp-outline)'
    }
  }, isWorkspace ? 'The bigger picture.' : 'Where work unfolds.'))), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 200,
      height: 80,
      flexShrink: 0,
      opacity: .5,
      marginLeft: 16,
      background: 'var(--qp-surface-container)',
      borderRadius: 8,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 32,
      color: 'var(--qp-primary)'
    }
  }, "receipt_long"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      borderBottom: '2px solid var(--qp-outline-variant)',
      marginBottom: 8
    }
  }, [{
    id: 'standard',
    label: 'Standard'
  }, {
    id: 'memberships',
    label: 'Memberships'
  }].map((t, i) => /*#__PURE__*/React.createElement("button", {
    key: t.id,
    style: {
      all: 'unset',
      cursor: 'pointer',
      padding: '0 4px 12px',
      marginRight: 24,
      font: i === 0 ? 'var(--qp-t-title-small)' : '500 14px/1 var(--qp-font-sans)',
      color: i === 0 ? 'var(--qp-primary)' : 'var(--qp-on-surface-variant)',
      borderBottom: i === 0 ? '2px solid var(--qp-primary)' : '2px solid transparent',
      marginBottom: -2
    }
  }, t.label))), /*#__PURE__*/React.createElement("p", {
    style: {
      font: 'var(--qp-t-body-medium)',
      color: 'var(--qp-on-surface-variant)',
      margin: '8px 0 20px'
    }
  }, isWorkspace ? 'See how work is progressing across every order in your workspace.' : 'See how each order progresses from start to finish.'), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      marginBottom: 16,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12
    }
  }, [{
    id: 'all',
    label: `All (${allCount})`
  }, {
    id: 'open',
    label: `Open (${openCount})`
  }, {
    id: 'closed',
    label: `Closed (${closedCount})`
  }].map(f => /*#__PURE__*/React.createElement(RoundedFilterButton, {
    key: f.id,
    label: f.label,
    selected: activeFilter === f.id,
    onClick: () => setActiveFilter(f.id)
  })), /*#__PURE__*/React.createElement("button", {
    style: {
      all: 'unset',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 32,
      padding: '0 16px 0 8px',
      borderRadius: 9999,
      border: '1px solid var(--qp-outline-variant)',
      font: 'var(--qp-t-label-large)',
      color: 'var(--qp-primary)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 20,
      fontVariationSettings: "'wght' 300"
    }
  }, "filter_list"), "Filters")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("button", {
    style: {
      all: 'unset',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '9px 16px',
      borderRadius: 8,
      border: '1px solid var(--qp-outline-variant)',
      font: 'var(--qp-t-title-small)',
      color: 'var(--qp-on-surface)'
    }
  }, "Placed", /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 20,
      fontVariationSettings: "'wght' 300"
    }
  }, "arrow_downward_alt"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, filtered.map((order, i) => /*#__PURE__*/React.createElement(OrderCard, {
    key: i,
    order: order,
    showAssignee: isWorkspace,
    onClick: () => {}
  }))));
}

// Rounded filter button — custom component per lists.md (NOT M3 Filter Chip)
// WHY custom: these are lifecycle bucket selectors, not tag filters.
// Selected: Secondary Container fill + Secondary text
// Unselected: Outline Variant border + On Surface text
function RoundedFilterButton({
  label,
  selected,
  onClick
}) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    style: {
      all: 'unset',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: 40,
      padding: '0 16px',
      borderRadius: 9999,
      // fully pill
      minWidth: 110,
      background: selected ? 'var(--qp-secondary-container)' : 'transparent',
      border: selected ? 'none' : '1px solid var(--qp-outline-variant)',
      color: selected ? 'var(--qp-secondary)' : 'var(--qp-on-surface)',
      font: 'var(--qp-t-label-large)',
      transition: 'background 150ms, color 150ms, border-color 150ms'
    }
  }, label);
}

// Order card — contained card
// Anatomy:
//   [20px avatar] Customer name (Label Small, On Surface Variant)
//   Order title                                          [Status chip]
//   #ID · timestamp [· reactions]
//
// WHY 20px avatar in list (not 40px):
//   The 40px avatar is for the glance view hero — it's the dominant identity element there.
//   In the list, the customer name is the primary identifier; the avatar is a supporting cue.
//   Smaller avatar keeps the visual hierarchy correct and reduces clutter in dense lists.
function OrderCard({
  order,
  showAssignee,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  const status = STATUS_CONFIG[order.status] || STATUS_CONFIG.default;
  const initials = order.customer.split(' ').map(w => w[0]).join('').slice(0, 2);
  const assigneeInitials = order.assignee ? order.assignee.split(' ').map(w => w[0]).join('').slice(0, 2) : '';
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      padding: '16px 24px',
      background: hover ? 'var(--qp-surface-container-low)' : 'var(--qp-surface-container-lowest)',
      border: '1px solid var(--qp-outline-variant)',
      borderRadius: 8,
      cursor: 'pointer',
      transition: 'background 150ms var(--qp-ease-standard)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: initials,
    size: 20
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--qp-t-label-small)',
      color: 'var(--qp-on-surface-variant)'
    }
  }, order.customer)), /*#__PURE__*/React.createElement("div", {
    style: {
      font: 'var(--qp-t-body-large)',
      color: 'var(--qp-on-surface)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, order.title), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      font: 'var(--qp-t-body-small)',
      color: 'var(--qp-on-surface-variant)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "#", order.id), /*#__PURE__*/React.createElement("span", null, "\xB7"), /*#__PURE__*/React.createElement("span", null, order.time), order.reactions && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", null, "\xB7"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 3
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14
    }
  }, "\uD83D\uDE0A"), /*#__PURE__*/React.createElement("span", null, order.reactions))))), showAssignee && /*#__PURE__*/React.createElement("div", {
    style: {
      flexShrink: 0,
      width: 160,
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: assigneeInitials,
    size: 24
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--qp-t-body-medium)',
      color: 'var(--qp-on-surface)'
    }
  }, order.assignee), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--qp-t-body-small)',
      color: 'var(--qp-on-surface-variant)'
    }
  }, order.assigneeRole))), /*#__PURE__*/React.createElement("div", {
    style: {
      flexShrink: 0,
      width: 140,
      display: 'flex',
      justifyContent: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement(StatusChip, {
    config: status
  })));
}

// Status chip — icon + label, semantic colour
function StatusChip({
  config
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 10px 4px 8px',
      borderRadius: 9999,
      background: config.bg,
      color: config.fg,
      font: 'var(--qp-t-label-medium)',
      whiteSpace: 'nowrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 16,
      fontVariationSettings: "'wght' 300, 'FILL' 0, 'GRAD' 0, 'opsz' 20"
    }
  }, config.icon), config.label);
}
window.OrdersPage = OrdersPage;
window.RoundedFilterButton = RoundedFilterButton;
window.StatusChip = StatusChip;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/quicko-pro/OrdersPage.jsx", error: String((e && e.message) || e) }); }

// ui_kits/quicko-pro/PageHeader.jsx
try { (() => {
// PageHeader.jsx — the top band on every central pane page.
// Variants:
//   variant="standard"  →  title + subtitle + primary/secondary actions (most common)
//   variant="breadcrumb" →  breadcrumbs on top of the title (for nested drive/contact views)

function PageHeader({
  variant = 'standard',
  title,
  subtitle,
  breadcrumbs,
  actions
}) {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: variant === 'breadcrumb' ? 6 : 4
    }
  }, variant === 'breadcrumb' && breadcrumbs && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      font: '500 13px/1 var(--qp-font-sans)',
      color: 'var(--qp-fg-3)'
    }
  }, breadcrumbs.map((b, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: i
  }, i > 0 && /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 16,
      color: 'var(--qp-fg-4)'
    }
  }, "chevron_right"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: i === breadcrumbs.length - 1 ? 'var(--qp-fg-1)' : 'var(--qp-fg-3)',
      fontWeight: i === breadcrumbs.length - 1 ? 600 : 500
    }
  }, b)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      font: '600 32px/1.15 var(--qp-font-sans)',
      letterSpacing: '-.015em',
      color: 'var(--qp-fg-1)',
      margin: 0
    }
  }, title), subtitle && /*#__PURE__*/React.createElement("div", {
    style: {
      font: '500 14px/1.5 var(--qp-font-sans)',
      color: 'var(--qp-fg-2)',
      marginTop: 6
    }
  }, subtitle)), actions && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      flexShrink: 0
    }
  }, actions)));
}
window.PageHeader = PageHeader;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/quicko-pro/PageHeader.jsx", error: String((e && e.message) || e) }); }

// ui_kits/quicko-pro/Primitives.jsx
try { (() => {
// Primitives.jsx — low-level building blocks used throughout the kit.

function Button({
  variant = 'filled',
  icon,
  trailingIcon,
  children,
  onClick,
  disabled,
  size = 'default',
  style
}) {
  const sizes = {
    default: {
      padding: '10px 24px',
      height: 40,
      fontSize: 14,
      iconSize: 20
    },
    compact: {
      padding: '8px 20px',
      height: 36,
      fontSize: 13,
      iconSize: 18
    },
    large: {
      padding: '12px 28px',
      height: 48,
      fontSize: 15,
      iconSize: 20
    }
  };
  const s = sizes[size];
  const cls = 'qp-btn qp-btn-' + variant;
  return /*#__PURE__*/React.createElement("button", {
    className: cls,
    onClick: onClick,
    disabled: disabled,
    style: {
      padding: s.padding,
      height: s.height,
      fontSize: s.fontSize,
      ...style
    }
  }, icon && /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-outlined",
    style: {
      fontSize: s.iconSize
    }
  }, icon), children, trailingIcon && /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-outlined",
    style: {
      fontSize: s.iconSize
    }
  }, trailingIcon));
}
function IconButton({
  icon,
  onClick,
  ariaLabel,
  style
}) {
  return /*#__PURE__*/React.createElement("button", {
    className: "qp-icon-btn",
    onClick: onClick,
    "aria-label": ariaLabel,
    style: style
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-outlined"
  }, icon));
}
function Chip({
  label,
  selected,
  leading,
  onClick,
  onRemove,
  tone = 'default'
}) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    className: "qp-chip",
    "data-selected": selected || undefined,
    "data-tone": tone
  }, leading && /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-outlined",
    style: {
      fontSize: 16
    }
  }, leading), selected && !leading && /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-outlined",
    style: {
      fontSize: 16
    }
  }, "check"), /*#__PURE__*/React.createElement("span", null, label), onRemove && /*#__PURE__*/React.createElement("span", {
    className: "qp-chip-x",
    onClick: e => {
      e.stopPropagation();
      onRemove();
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-outlined",
    style: {
      fontSize: 14
    }
  }, "close")));
}
function TextField({
  label,
  value,
  onChange,
  placeholder,
  icon,
  trailing,
  error,
  help,
  filled,
  style
}) {
  const [focused, setFocused] = React.useState(false);
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      font: '500 12px/1 var(--qp-font-sans)',
      color: 'var(--qp-fg-2)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    className: "qp-input",
    "data-focus": focused || undefined,
    "data-error": error || undefined,
    "data-filled": filled || undefined
  }, icon && /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-outlined",
    style: {
      fontSize: 20,
      color: 'var(--qp-fg-3)'
    }
  }, icon), /*#__PURE__*/React.createElement("input", {
    value: value,
    onChange: e => onChange && onChange(e.target.value),
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    placeholder: placeholder,
    style: {
      flex: 1,
      border: 0,
      outline: 'none',
      background: 'transparent',
      font: '500 14px/1 var(--qp-font-sans)',
      color: 'var(--qp-fg-1)',
      minWidth: 0
    }
  }), trailing), help && /*#__PURE__*/React.createElement("span", {
    style: {
      font: '500 12px/1.3 var(--qp-font-sans)',
      color: error ? 'var(--qp-error)' : 'var(--qp-fg-3)'
    }
  }, help));
}
function Avatar({
  initials,
  size = 36,
  verified
}) {
  // Avatars always use primary container bg + on-primary-container fg.
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      flex: 'none',
      width: size,
      height: size,
      borderRadius: 9999,
      background: 'var(--qp-primary-container)',
      color: 'var(--qp-on-primary-container)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      font: `600 ${Math.round(size * 0.36)}px/1 var(--qp-font-sans)`
    }
  }, initials, verified && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      right: -3,
      bottom: -3,
      width: Math.max(16, size * 0.4),
      height: Math.max(16, size * 0.4),
      borderRadius: 9999,
      background: 'var(--qp-primary)',
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: '2px solid var(--qp-surface-container-lowest)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: Math.max(11, size * 0.26),
      fontVariationSettings: "'wght' 500, 'FILL' 1"
    }
  }, "star")));
}
function Badge({
  children,
  tone = 'neutral'
}) {
  const tones = {
    neutral: {
      bg: 'var(--qp-surface-container-high)',
      fg: 'var(--qp-fg-1)'
    },
    primary: {
      bg: 'var(--qp-primary-container)',
      fg: 'var(--qp-on-primary-container)'
    },
    success: {
      bg: 'var(--qp-success-container)',
      fg: 'var(--qp-on-success-container)'
    },
    warning: {
      bg: 'var(--qp-warning-container)',
      fg: 'var(--qp-on-warning-container)'
    },
    error: {
      bg: 'var(--qp-error-container)',
      fg: 'var(--qp-on-error-container)'
    }
  };
  const t = tones[tone] || tones.neutral;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '3px 10px',
      borderRadius: 9999,
      background: t.bg,
      color: t.fg,
      font: '500 12px/1.4 var(--qp-font-sans)'
    }
  }, children);
}
function Card({
  children,
  style,
  padding = 20,
  raised
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--qp-surface-container-lowest)',
      border: raised ? 0 : '1px solid var(--qp-divider)',
      boxShadow: raised ? 'var(--qp-elev-1)' : 'none',
      borderRadius: 12,
      padding,
      ...style
    }
  }, children);
}
function Tabs({
  tabs,
  value,
  onChange
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      borderBottom: '1px solid var(--qp-divider)',
      marginBottom: 20
    }
  }, tabs.map(t => /*#__PURE__*/React.createElement("button", {
    key: t.id,
    onClick: () => onChange(t.id),
    className: "qp-tab",
    "data-active": value === t.id || undefined
  }, t.label, t.count != null && /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 6,
      font: '500 12px/1 var(--qp-font-sans)',
      color: 'var(--qp-fg-3)'
    }
  }, t.count))));
}
window.Button = Button;
window.IconButton = IconButton;
window.Chip = Chip;
window.TextField = TextField;
window.Avatar = Avatar;
window.Badge = Badge;
window.Card = Card;
window.Tabs = Tabs;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/quicko-pro/Primitives.jsx", error: String((e && e.message) || e) }); }

// ui_kits/quicko-pro/RightPane.jsx
try { (() => {
// RightPane.jsx — 340px optional right-side pane for Glance views.
// Only appears where it adds value (Home, some feature pages). Shows alerts,
// upcoming deadlines, recent activity — lightweight card list.

function RightPane({
  children,
  title = 'Glance'
}) {
  return /*#__PURE__*/React.createElement("aside", {
    style: {
      width: 340,
      flexShrink: 0,
      padding: '24px 24px 24px 0',
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 4px 4px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '600 13px/1 var(--qp-font-sans)',
      color: 'var(--qp-fg-2)',
      letterSpacing: '.04em',
      textTransform: 'uppercase'
    }
  }, title), /*#__PURE__*/React.createElement("button", {
    style: {
      all: 'unset',
      cursor: 'pointer',
      color: 'var(--qp-fg-3)',
      display: 'inline-flex'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 20
    }
  }, "more_horiz"))), children);
}
function GlanceCard({
  tone = 'neutral',
  icon,
  title,
  meta,
  children,
  action
}) {
  const toneStyles = {
    neutral: {
      bg: 'var(--qp-surface-container-lowest)',
      ring: '1px solid var(--qp-divider)'
    },
    primary: {
      bg: 'var(--qp-primary-container)',
      ring: '0'
    },
    warn: {
      bg: 'var(--qp-warning-container)',
      ring: '0'
    },
    success: {
      bg: 'var(--qp-success-container)',
      ring: '0'
    }
  }[tone];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: toneStyles.bg,
      border: toneStyles.ring,
      borderRadius: 16,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10
    }
  }, icon && /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 20,
      marginTop: 1
    }
  }, icon), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: '600 14px/1.3 var(--qp-font-sans)',
      color: tone === 'neutral' ? 'var(--qp-fg-1)' : undefined
    }
  }, title), meta && /*#__PURE__*/React.createElement("div", {
    style: {
      font: '500 12px/1.4 var(--qp-font-sans)',
      opacity: .75,
      marginTop: 2
    }
  }, meta))), children && /*#__PURE__*/React.createElement("div", {
    style: {
      font: '500 13px/1.5 var(--qp-font-sans)',
      opacity: .9
    }
  }, children), action);
}
window.RightPane = RightPane;
window.GlanceCard = GlanceCard;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/quicko-pro/RightPane.jsx", error: String((e && e.message) || e) }); }

// ui_kits/quicko-pro/SecondaryNav.jsx
try { (() => {
// SecondaryNav.jsx — 184px transparent secondary nav for features with sub-sections.
// Source of truth: workspace-app-design skill / references/nav.md Tier 3
//
// Rules:
// - Background: transparent (no fill token — sits on base Surface)
// - Active item: Primary Container fill, On Primary Container text, 8dp corners
// - Inactive item: On Surface Variant text, no fill
// - Extended FAB at top: M3 Extended FAB, full width minus 16px padding each side
//   Label: + New / + Upload / + Add (never append entity name)
// - Group labels: Label Small, On Surface Variant, 32px tall, 16px left padding
// - Items: Body Medium, 40px height, no padding, full radius
// - 1px Outline Variant divider between functionally distinct groups

const SECONDARY_CONFIGS = {
  orders: {
    fab: {
      label: 'New',
      icon: 'add'
    },
    groups: [{
      title: null,
      items: [{
        id: 'my-orders',
        label: 'My Orders',
        icon: 'receipt_long'
      }, {
        id: 'all-orders',
        label: 'All Orders',
        icon: 'receipt_long'
      }]
    }]
  },
  drive: {
    fab: {
      label: 'New',
      icon: 'add'
    },
    groups: [{
      title: null,
      items: [{
        id: 'my-drive',
        label: 'My Drive',
        icon: 'folder'
      }, {
        id: 'shared',
        label: 'Shared with me',
        icon: 'folder_shared'
      }, {
        id: 'starred',
        label: 'Starred',
        icon: 'star'
      }, {
        id: 'recent',
        label: 'Recent',
        icon: 'history'
      }, {
        id: 'trash',
        label: 'Trash',
        icon: 'delete'
      }]
    }]
  },
  schedule: {
    fab: {
      label: 'Add',
      icon: 'add'
    },
    groups: [{
      title: null,
      items: [{
        id: 'schedule',
        label: 'My Calendar',
        icon: 'calendar_today'
      }]
    }]
  },
  leads: {
    fab: {
      label: 'New',
      icon: 'add'
    },
    groups: [{
      title: null,
      items: [{
        id: 'my-leads',
        label: 'My Leads',
        icon: 'person_search'
      }, {
        id: 'all-leads',
        label: 'All Leads',
        icon: 'person_search'
      }]
    }]
  }
};
function SecondaryNav({
  feature,
  active,
  onChange
}) {
  const cfg = SECONDARY_CONFIGS[feature];
  if (!cfg) return null;
  return /*#__PURE__*/React.createElement("nav", {
    style: {
      width: 184,
      flexShrink: 0,
      // Transparent — no fill token, sits on base Surface
      background: 'transparent',
      display: 'flex',
      flexDirection: 'column',
      padding: '0 0 16px 0',
      boxSizing: 'border-box'
      // Full height below top nav handled by flex parent
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 16
    }
  }, /*#__PURE__*/React.createElement("button", {
    style: {
      all: 'unset',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      height: 56,
      borderRadius: 16,
      padding: '0 20px',
      background: 'var(--qp-surface-container-overlay)',
      color: 'var(--qp-on-surface)',
      font: '600 14px/1 var(--qp-font-sans)',
      boxSizing: 'border-box',
      boxShadow: 'var(--qp-elev-1)',
      transition: 'box-shadow 150ms var(--qp-ease-standard)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 20,
      fontVariationSettings: "'wght' 300, 'FILL' 0, 'GRAD' 0, 'opsz' 20"
    }
  }, cfg.fab.icon), cfg.fab.label)), cfg.groups.map((group, gi) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: gi
  }, gi > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      height: 1,
      background: 'var(--qp-outline-variant)',
      margin: '8px 16px'
    }
  }), group.title && /*#__PURE__*/React.createElement("div", {
    style: {
      height: 32,
      display: 'flex',
      alignItems: 'center',
      paddingLeft: 16,
      font: 'var(--qp-t-label-small)',
      color: 'var(--qp-on-surface-variant)',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      marginTop: 8
    }
  }, group.title), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      padding: '0 16px'
    }
  }, group.items.map(item => /*#__PURE__*/React.createElement(SecondaryNavItem, {
    key: item.id,
    item: item,
    active: active === item.id,
    onClick: () => onChange && onChange(item.id)
  }))))));
}
function SecondaryNavItem({
  item,
  active,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      all: 'unset',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      height: 40,
      padding: '0 12px',
      borderRadius: 9999,
      // full pill radius
      // Active: Primary Container fill + On Primary Container text
      // Inactive: no fill, On Surface Variant text
      background: active ? 'var(--qp-primary-container)' : hover ? 'rgba(0,0,0,0.04)' : 'transparent',
      color: active ? 'var(--qp-on-primary-container)' : 'var(--qp-on-surface-variant)',
      font: 'var(--qp-t-body-medium)',
      transition: 'background 150ms var(--qp-ease-standard), color 150ms',
      boxSizing: 'border-box'
    }
  }, item.icon && /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 20,
      flexShrink: 0,
      fontVariationSettings: active ? "'wght' 400, 'FILL' 1, 'GRAD' 0, 'opsz' 20" : "'wght' 300, 'FILL' 0, 'GRAD' 0, 'opsz' 20"
    }
  }, item.icon), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, item.label));
}
window.SecondaryNav = SecondaryNav;
window.SECONDARY_CONFIGS = SECONDARY_CONFIGS;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/quicko-pro/SecondaryNav.jsx", error: String((e && e.message) || e) }); }

// ui_kits/quicko-pro/Shell.jsx
try { (() => {
// Shell.jsx — app chrome.
// Source of truth: workspace-app-design skill / references/app-shell.md
//
// Layout:
//   ┌────────┬────────────────────────────────────────────┐
//   │        │  Top Nav (64px, Surface, viewport-72px)    │
//   │  Nav   ├────────────────────────────────────────────┤
//   │  Rail  │  Body (16px padding all sides, 16px gap)   │
//   │  72px  │  ┌──────────┬───────────────────┬────────┐ │
//   │  full  │  │ Sec Nav  │  Central pane     │  Rt   │ │
//   │  height│  │  184px   │  min 740px        │  340  │ │
//   │        │  │ transp.  │  SurfContLowest   │ (opt) │ │
//   │        │  └──────────┴───────────────────┴────────┘ │
//   └────────┴────────────────────────────────────────────┘
//
// Surface token hierarchy:
//   Base: Surface
//   Nav rail (72px): Surface Container Nav
//   Secondary nav (184px): transparent
//   Central + right pane: Surface Container Lowest
//   Overlays/menus: Surface Container Overlay

function Shell({
  route,
  parentRoute,
  setRoute,
  secondary,
  children
}) {
  const [secondaryVisible, setSecondaryVisible] = React.useState(true);

  // Show secondary nav only when the feature has one AND toggle is on
  const showSecondary = secondary && secondaryVisible;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'row',
      minHeight: '100vh',
      background: 'var(--qp-surface)'
    }
  }, /*#__PURE__*/React.createElement(NavRail, {
    active: parentRoute,
    onChange: id => {
      // Map rail/menu IDs to route
      const routeMap = {
        home: 'home',
        orders: 'orders',
        drive: 'drive',
        schedule: 'schedule',
        ai: 'home',
        // Extended menu sub-items
        contacts: 'contacts',
        directory: 'contacts',
        earnings: 'earnings',
        reports: 'earnings',
        leads: 'orders',
        catalogue: 'home',
        meetings: 'home'
      };
      setRoute(routeMap[id] || 'home');
    },
    onToggleSecondary: () => setSecondaryVisible(v => !v)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100vh'
    }
  }, /*#__PURE__*/React.createElement(TopNav, null), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'row',
      padding: 16,
      gap: 16,
      minHeight: 0,
      alignItems: 'flex-start'
    }
  }, showSecondary && /*#__PURE__*/React.createElement(SecondaryNav, {
    feature: secondary,
    active: route,
    onChange: setRoute
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 740,
      background: 'var(--qp-surface-container-lowest)',
      borderRadius: 20,
      padding: '24px 20px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      overflowY: 'auto',
      boxSizing: 'border-box'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      maxWidth: 700,
      display: 'flex',
      flexDirection: 'column',
      gap: 24
    }
  }, children)))));
}
window.Shell = Shell;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/quicko-pro/Shell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/quicko-pro/TopNav.jsx
try { (() => {
// TopNav.jsx — 64px, Surface bg, fills viewport width minus 72px nav rail.
// Source of truth: workspace-app-design skill / references/top-nav.md
//
// Variant: In workspace (default)
// Anatomy: [Logo 224px] [Search — flex, max 560px] [spacer] [Workspace pill 252px] [Quick actions]
// Quick actions L→R: storefront · settings · Cue AI · avatar 32px
//
// Logo lives here — never in the nav rail.

function TopNav({
  variant = 'default'
}) {
  const [query, setQuery] = React.useState('');
  const [focused, setFocused] = React.useState(false);
  return /*#__PURE__*/React.createElement("header", {
    style: {
      height: 64,
      flexShrink: 0,
      width: '100%',
      background: 'var(--qp-surface)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px 0 0',
      gap: 0,
      position: 'relative',
      zIndex: 2,
      boxSizing: 'border-box'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 224,
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      paddingLeft: 16
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/Logo_Blue.png",
    alt: "Quicko Pro",
    style: {
      height: 26,
      maxWidth: 160,
      objectFit: 'contain',
      objectPosition: 'left'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      maxWidth: 560,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      height: 40,
      padding: '0 16px',
      borderRadius: 9999,
      background: 'var(--qp-surface-container-high)',
      boxSizing: 'border-box',
      outline: focused ? '2px solid var(--qp-primary)' : 'none',
      transition: 'outline 150ms',
      marginLeft: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 20,
      color: 'var(--qp-fg-3)',
      flexShrink: 0,
      fontVariationSettings: "'wght' 300, 'FILL' 0, 'GRAD' 0, 'opsz' 20"
    }
  }, "search"), /*#__PURE__*/React.createElement("input", {
    placeholder: "Search workspace",
    value: query,
    onChange: e => setQuery(e.target.value),
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    style: {
      flex: 1,
      border: 0,
      background: 'transparent',
      outline: 'none',
      font: '500 14px/1 var(--qp-font-sans)',
      color: 'var(--qp-on-surface)'
    }
  }), query && /*#__PURE__*/React.createElement("button", {
    onClick: () => setQuery(''),
    style: {
      all: 'unset',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      color: 'var(--qp-fg-3)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 18
    }
  }, "close"))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("button", {
    style: {
      all: 'unset',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      height: 40,
      padding: '0 10px 0 10px',
      width: 252,
      boxSizing: 'border-box',
      borderRadius: 9999,
      border: '1px solid var(--qp-outline-variant)',
      marginRight: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 30,
      height: 30,
      borderRadius: 8,
      flexShrink: 0,
      background: 'linear-gradient(135deg, var(--qp-primary), #5D8DF0)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#fff',
      font: '700 11px/1 var(--qp-font-sans)'
    }
  }, "KS"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--qp-t-body-medium)',
      color: 'var(--qp-on-surface)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, "Kapoor & Sons"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: 'var(--qp-t-body-small)',
      color: 'var(--qp-on-surface-variant)'
    }
  }, "Owner")), /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 18,
      color: 'var(--qp-on-surface-variant)',
      flexShrink: 0,
      fontVariationSettings: "'wght' 300, 'FILL' 0, 'GRAD' 0, 'opsz' 20"
    }
  }, "expand_all")), /*#__PURE__*/React.createElement(TopNavIcon, {
    icon: "storefront",
    label: "Marketplace"
  }), /*#__PURE__*/React.createElement(TopNavIcon, {
    icon: "settings",
    label: "Settings"
  }), /*#__PURE__*/React.createElement(TopNavIcon, {
    icon: "auto_awesome",
    label: "Cue AI"
  }), /*#__PURE__*/React.createElement("button", {
    style: {
      all: 'unset',
      cursor: 'pointer',
      width: 32,
      height: 32,
      borderRadius: 9999,
      background: 'var(--qp-primary-container)',
      color: 'var(--qp-on-primary-fixed-variant)',
      font: '700 12px/32px var(--qp-font-sans)',
      textAlign: 'center',
      marginLeft: 4,
      flexShrink: 0
    }
  }, "RK"));
}
function TopNavIcon({
  icon,
  label,
  active
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", {
    "aria-label": label,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      all: 'unset',
      cursor: 'pointer',
      width: 40,
      height: 40,
      borderRadius: 9999,
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--qp-on-surface-variant)',
      // Active (e.g. Settings page): Surface Container High fill
      background: active ? 'var(--qp-surface-container-high)' : hover ? 'var(--qp-surface-container-low)' : 'transparent',
      transition: 'background 150ms var(--qp-ease-standard)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-rounded",
    style: {
      fontSize: 22,
      fontVariationSettings: "'wght' 300, 'FILL' 0, 'GRAD' 0, 'opsz' 24"
    }
  }, icon));
}
window.TopNav = TopNav;
window.TopNavIcon = TopNavIcon;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/quicko-pro/TopNav.jsx", error: String((e && e.message) || e) }); }

})();
