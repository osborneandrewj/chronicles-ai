# Frontend Architecture

## 1. Overview

The frontend is a Next.js 15 App Router application using React Server Components for data fetching and Client Components for interactivity. It is designed as a Progressive Web App (PWA) targeting both desktop and mobile browsers.

### Design Principles
- **Story-first**: The narrative feed dominates the viewport. Everything else is secondary.
- **Server Components by default**: Only add `"use client"` when interactivity is required.
- **Progressive enhancement**: Core read experience works without JavaScript. Interactive features (streaming, input) require JS.
- **Mobile-native feel**: Touch-friendly, stacked navigation on mobile, sidebar on desktop.

## 2. Routing Structure

```
src/app/
├── layout.tsx                    # Root layout: fonts, global CSS, providers
├── page.tsx                      # Landing page → redirect to /worlds
├── globals.css                   # Tailwind imports + CSS variables
│
├── worlds/
│   ├── page.tsx                  # World list (Server Component)
│   ├── new/
│   │   └── page.tsx              # Create world form (Server Component + Client form)
│   └── [worldId]/
│       ├── layout.tsx            # World layout: shared header/nav
│       ├── page.tsx              # World dashboard (Server Component)
│       ├── play/
│       │   └── page.tsx          # Story play page (Server + Client Components)
│       ├── wiki/                 # Phase 2
│       │   ├── page.tsx          # Wiki index
│       │   └── [pageId]/
│       │       └── page.tsx      # Wiki page detail
│       ├── timeline/             # Phase 2
│       │   └── page.tsx          # Timeline view
│       ├── characters/           # Phase 2
│       │   └── page.tsx          # Character list
│       └── settings/             # World settings
│           └── page.tsx
│
├── auth/                         # Phase 4
│   ├── login/page.tsx
│   └── signup/page.tsx
│
└── api/
    └── story/stream/route.ts     # SSE streaming endpoint
```

### Route Types

| Route | Component Type | Data Loading | Interactive |
|-------|---------------|-------------|-------------|
| `/worlds` | Server | `listWorlds()` | No (links only) |
| `/worlds/new` | Server + Client | None | Yes (form) |
| `/worlds/[id]` | Server | `getWorld()` | No |
| `/worlds/[id]/play` | Server + Client | `getStoryState()` | Yes (streaming + input) |
| `/worlds/[id]/wiki` | Server | `listWikiPages()` | No |
| `/worlds/[id]/timeline` | Server | `getTimeline()` | No |

## 3. Component Hierarchy

### 3.1 Play Page (the main UI)

```
PlayPage (Server Component)
│ ← Fetches: world, scene, character, turns
│
├── WorldHeader
│   ├── World name + genre badge
│   ├── Scene title
│   └── Navigation (back to dashboard)
│
├── StoryContainer (Client Component - "use client")
│   │ ← Manages: useChat(), streaming state
│   │
│   ├── StoryFeed
│   │   ├── SceneOpening
│   │   │   └── "Scene 1: The Rusty Anchor"
│   │   │
│   │   ├── TurnEntry (player_action)
│   │   │   └── "> Elara: I push open the tavern door..."
│   │   │
│   │   ├── TurnEntry (narrator_response)
│   │   │   └── "The door groans as you shoulder it open..."
│   │   │
│   │   ├── TurnEntry (player_action)
│   │   │   └── "> Elara: I look around the room..."
│   │   │
│   │   └── StreamingTurn (active, if streaming)
│   │       └── "The tavern is dimly lit, smel|" ← cursor
│   │
│   └── StoryInput
│       ├── Textarea (auto-resize)
│       ├── Submit button
│       └── Character name label ("Playing as Elara")
│
└── Sidebar (desktop only, Phase 2+)
    ├── TabNav: Wiki | Timeline | Characters | Threads
    ├── WikiPanel
    │   └── WikiPageList → WikiPagePreview
    ├── TimelinePanel
    │   └── TimelineEventList → TimelineEvent
    ├── CharacterPanel
    │   └── CharacterList → CharacterCard
    └── ThreadPanel
        └── ThreadList → ThreadItem
```

