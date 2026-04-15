---
tags:
  - torque-crm
  - docs
  - design
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/superpowers/specs/2026-03-18-outbound-org-separation-design.md
---

# Outbound Organization Separation - Design Spec

**Date:** 2026-03-18
**Status:** Approved

## Problem

Organizations of type `outbound` exist in the system (`org_type` column on `organizations` table) but lack proper permission enforcement. Outbound members (clients who receive qualified leads) currently see the full CRM interface. They should see a minimal, focused experience.

Additionally, legacy roles (`agency`, `bdr`, `cliente`) still exist in the `app_role` enum despite the migration to `admin`/`member`. Code still references these stale roles in places like the Master panel.

## Context

Outbound organizations are B2B clients of the platform. The agency (admin) creates campaigns, qualifies leads, and distributes them to client organizations. Members in those client orgs use Torque only to:
- Attend to leads arriving in their funnels
- Chat via WhatsApp
- Review follow-ups
- Track their monthly progress via a dedicated dashboard

## Design

### 1. Sidebar Filtering by org_type

**File:** `src/components/layout/Sidebar.tsx`

Add a whitelist constant:

```typescript
const OUTBOUND_MEMBER_ALLOWED_PATHS = ["/", "/chat", "/pipe-confirmacao", "/pipe-propostas", "/pipe-follow-ups"];
```

Logic:
- `org_type === 'outbound'` AND `role === 'member'` → show only whitelisted paths
- `org_type === 'outbound'` AND `role === 'admin'` → show everything (no filter)
- `org_type === 'crm'` → current behavior unchanged (feature permissions system)

The `useOrganization()` hook already returns `orgType`. No new hooks needed.

Remove unused references to `client_sidebar_permissions` in frontend code. The database table can remain (no migration needed to drop it).

### 2. Dashboard Outbound for Members

**Routing in `Dashboard.tsx`:**
- `org_type === 'outbound'` AND `role === 'member'` → render `<DashboardOutbound />`
- `org_type === 'outbound'` AND `role === 'admin'` → standard dashboard
- `org_type === 'crm'` → standard dashboard (no change)

**New component: `src/pages/DashboardOutbound.tsx`**

Layout with 3 sections:

#### Section 1: Metric Cards (top row)
| Metric | Source | Filter |
|--------|--------|--------|
| Leads recebidos | `leads` table | `created_at` in current month, entered pipe qualificacao (not propostas) |
| Taxa de resposta | `leads` + `conversations` | % leads with at least 1 reply vs total approached |
| Reunioes agendadas | `pipe_confirmacao` | current month count |
| Vendas fechadas | `pipe_propostas` where status = vendido | current month count |

Each card shows: current value, comparison vs previous month (arrow up/down).

#### Section 2: Monthly Milestones (speedometer-style)
- Vertical list of milestones configured by org admin
- Each milestone: icon + name + state (achieved/pending)
- Achieved: highlight color, checkmark, subtle animation
- When achieved: auto-unlock corresponding badge + toast notification
- Data source: `badges` table (where `is_system = false` or criteria-based) + `user_badges`

#### Section 3: Badges Grid
- Grid showing all badges (unlocked and locked)
- Locked badges: grayscale/opacity
- Unlocked: full color with unlock date
- New unlock: celebration animation
- Data source: `badges` + `user_badges` (existing tables and hooks)

### 3. Milestone & Badge Configuration (Admin Outbound)

**Location:** New section in Settings page, visible only when `org_type === 'outbound'` AND `role === 'admin'`.

#### Milestones Tab
Admin creates/edits/deletes milestones. Each milestone has:
- `name` (string) - display name
- `icon` (string) - from predefined icon set (~8 options)
- `criteria_type` (enum) - one of:
  - `leads_recebidos` - leads entering qualification pipe
  - `leads_respondidos` - leads with replies
  - `reunioes_agendadas` - meetings scheduled
  - `vendas_count` - sales closed
  - `faturamento_total` - total revenue (R$)
