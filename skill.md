---
name: pro-quicko-design-system
description: >
  Apply Quicko Pro's design system tokens — colors, typography, shape, spacing, and components —
  when designing UI screens, prototypes, components, or reviewing code. Use this skill whenever
  the task involves Quicko Pro product UI: building screens in Figma, ideating layouts,
  reviewing whether code uses correct tokens, or producing design specs. This skill covers
  the Quicko Pro-specific overrides (colors, font, shape scale, spacing) AND the full component
  library on top of M3. For M3 component rules, elevation, motion, or accessibility, also load
  the material-thinking skill.
---
 
# Quicko Pro Design System
 
Quicko Pro's design system is **Material Design 3 (M3) customised for an Indian tax/financial
workspace product**, using Quicko Pro-specific tokens and a purpose-built component library.
 
The relationship is:
- **M3 rules** (component anatomy, states, elevation, motion, accessibility) → follow `material-thinking` skill
- **Quicko Pro tokens** (colors, font, shape scale, spacing) → defined in this skill
- **Quicko Pro component library** → defined in this skill
When designing or reviewing Quicko Pro UI, always apply BOTH this skill and `material-thinking`.
 
---
 
## Quick Reference
 
### Font
- Product font: **General Sans** (fallback: Arial)
- `Instrument Sans` / `Plus Jakarta Sans` may appear in older Figma spec layers — ignore them, always use General Sans in product UI
- Weights in product UI: **Medium** (500) everywhere, **Semibold** (600) for title/medium only
- Italic is NOT used in product UI
### Colors
Primary brand blue: **`#0266ca`** → `Schemes/Primary/Primary` in Light mode
Brand yellow: **`#ffc20f`** → `Brand/Quicko Pro Yellow` in Light mode / **`#b78a00`** in Dark mode
 
Always use **Scheme tokens**, not raw palette values, in component design.
 
### Shape
10-stop scale: None (0) → Extra small (4) → Small (8) → Medium (12) → Large (16) → Large increased (20) → Extra large (28) → Extra large increased (32) → Extra extra large (48) → Full (1000/pill)
 
### Spacing
4dp grid. Use `spacing/N` tokens (Tailwind-aligned). Never use values that aren't on the scale.
 
---
 
## Token Naming Conventions (Figma → Code)
 
Figma variable names use `/` as a namespace separator. In code (CSS custom properties):
 