### 3.2 Component Inventory

#### Core Components (Phase 1)

| Component | Type | File | Purpose |
|-----------|------|------|---------|
| `StoryContainer` | Client | `components/story/StoryContainer.tsx` | Manages `useChat()`, passes state to children |
| `StoryFeed` | Client | `components/story/StoryFeed.tsx` | Scrolling turn display with auto-scroll |
| `StoryInput` | Client | `components/story/StoryInput.tsx` | Player action textarea + submit |
| `TurnEntry` | Client | `components/story/TurnEntry.tsx` | Renders a single turn (player or narrator) |
| `StreamingTurn` | Client | `components/story/StreamingTurn.tsx` | Renders in-progress narrator response |
| `WorldCard` | Server | `components/world/WorldCard.tsx` | World preview in list view |
| `CreateWorldForm` | Client | `components/world/CreateWorldForm.tsx` | World creation form |
| `WorldHeader` | Server | `components/world/WorldHeader.tsx` | World name, scene, nav |

#### Knowledge Components (Phase 2)

| Component | Type | File | Purpose |
|-----------|------|------|---------|
| `Sidebar` | Client | `components/sidebar/Sidebar.tsx` | Tabbed sidebar container |
| `WikiPanel` | Server | `components/sidebar/WikiPanel.tsx` | Wiki page list |
| `WikiPageView` | Server | `components/sidebar/WikiPageView.tsx` | Wiki page content |
| `TimelinePanel` | Server | `components/sidebar/TimelinePanel.tsx` | Timeline event list |
| `CharacterPanel` | Server | `components/sidebar/CharacterPanel.tsx` | Character cards |
| `ThreadPanel` | Server | `components/sidebar/ThreadPanel.tsx` | Story thread list |

## 4. UI Wireframes

### 4.1 Play Page — Desktop

```
┌─────────────────────────────────────────────────────────────────────┐
│  ◄ Back    The Shattered Isles    [Fantasy]    Scene: The Rusty Anchor  │
├─────────────────────────────────────────┬───────────────────────────┤
│                                         │                           │
│  ═══ Scene 1: The Rusty Anchor ═══      │  Wiki | Timeline | Chars  │
│                                         │  ─────────────────────── │
│  The port town of Haven greets you      │                           │
│  with salt-crusted cobblestones and     │  ▸ The Rusty Anchor       │
│  the cry of gulls overhead...           │    A weathered tavern on  │
│                                         │    the docks of Haven...  │
│  > Elara: I push open the tavern door   │                           │
│  and scan the room for anyone who       │  ▸ Grim                   │
│  looks like they've been at sea.        │    Former soldier, now a  │
│                                         │    dock worker. Scarred.  │
│  The door groans as you shoulder it     │                           │
│  open. Inside, the air is thick with    │  ▸ Haven                  │
│  pipe smoke and the low murmur of       │    Port town on the       │
│  conversation. A broad-shouldered man   │    southern coast...       │
│  at the far end of the bar glances      │                           │
│  up — his face is weathered, a long     │                           │
│  scar running from temple to jaw...     │                           │
│                                         │                           │
│  > Elara: I approach the scarred man    │                           │
│  and ask if he knows anything about     │                           │
│  the shipwrecks.                        │                           │
│                                         │                           │
│  The man's eyes narrow as you           │                           │
│  approach. He sets down his mug with    │                           │
│  deliberate slowness. "Shipwrecks?"     │                           │
│  His voice is gravel. "Depends who's█   │                           │
│                                         │                           │
├─────────────────────────────────────────┤                           │
│  Playing as Elara                       │                           │
│  ┌───────────────────────────────────┐  │                           │
│  │ What do you do?                   │  │                           │
│  │                                   │  │                           │
│  └───────────────────────────────────┘  │                           │
│                               [Submit]  │                           │
└─────────────────────────────────────────┴───────────────────────────┘
```