- `criteria_value` (number) - target value to achieve

When a milestone is created, a corresponding `badges` row is created automatically with `is_system = false`.

#### Manual Badges
Admin can also create standalone badges (not tied to milestones). These are manually unlocked by the admin from the Team page (select member → grant badge).

Uses existing infrastructure: `badges` + `user_badges` + `useCreateBadge()`, `useUnlockBadge()`, `useDeleteBadge()`.

#### Auto-unlock Logic
Client-side check when loading `DashboardOutbound`:
1. Query current month metrics for the member
2. Query milestones (badges with criteria) for the org
3. Compare metrics vs criteria values
4. For any milestone met but not yet in `user_badges`: insert into `user_badges` + show toast

No edge function or cron needed - check runs on dashboard load.

### 4. Role Standardization & Cleanup

**Roles for both org types:** `admin` and `member` only.

**Visual differentiation:** Use `job_title` column (already exists on `team_members`) for human-readable role display (e.g., "BDR", "Closer", "SDR", "Cliente").

**Master Panel changes:**
- When creating users: offer only `admin` / `member` as role dropdown
- Add `job_title` text field for the display name
- Remove conditional role lists based on org_type (no more agency/bdr/cliente selection)

**Equipe page changes:**
- Same: role = admin/member, job_title = free text
- Show job_title in member cards/list

**Code cleanup:**
- Remove conditionals checking for `agency`, `bdr`, `cliente`, `sdr`, `closer` roles
- Replace with `org_type` + `role` (admin/member) checks where needed
- Do NOT alter the database enum (removing enum values is destructive and could break historical data)

## Files to Modify

### Core Changes
- `src/components/layout/Sidebar.tsx` - whitelist filter for outbound members
- `src/pages/Dashboard.tsx` - routing to DashboardOutbound
- `src/pages/DashboardOutbound.tsx` - **new file**
- `src/pages/Settings.tsx` - add Milestones & Badges section for outbound admin

### Configuration Components
- `src/components/settings/MilestonesConfig.tsx` - **new file**
- `src/components/settings/BadgesConfig.tsx` - already exists, may need minor updates

### Dashboard Components
- `src/components/dashboard-outbound/MetricCards.tsx` - **new file**
- `src/components/dashboard-outbound/MilestoneTracker.tsx` - **new file**
- `src/components/dashboard-outbound/BadgeGrid.tsx` - **new file**

### Hooks
- `src/hooks/useOutboundMetrics.ts` - **new file**, queries for leads/response rates/meetings/sales
- `src/hooks/useMilestones.ts` - **new file**, CRUD for milestones + auto-unlock logic
- `src/hooks/useBadges.ts` - already exists, may need minor updates

### Role Cleanup
- `src/pages/master/MasterUsers.tsx` - simplify role selection
- `src/pages/master/MasterOrganizations.tsx` - remove outbound-specific role logic
- `src/pages/Equipe.tsx` - add job_title field, simplify role dropdown
- `src/hooks/useUserRole.ts` - remove legacy role checks
- `src/hooks/useMasterOrganizations.ts` - remove DEFAULT_SIDEBAR_PERMISSIONS logic

### No Database Migrations Needed
- `badges` and `user_badges` tables already exist
- `org_type` column already exists on `organizations`
- `job_title` column already exists on `team_members`
- `app_role` enum kept as-is (no destructive changes)

## Out of Scope
- Removing `client_sidebar_permissions` table from database
- Altering `app_role` enum values
- Outbound-specific onboarding flow
- Email/push notifications for badge unlocks (only toast for now)
- Per-organization sidebar customization (all outbound members see same 4 modules)


## Links relacionados

- [[MOC - Arquitetura]]

- [[Dashboard Outbound]]

- [[Gestao de Time]]

- [[Onboarding]]

- [[Dashboard]]

- [[Pipe Propostas]]

- [[Pipe Confirmacao]]

- [[WhatsApp Evolution]]

- [[00 - INDEX]]