| Token (Figma) | CSS Variable | Light | Dark |
|---|---|---|---|
| `Schemes/Primary/Primary` | `--sys-primary` | `#0266ca` | `#aac7ff` |
| `Schemes/Primary/On Primary` | `--sys-on-primary` | `#ffffff` | `#002f64` |
| `Schemes/Primary/Primary Container` | `--sys-primary-container` | `#d6e3ff` | `#005cb9` |
| `Schemes/Primary/On Primary Container` | `--sys-on-primary-container` | `#001b3e` | `#ffffff` |
| `Schemes/Secondary/Secondary` | `--sys-secondary` | `#495f86` | `#b1c7f4` |
| `Schemes/Secondary/On Secondary` | `--sys-on-secondary` | `#ffffff` | `#183055` |
| `Schemes/Secondary/Secondary Container` | `--sys-secondary-container` | `#d6e3ff` | `#273e63` |
| `Schemes/Secondary/On Secondary Container` | `--sys-on-secondary-container` | `#001b3e` | `#bcd2ff` |
| `Schemes/Tertiary/Tertiary` | `--sys-tertiary` | `#873ea4` | `#edb1ff` |
| `Schemes/Tertiary/On Tertiary` | `--sys-on-tertiary` | `#ffffff` | `#520070` |
| `Schemes/Tertiary/Tertiary Container` | `--sys-tertiary-container` | `#f9d8ff` | `#883ea5` |
| `Schemes/Tertiary/On Tertiary Container` | `--sys-on-tertiary-container` | `#320046` | `#ffffff` |
| `Schemes/Error/Error` | `--sys-error` | `#de3730` | `#ff897d` |
| `Schemes/Error/On Error` | `--sys-on-error` | `#ffffff` | `#690005` |
| `Schemes/Error/Error Container` | `--sys-error-container` | `#ffedea` | `#540003` |
| `Schemes/Error/On Error Container` | `--sys-on-error-container` | `#410002` | `#ffdad6` |
| `Schemes/Surface/Surface` | `--sys-surface` | `#f8f9fa` | `#202124` |
| `Schemes/Surface/Surface Dim` | `--sys-surface-dim` | `#d8d9e2` | `#101319` |
| `Schemes/Surface/Surface Bright` | `--sys-surface-bright` | `#ffffff` | `#363940` |
| `Schemes/Surface/On Surface` | `--sys-on-surface` | `#191c22` | `#e1e2eb` |
| `Schemes/Surface/On Surface Variant` | `--sys-on-surface-variant` | `#414753` | `#c1c6d5` |
| `Schemes/Surface/Outline` | `--sys-outline` | `#727784` | `#8b919e` |
| `Schemes/Surface/Outline Variant` | `--sys-outline-variant` | `#c1c6d5` | `#414753` |
| `Schemes/Surface Container/Surface Container Nav` | `--sys-surface-container-nav` | `#eef0f2` | `#2f2f31` |
| `Schemes/Surface Container/Surface Container Lowest` | `--sys-surface-container-lowest` | `#ffffff` | `#0c0c0f` |
| `Schemes/Surface Container/Surface Container Low` | `--sys-surface-container-low` | `#f8f9fa` | `#18181c` |
| `Schemes/Surface Container/Surface Container` | `--sys-surface-container` | `#eef0f2` | `#242426` |
| `Schemes/Surface Container/Surface Container High` | `--sys-surface-container-high` | `#e5e6e9` | `#2f2f31` |
| `Schemes/Surface Container/Surface Container Highest` | `--sys-surface-container-highest` | `#dbdcdf` | `#3a3a3c` |
| `Schemes/Surface Container/Surface Container Overlay` | `--sys-surface-container-overlay` | `#ffffff` | `#242426` |
| `Schemes/Misc/Background` | `--sys-background` | `#f9f9ff` | `#101319` |
| `Schemes/Misc/Shadow` | `--sys-shadow` | `#000000` | `#000000` |
| `Schemes/Misc/Scrim` | `--sys-scrim` | `#000000` | `#000000` |
| `Extended/Green/Green` | `--sys-green` | `#006e1c` | `#78dc77` |
| `Extended/Green/On Green` | `--sys-on-green` | `#ffffff` | `#00390a` |
| `Extended/Green/Green Container` | `--sys-green-container` | `#ecffe4` | `#005313` |
| `Extended/Green/On Green Container` | `--sys-on-green-container` | `#002204` | `#c8ffc0` |
| `Extended/Amber/Amber` | `--sys-amber` | `#785900` | `#fabd00` |
| `Extended/Amber/On Amber` | `--sys-on-amber` | `#ffffff` | `#3f2e00` |
| `Extended/Amber/Amber Container` | `--sys-amber-container` | `#ffefd4` | `#5b4300` |
| `Extended/Amber/On Amber Container` | `--sys-on-amber-container` | `#261a00` | `#ffefd4` |
| `Extended/Gray/Gray` | `--sys-gray` | `#5b5e66` | `#c4c6d0` |
| `Extended/Gray/On Gray` | `--sys-on-gray` | `#ffffff` | `#2d3038` |
| `Extended/Gray/Gray Container` | `--sys-gray-container` | `#e0e2ec` | `#46474a` |
| `Extended/Gray/On Gray Container` | `--sys-on-gray-container` | `#181c22` | `#e3e2e6` |
| `Brand/Quicko Pro Blue` | `--brand-blue` | `#0266ca` | `#ffffff` |
| `Brand/Quicko Pro Yellow` | `--brand-yellow` | `#ffc20f` | `#b78a00` |
 
`Schemes/*` tokens → `var(--sys-<role-name-kebab-case>)`
`Extended/*` tokens → `var(--sys-<color-name-kebab-case>)`
`Palettes/*` tokens → reference-only, never used directly in component styles
 