### 4.2 Play Page — Mobile

```
┌───────────────────────────┐
│  ◄  The Shattered Isles   │
│  Scene: The Rusty Anchor   │
├───────────────────────────┤
│                            │
│  ═ Scene 1: The Rusty ═    │
│  ═ Anchor ═                │
│                            │
│  The port town of Haven    │
│  greets you with salt-     │
│  crusted cobblestones...   │
│                            │
│  > Elara: I push open the  │
│  tavern door and scan the  │
│  room.                     │
│                            │
│  The door groans as you    │
│  shoulder it open. Inside, │
│  the air is thick with     │
│  pipe smoke and the low    │
│  murmur of conversation... │
│                            │
│  > Elara: I approach the   │
│  scarred man.              │
│                            │
│  The man's eyes narrow as  │
│  you approach. "Ship-      │
│  wrecks?" His voice is     │
│  gravel. "Depends who's█   │
│                            │
├───────────────────────────┤
│  As Elara:                 │
│  ┌───────────────────────┐ │
│  │ What do you do?       │ │
│  └───────────────────────┘ │
│                   [Submit]  │
├───────────────────────────┤
│  📖 Wiki  📅 Time  👤 Chars │
└───────────────────────────┘
```

### 4.3 World List

```
┌─────────────────────────────────────────────────────────────┐
│  Chronicles AI                                    [+ New World] │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────┐  ┌──────────────────────┐        │
│  │  The Shattered Isles  │  │  Neon Requiem         │        │
│  │  Fantasy · Gritty     │  │  Cyberpunk · Noir     │        │
│  │                       │  │                       │        │
│  │  A world of island    │  │  The rain never stops │        │
│  │  kingdoms torn apart  │  │  in New Kyoto. The    │        │
│  │  by an ancient war... │  │  corporations run...  │        │
│  │                       │  │                       │        │
│  │  47 turns · 2h ago    │  │  12 turns · 3d ago    │        │
│  │           [Continue ▶]│  │           [Continue ▶]│        │
│  └──────────────────────┘  └──────────────────────┘        │
│                                                              │
│  ┌──────────────────────┐                                   │
│  │  The Last Garden      │                                   │
│  │  Horror · Atmospheric │                                   │
│  │                       │                                   │
│  │  Something is wrong   │                                   │
│  │  with the garden...   │                                   │
│  │                       │                                   │
│  │  5 turns · 1w ago     │                                   │
│  │           [Continue ▶]│                                   │
│  └──────────────────────┘                                   │
└─────────────────────────────────────────────────────────────┘
```

### 4.4 Create World

```
┌─────────────────────────────────────────────────────────────┐
│  ◄ Back                Create a New World                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  World Name                                                  │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ The Shattered Isles                                     ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  Premise                                                     │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ A world of island kingdoms scattered across an endless  ││
│  │ sea, torn apart by an ancient war between two gods.     ││
│  │ Magic exists but is feared. Sailing between islands is  ││
│  │ dangerous — sea monsters, pirates, and worse lurk in    ││
│  │ the deep channels between the shattered lands...        ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  Genre                         Tone                          │
│  ┌──────��────────────┐        ┌───────────────────┐         │
│  │ Fantasy         ▼ │        │ Gritty          ▼ │         │
│  └───────────────────┘        └───────────────────┘         │
│                                                              │
│  Your Character Name                                         │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Elara                                                   ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  Character Description (optional)                            │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ A former cartographer's apprentice who lost everything  ││
│  │ when the Drift swallowed her home island...             ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│                                        [Begin Your Story ▶]  │
└─────────────────────────────────────────────────────────────┘
```

## 5. State Management

### 5.1 Server State (React Query / Server Components)

Most data is server state — fetched on the server and rendered via Server Components. No client-side cache needed for:
- World list (re-fetched on navigation)
- World details (re-fetched on navigation)
- Wiki pages (re-fetched on navigation)
- Timeline (re-fetched on navigation)

### 5.2 Streaming State (Vercel AI SDK `useChat`)

The `useChat()` hook manages:
- `messages[]` — accumulated turn history (synced with streamed tokens)
- `input` — current textarea value
- `isLoading` — whether a stream is active
- `error` — stream error state
- `handleSubmit()` — form submission handler
- `handleInputChange()` — controlled textarea handler

### 5.3 Client State (React useState)

Minimal client state for Phase 1:
- `sidebarOpen: boolean` (desktop sidebar toggle)
- `sidebarTab: string` (Phase 2: active sidebar tab)

No Zustand or global state store until Phase 3+.

## 6. Styling Strategy

### Tailwind CSS
- Utility-first styling
- Dark mode support via `class` strategy (toggle via CSS variable)
- Custom color palette for story UI (warm, immersive tones)

### shadcn/ui Components
- Button, Input, Textarea, Card, Badge, Select, Tabs, ScrollArea, Separator
- Customized via CSS variables, not component overrides
- Installed as source code (`components/ui/`), not npm dependency

### Custom CSS Variables

```css
/* globals.css */
:root {
  --color-narrator: #1a1a2e;        /* Narrator text background */
  --color-player: #16213e;          /* Player action background */
  --color-scene: #0f3460;           /* Scene heading background */
  --color-accent: #e94560;          /* Interactive elements */
  --color-surface: #0a0a0f;         /* Page background */
  --color-text: #e0e0e0;            /* Primary text */
  --color-text-muted: #888;         /* Secondary text */
}
```

### Typography
- Story prose: serif font (Georgia or similar) for immersive reading
- UI elements: system font stack (sans-serif) for clarity
- Player actions: monospace or italic serif to differentiate from narrator

## 7. Responsive Design

### Breakpoints

| Breakpoint | Width | Layout |
|-----------|-------|--------|
| Mobile | < 768px | Single column, bottom tabs, no sidebar |
| Tablet | 768-1024px | Single column, collapsible sidebar |
| Desktop | > 1024px | Two columns (story + sidebar) |

### Mobile Adaptations
- Sidebar becomes bottom tab bar (Wiki, Timeline, Characters)
- Tapping a tab opens a full-screen overlay
- Story input stays fixed at bottom
- Story feed uses full viewport width
- No horizontal padding — maximize reading width

### Desktop Adaptations
- Sidebar occupies ~30% of viewport on right side
- Story feed occupies ~70% on left side
- Sidebar is collapsible (toggle button)
- Story input is fixed at bottom of story column

## 8. Accessibility

### Keyboard Navigation
- Tab through: input → submit → sidebar tabs → sidebar content
- Enter submits the action (Shift+Enter for newline)
- Escape closes sidebar overlays on mobile

### Screen Reader Support
- Story feed uses `role="log"` with `aria-live="polite"` for new turns
- Streaming text uses `aria-live="polite"` (not "assertive" — would be too noisy)
- Turn entries use semantic markup (`<article>` with appropriate headings)
- Player/narrator turns are labeled with `aria-label`

### Visual
- Minimum 4.5:1 contrast ratio for all text
- Focus indicators on all interactive elements
- No information conveyed by color alone (type labels supplement color coding)

## 9. Performance

### Critical Rendering Path
1. Server renders page shell + initial turns (Server Component)
2. Client hydrates `StoryContainer` (Client Component)
3. `useChat()` initializes with pre-loaded turns (no additional fetch)
4. Page is interactive

### Optimizations
- **Server Components**: world list, wiki, timeline rendered on server (zero client JS)
- **Streaming SSR**: play page streams HTML as turns are fetched
- **Dynamic imports**: sidebar tabs lazy-loaded on desktop (`next/dynamic`)
- **Scroll virtualization**: if turn count exceeds 200, virtualize the feed (Phase 2+, `@tanstack/react-virtual`)
- **Image optimization**: not applicable for MVP (text-only), but `next/image` ready for future character portraits