**Shape and Spacing:**
```
Shape/None → 0px  |  Shape/Extra small → 4px (--md-sys-shape-corner-extra-small)  |  Shape/Small → 8px (--md-sys-shape-corner-small)
Shape/Medium → 12px (--md-sys-shape-corner-medium)  |  Shape/Large → 16px (--md-sys-shape-corner-large)  |  Shape/Large increased → 20px
Shape/Extra large → 28px (--md-sys-shape-corner-extra-large)  |  Shape/Extra large increased → 32px  |  Shape/Extra extra large → 48px  |  Shape/Full → 9999px
spacing/1 → 4px, spacing/2 → 8px, spacing/3 → 12px, spacing/4 → 16px, spacing/5 → 20px,
spacing/6 → 24px, spacing/8 → 32px, spacing/10 → 40px, spacing/12 → 48px, spacing/16 → 64px
```
 
---
 
## Typography Scale
 
Font: **General Sans**. All sizes in px, zero tracking unless noted.
 
| Token (Figma) | CSS token reference | Size | Line Height | Weight |
|---|---|---|---|---|
| `Body/Body Small` | `--typescale-body-small` | 12px | 16px | Medium (500) |
| `Body/Body Medium` | `--typescale-body-medium` | 14px | 20px | Medium (500) |
| `Body/Body Large` | `--typescale-body-large` | 16px | 24px | Medium (500) |
| `Label/Label Small` | `--typescale-label-small` | 11px | 16px | Medium (500) |
| `Label/Label Medium` | `--typescale-label-medium` | 12px | 16px | Medium (500) |
| `Label/Label Large` | `--typescale-label-large` | 14px | 20px | Medium (500) |
| `Title/Title Small` | `--typescale-title-small` | 14px | 20px | Medium (500) |
| `Title/Title Medium` | `--typescale-title-medium` | 16px | 24px | **Semibold (600)** |
| `Title/Title Large` | `--typescale-title-large` | 22px | 28px | Medium (500) |
| `Headline/Headline Small` | `--typescale-headline-small` | 24px | 32px | Medium (500) |
| `Headline/Headline Medium` | `--typescale-headline-medium` | 28px | 36px | Medium (500) |
| `Headline/Headline Large` | `--typescale-headline-large` | 32px | 40px | Medium (500) |
| `Display/Display Small` | `--typescale-display-small` | 36px | 44px | Medium (500) |
| `Display/Display Medium` | `--typescale-display-medium` | 45px | 52px | Medium (500) |
| `Display/Display Large` | `--typescale-display-large` | 57px | 64px | Medium (500), tracking −0.25 |
 
**Rule:** Only `Title/Medium` is Semibold (600). Everything else — including Headlines and Display — is Medium (500).
 
---
 
## Color System
 
### Scheme Tokens (use these in components)
 
**Surface family** — for backgrounds, cards, panes:
- `Schemes/Surface/Surface` — base page/canvas background
- `Schemes/Surface/Surface Dim` — subdued surface (modal backdrops)
- `Schemes/Surface/Surface Bright` — elevated surface
- `Schemes/Surface Container/*` — 5-level depth hierarchy: Lowest → Low → Default → High → Highest
  - Use higher containers for more elevated/prominent surfaces
  - `Surface Container Nav` — specifically for navigation chrome
  - `Surface Container Overlay` — for overlay/scrim surfaces
**On-Surface family** — for text/icons on surfaces:
- `Schemes/Surface/On Surface` — primary text and icons
- `Schemes/Surface/On Surface Variant` — secondary/meta text, supporting labels
- `Schemes/Surface/Outline` — borders, dividers (visible)
- `Schemes/Surface/Outline Variant` — subtle borders
**Primary** — CTAs, key interactive elements, active states
**Secondary** — supporting interactive elements
**Tertiary** — accent only, use sparingly (never dominant)
**Error** — error states, destructive actions
 
**Extended (semantic additions):**
- `Extended/Green/*` — success, positive trends, paid states
- `Extended/Amber/*` — warnings, pending states, caution
- `Extended/Gray/*` — neutral/inactive states
### Light / Dark Mode
The `Q-Pro` collection has **Light** (default) and **Dark** modes. Always design for both.
Scheme tokens auto-resolve per mode — never hardcode light-mode hex into dark surfaces.
 
---
 
## Component Library
 
This is the definitive reference for when to use each component. Always use the library
component; do not create custom alternatives.
 
---
 
### ALERTS
 
#### Alert Strip
- **What it is:** A full-width banner anchored to the **bottom of a tile/card** it relates to
- **Usage:** Attached directly to the bottom edge of the tile — it is part of the tile, not floating above or separate from it. Used to surface contextual status about that specific tile's content (e.g. a payment tile showing "Payment overdue")
- **NOT for:** Page-level banners, floating notifications, or anything detached from a card
- **Properties:** `Type` (Warning / Error / Success / Info), optional `Title`, `Description`, optional `CTA` button
- **Token usage:** Background from corresponding container: Error Container, Green Container, Amber Container, Primary Container; text from On [Color] Container
#### Alert Tile
- **What it is:** A standalone card-style alert block
- **Usage:** Used when the alert is its own content block — e.g. inside a dashboard feed, as a card in a list, as an action item the user needs to act on. More prominent and self-contained than Alert Strip
- **Properties:** `Type` (Warning / Error / Success / Info), optional title ("Follow-up extended"), description, optional CTA
- **Distinction from Alert Strip:** Alert Tile is self-contained; Alert Strip is attached to another tile
---
 
### BREADCRUMB
 
- **What it is:** Navigation path indicator showing hierarchy depth
- **Usage:** In deep navigation hierarchies — e.g. Settings > Billing > Invoices, or Filing > ITR-1 > Schedule. Shows up to 4 levels: Level 1 (always visible) through Level 4 (toggleable)
- **Properties:** `Level 2`, `Level 3`, `Level 4` (show/hide toggles), text for each level
- **Token usage:** `On Surface Variant` for inactive crumbs, `On Surface` for current level, `Outline Variant` separators
---
 
### BUTTONS
 
#### Button (main component)
The primary interactive component. All variants share the same component; switch via `Style` property.
 
**Styles and when to use each:**
 
| Style | Usage |
|---|---|
| `Filled` | Primary CTA — the single most important action on the screen |
| `Filled with Icon` | Same as Filled when an icon reinforces the action |
| `Tonal` | Important actions that aren't the primary CTA — second-tier calls to action |
| `Tonal with icon` / `Tonal with trailing icon` | Tonal with icon reinforcement; compact size available |
| `Outlined` | Secondary actions, cancel, back — paired with a Filled button |
| `Outlined with Icon` | Same with icon |
| `Text` | Tertiary/low-emphasis actions — inline links, "Learn more", "Skip" |
| `Text with Icon` | Same with icon |
| `Split - Filled` | Primary action with a dropdown of related sub-actions |
| `Split - Outlined` | Secondary action with dropdown sub-actions |
 
**Properties:** `Style`, `State` (Enabled/Hovered/Pressed/Disabled), `Size` (Default/Compact — Compact only on Tonal with icon), `Width` (Default/Full), `Show text`, `Type` (Round)
 
#### Icon Button
- **Usage:** Icon-only, no label. Toolbar actions, close/dismiss, navigation arrows, utility actions in dense layouts
- **Properties:** `State`, `Size` (Default / Small)
- **Rule:** Use Small size inside cards and table rows; Default in toolbars and page headers
#### Rounded Button
- **Usage:** Toggleable pill-style button for filters, quick selections, category picks. Supports active/inactive state, optional icon, optional count badge
- **Properties:** `Active`, `Icon`, `Size`, `Show count`, `Count`, `CTA`
#### Segmented Button
- **Usage:** Mutually exclusive or multi-select option groups — e.g. view toggle (List/Grid), tax type selector (ITR-1/ITR-2/ITR-4), date range (Day/Week/Month)
- **Properties:** `Segments` (2–5), `Density` (0 to −3)
- **Segment configuration:** icon only / label only / label & icon; selected/unselected per segment
- **Rule:** Never use for actions; only for mode/filter selection
#### Dropdown (button variant)
- **Usage:** A button that triggers a menu/panel. Different from a Text Field select — this is a button affordance, not a form input
- **Properties:** `Type` (Default / Large), optional leading and trailing icons, `Text`
#### Extended FAB
- **Usage:** The single primary floating action on a screen — "New Filing", "Add Client", "Upload Document". One per screen maximum
- **Properties:** `Size` (Small), `Style` (Default / Primary container), `State`, `Icon`, `Label text`
---
 
### CHECKBOXES
 
#### Checkboxes (interactive, with padding)
- **Usage:** Standard form checkbox with full touch target. Use in forms, list rows, table rows for multi-select
- **Types:** Selected / Unselected / Indeterminate; with Error variants for all three
- **States:** Enabled, Hovered, Focused, Pressed, Disabled
#### Checkboxes (without padding)
- **Usage:** Compact version for dense layouts where the parent handles touch area — e.g. inside table cells, dense list rows
- **Types:** Selected / Unselected / Indeterminate
- **States:** Enabled / Disabled only
---
 
### CHIPS
 
#### Rounded Chip
- **Usage:** The primary filter control for **list view category switching** — the top-level tabs that segment a list into its primary states. E.g. "All", "Open", "Closed" above a list of items; "Pending", "Filed", "Draft" above a filings list. These are always visible at the top of the list, not inside a filter panel
- **Properties:** `Active` (true/false), `Icon` (true/false), `Size` (Default), `Show count` (true/false), `Count`, `CTA`
- **Rule:** Use Rounded Chip for primary list-view category filters that are always visible. Do not use Filter Chip for this purpose. Rounded Chips are persistent — they represent the current view mode of the list, not a removable filter condition
#### Filter Chip
- **Usage:** Secondary/attribute filters — specific conditions that can be applied and removed from a filter panel or filter bar. E.g. filtering by date range, assignee, or tag. "Applied" = filter currently active, "Not applied" = available to apply
- **Properties:** `State` (Not applied / Applied / Disabled), optional `Show leading icon`, optional `Show trailing icon` (clear/remove)
- **Rule:** Use Filter Chips for attribute filters that can be toggled on/off. Never use Suggestion Chips for filtering. Never use Filter Chips for primary list category switching (use Rounded Chip instead)
#### Input Chip
- **Usage:** Represents a value entered into a multi-value input field — e.g. a tag in a tag input, an email in a recipient field, a selected item in a multi-select
- **Properties:** `State` (Info), `Leading icon`
- **Rule:** Appears inside a Text Field that accepts multiple values
#### Suggestion Chip
- **Usage:** AI suggestions, quick replies, autocomplete suggestions, contextual shortcuts. NOT for filtering
- **Properties:** `Style` (Elevated / Outlined), `Selected`, `Show icon`, `State`
---
 
### DATA POINT
 
Specialized components for displaying numerical/financial data. Critical for dashboards and reports.
 
#### Text Data Point
- **Usage:** Basic labeled key-value display — a metric name with its value. KPI cards, summary stats
- **Properties:** `Size` (Default / Small)
#### Trend
- **Usage:** Always used alongside a Data Point to show directional change — percentage increase/decrease, delta
- **Properties:** `Positive?` (true/false for green/red), `Active` (true/false for colored/neutral), optional `Icon?`
- **Rule:** Never show a Trend component standalone — always pair with a Data Point
#### Analytics Data Point
- **Usage:** Rich analytics display with optional formatting. Used in analytics dashboards, reports, overview cards
- **Properties:** `Size` (Body / Title), optional `Leading icon`, `Trailing icon`, `Show trend`, toggles for `Currency?`, `Percent?`, `Decimal?`
#### Financial Data Point
- **Usage:** Specifically for financial/accounting values. Shows debit/credit polarity, decimal formatting
- **Properties:** `Is credit?` (true = green/positive, false = red/negative), `Size` (Default / Small), `Trailing text`, `Show Positive/Negative`, `Decimal`
- **Rule:** This is the only component to use for transaction amounts, ledger entries, and balance displays. Do not use Analytics Data Point for financial figures
---
 
### DIALOG
 
- **Usage:** Requires user decision before proceeding. Confirmations, destructive action warnings, critical information requiring acknowledgment
- **Types:** `Default` (with action buttons) / `No action` (informational only)
- **Rule:** Use sparingly. Do not use for success states (use Snackbar instead) or for complex multi-step flows (use a dedicated page/sheet instead)
- **Token usage:** `Surface Container Overlay` background, `On Surface` for title, `On Surface Variant` for body
---
 
### DROPDOWN MENUS
 
#### Dropdown menu - Building blocks
- **What it is:** The individual row/item inside a dropdown menu, not a complete menu by itself
- **Usage:** Used to construct contextual menus, action menus, "more options" menus, select option lists
- **Properties:** `State` (Default / Hovered / Selected), `Option` text, optional `Show Leading icon`, `Show Trailing icon`, `Show supporting text`
- **Rule:** Compose full menus by stacking these building blocks in a container with `Surface Container` background and `Shape/Extra small` radius
---
 
### LABEL
 
#### Label
- **Usage:** The primary component for tagging entities in **list views** with their status, type, or category. Use Label whenever you need to show status, type, filing type, category, or any classification on a list item, table row, or card
- **Types:** `Default` (neutral), `Active` (primary), `Success` (green), `Warning` (amber), `Error` (red)
- **Properties:** `Type`, optional `Leading icon`, `Text`, `Icon`
- **Rule:** In list views, always use the Label component for status/type display — never use plain text or custom pills
- **Token usage:** Default → Surface Container; Active → Primary Container / On Primary Container; Success → Green Container / On Green Container; Warning → Amber Container / On Amber Container; Error → Error Container / On Error Container
#### Badge
- **Usage:** Count indicator on navigation items, tabs, icon buttons — shows unread/pending count
- **Properties:** `State` (Active / Inactive), `Count`
- **Rule:** Place on top-right of the element it counts. Use Active only when count > 0
#### Status labels
- **Usage:** Record/entity lifecycle status that is more prominent than a Label — e.g. a filing's submission status, a payment's processing state, an appointment's booking status
- **States:** `Active`, `Warning`, `Completed`, `Default`
- **Distinction from Label:** Status labels communicate the lifecycle stage of a record (what has happened); Labels communicate classification/type (what it is)
---
 
### RADIO
 
#### Radio buttons
- **Usage:** Single-selection from a small list of mutually exclusive options in a form
- **States:** True (selected) / False (unselected)
- **Rule:** Use when 2–5 options are visible simultaneously. Use a Dropdown for more options
#### Radio card
- **Usage:** A full card that acts as a radio option — when choices need more explanation than a label alone. E.g. plan selection (Free/Pro/Enterprise), filing type selection (ITR-1/ITR-2/ITR-4 with descriptions), configuration choices
- **Properties:** `Active?`, `Title`, `Description`, optional `Show Icon Container`
- **Rule:** Use when the user needs to understand what they're selecting, not just pick from a label list
---
 
### SIDE NAV
 
#### Side Nav item
- **Usage:** Used exclusively in the **secondary navigation** panel of the Quicko Pro workspace layout. Builds the secondary nav menu that sits alongside the main content area
- **Types:**
  - `Singular` — a direct link, no children
  - `Expandable` — a section header that expands to reveal sub-items
- **Properties:** `Active`, `Type`, optional `Show icon` (leading), optional `Show trailing icon` (for expandable chevron), `Menu item` text
- **Rule:** Never use these outside the secondary nav context. For breadcrumbs use the Breadcrumb component; for tabs use Tabs
---
 
### SNACKBAR
 
- **Usage:** Brief, non-blocking feedback that auto-dismisses. File saved, action completed, error occurred, item deleted (with undo)
- **Configurations:** `Text only` / `Text & action` / `Text & longer action` (for long CTA labels)
- **Lines:** 1 or 2
- **Properties:** `Supporting text`, `Configuration`, `# of lines`, `Show close affordance`
- **Rule:** One Snackbar at a time. Do not stack. For persistent messages use Alert Strip or Alert Tile. Do not use for errors that require user action (use Dialog instead)
---
 
### STEPPER
 
#### Duration Stepper
- **Usage:** Numeric input for time/duration values. Decrement (−) / value / unit / increment (+). E.g. "60 mins", session length, reminder intervals
- **Rule:** Use only for duration/time quantities. For other numeric input use a Text Field
---
 
### TABS
 
#### Tab
- **Usage:** In-page navigation between views at the same hierarchical level within a screen. E.g. Overview / Details / History within a record; Income / Deductions / Summary within a filing section
- **Properties:** `Active`, `Tab name`, optional `Icon?`, optional `Show count` + `Count`
- **Rule:** Use for peer-level views within a page. Never use Tabs for top-level app navigation (that's Side Nav). Use count badge on tabs to indicate pending/new items within that tab
---
 
### TEXT FIELDS
 
#### Text field
- **Usage:** All text input in forms — names, amounts, search queries, dates, descriptions, references
- **Style:** Outlined only (no filled variant)
- **States:** Enabled, Focused, Hovered, Error, Disabled
- **Text configurations:** `label-text` (value entered), `placeholder-text` (empty/hint), `input-text`
- **Properties:** `Style`, `State`, `Text configurations`, optional `Leading icon`, `Trailing icon`, `Label text`, `Placeholder text`, `Input text`, `Supporting text`, `Show supporting text`
- **Supporting text:** Used for hints (below field, `On Surface Variant`) and error messages (below field, `Error` color)
- **Rule:** Always show a label. Use supporting text for validation messages and hints. Leading icon for field-type context (search, currency, calendar); trailing icon for clear/visibility toggle actions
---
 
### TOGGLE
 
- **Usage:** Binary on/off settings — enable/disable a feature, turn notifications on/off, show/hide a panel
- **States:** True (on) / False (off)
- **Rule:** Use for settings that take effect immediately. For options within a form use Checkboxes instead
---
 
### TOOLTIPS
 
#### Plain Tooltip
- **Usage:** Brief text label providing additional context on hover for icon buttons, abbreviated text, or any element that isn't self-explanatory. Single-line for short labels; multi-line for slightly longer but still brief content
- **Types:** `Single-line` / `Multi-line`
- **Properties:** `Supporting text`
- **Rule:** Never put critical information only in a tooltip — it is inaccessible on touch devices. Use for supplementary context only
#### Rich Tooltip
- **Usage:** A richer hover card that can explain a concept, term, or feature in more depth. Used on glossary terms, help icons, feature labels that need more than a one-liner
- **Properties:** `Supporting text` (body), optional `Subhead text` (title), `Show actions` (one or two CTA buttons), `Show secondary button`, `Show subhead`
- **Distinction from Plain Tooltip:** Rich Tooltip has a title, body text, and optional actions. Use when the user needs to act on the tooltip content (e.g. "Learn more", "Got it") or when more than a single line is needed
---
 
### OBJECT STYLES
 
#### Text with Dashed Underline
- **Usage:** Interactive/explainer text — a term, amount, or label that reveals additional context on interaction (hover tooltip, expand, definition). Used for glossary terms in tax forms, fields that need inline explanation, figures that expand to show breakdown
- **Sizes:** `Single line` / `Two line` / `Just text`
- **Rule:** The dashed underline signals "this text is interactive/has more info." Do not use for regular hyperlinks (use a Text button instead)
---
 
### ICONS
 
**Icon Container is mandatory everywhere.** Every icon in the product — whether inside a component (button, nav item, chip, list row) or placed standalone — must be wrapped in the **Icon Container** component. Never place a raw icon. If a companion skill or spec names a specific icon, use that exact icon from the icons page within an Icon Container.
 
**Icon Container sizes:** 16px, 20px, 24px (default), 27px, 32px
 
**Icon sections define use cases** — each section is a board of icons for that specific context. Always pick from the section that matches your use case:
 
| Section | Use case | Sample icons |
|---|---|---|
| Special | App-specific special cases only | Placeholder, favicon, bank_account, avatar, Line indicator, Loading, linkedin, Status indicator |
| General | Everyday UI icons — actions, objects, general purpose | unchecked_circle, support_agent, storefront, sell, rocket_launch |
| Business types | Entity type icons for business records | domain, balance, monitoring, admin_panel_settings, partner_exchange |
| Modules | App navigation module icons — top-level product sections | home, calendar_month, inbox, dartboard, view_cozy, folder, group, analytics |
| Booking actions | Scheduling, calendar, and appointment actions | block, event_repeat, event_available, event_busy, calendar_clock, schedule |
| System | UI chrome and system controls — nav, notifications, utility | notifications, chat, chevrons, arrows, search, public |
| Icons | Meeting/collaboration type icons | One-on-one, Group, Document |
| File format Icons | File type indicators | JPG, PDF, EXCEL, JSON, Default file, Folder |
| App Logos | Third-party integration icons | Google Meet, Zoom, WhatsApp, Google Calendar |
 
---
 
## Entity Representation Principle
 
Whenever an entity appears in any surface — list item, card, tile, search result, chip, or header — its **primary text must answer the most identifying question for that entity type.**
 
| Entity type | Identifying question | Title = |
|---|---|---|
| Person (contact, member, client) | Who? | Person's name |
| Task / transactional (order, lead, job, filing) | What? | Subject, requirement, or nature of the work |
| Object (file, document) | What is this? | File or document name |
 
**Meta text** (secondary line, supporting detail) = everything that contextualises the title — role, date, status, type, amount. Always `On Surface Variant`, always visually subordinate to the title.
 
---
 
## Critical Rules (apply in all contexts)
 
1. **Alert Strip belongs to tiles** — always attached to the bottom of the tile it references; never free-floating
2. **Label is the only component for status/type in list views** — never use plain text, custom chips, or Status labels for list-view classification
3. **Rounded Chip for primary list category filters** — "All / Open / Closed" style top-of-list filters always use Rounded Chip, not Filter Chip
4. **Side Nav item is only for the secondary nav** — the workspace layout's left-side secondary navigation
5. **Icon Container is mandatory everywhere** — every icon, whether inside a component or standalone, must be wrapped in Icon Container; never place raw icons
6. **Always use Scheme roles in components** — not palette tones directly
7. **Font weight: Medium (500) for everything; Semibold (600) for title/medium only**
8. **All spacing is on the 4dp grid** — no exceptions
9. **Shape scale is fixed** — only the 10 defined corner radius values are valid
10. **Extended colors (Green/Amber/Gray) are semantic** — success/warning/neutral only, not decoration
11. **Tertiary (purple) is an accent** — use sparingly; never dominant on any screen
12. **Financial Data Point for money** — never use Analytics Data Point for transaction amounts or ledger values
13. **Trend always paired with a Data Point** — never standalone
14. **Plain Tooltip is touch-inaccessible** — never put critical info only in a tooltip
15. **Load material-thinking for elevation, motion, and state layer rules**
---
 
## Variable Collections Summary
 
| Collection | Purpose | Modes |
|---|---|---|
| `Q-Pro` | All color scheme roles + extended + brand + palettes | Light / Dark |
| `Typescale` | Font size, line height, tracking per role | Baseline |
| `Typeface` | Font family + weight aliases (General Sans) | Baseline / Wireframe |
| `Shape` | Corner radius scale (10 stops) | Single mode |
| `TailwindCSS` | Spacing scale (4dp grid, Tailwind-aligned) | Default |
 
---
 
## Design Workflow
 
When generating a UI screen for Quicko Pro:
 
1. **Understand the screen** — what is the primary action? What entity is being shown?
2. **Apply Entity Representation Principle** — identify the title field for all entity representations
3. **Select components** — use this skill's component library to pick the right component for every element
4. **Assign color tokens** — use Scheme roles; check Extended colors for status
5. **Assign type roles** — use the type scale; Semibold only for title/medium
6. **Apply shape + spacing** — 4dp grid, 10-stop radius scale
7. **Check both modes** — ensure the design works in Light and Dark
## Code Review Workflow
 
1. **Colors** — all colors must map to a Scheme token. Raw hex values are a violation unless they are verified Brand tokens
2. **Typography** — font-family must be `General Sans`. Sizes must match the type scale exactly (57/45/36/32/28/24/22/16/14/12/11px). Weight 500 for everything; 600 for title/medium only
3. **Border radius** — only values 0, 4, 8, 12, 16, 20, 28, 32, 48, 9999px. Any other value is a violation
4. **Spacing** — all margins, paddings, gaps must be multiples of 4px
5. **Component usage** — verify the correct component is used per the rules above (e.g. Label for list status, not custom pills)
6. **Component states** — hover/focus/pressed/disabled states must use M3 state layer rules (see `material-thinking`)