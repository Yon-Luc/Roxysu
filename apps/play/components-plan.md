# GPUIX UI — Shadcn-style Component Plan

## 1. Core Philosophy

Build a **shadcn/ui-style component system for GPUIX**, while keeping it fully native to GPUIX rather than trying to reproduce the web/CSS stack.

The project should follow four principles:

1. **Source-first** — components live in the user's project and can be modified.
2. **Composable** — components are assembled from smaller primitives.
3. **Headless where appropriate** — behavior and styling are separated.
4. **GPUIX-native** — no DOM, Tailwind CSS, CSS, Radix UI, or Base UI dependency.

Conceptually:

```text
@gpuix/react
      │
      ▼
┌─────────────────────┐
│   GPUIX primitives  │
│                     │
│ events / focus      │
│ positioning         │
│ inputs              │
│ overlays            │
│ layout              │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│      gpuix-ui       │
│                     │
│ Button              │
│ Card                │
│ Dialog              │
│ Select              │
│ Tabs                │
│ Dropdown            │
│ ...                 │
└──────────┬──────────┘
           │
           ▼
       Application
```

## 2. Foundation

Before implementing many components, build the infrastructure.

### Theme

```text
theme/
├── colors.ts
├── spacing.ts
├── radius.ts
├── typography.ts
├── shadows.ts
└── theme.ts
```

Example:

```typescript
const theme = {
  colors: {
    background: "#09090b",
    foreground: "#fafafa",

    primary: "#fafafa",
    primaryForeground: "#18181b",

    secondary: "#27272a",
    secondaryForeground: "#fafafa",

    muted: "#27272a",
    mutedForeground: "#a1a1aa",

    destructive: "#ef4444",

    border: "#27272a",
  },

  radius: {
    sm: 6,
    md: 8,
    lg: 12,
  },

  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },
}
```

This replaces much of what Tailwind's design tokens normally provide.

## 3. Variant System

Build a reusable variant system similar to CVA, but designed for GPUIX styles.

```typescript
const buttonVariants = variants({
  base: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.md,
  },

  variants: {
    variant: {
      default: {...},
      destructive: {...},
      outline: {...},
      secondary: {...},
      ghost: {...},
      link: {...},
    },

    size: {
      sm: {...},
      md: {...},
      lg: {...},
      icon: {...},
    },
  },

  defaultVariants: {
    variant: "default",
    size: "md",
  },
})
```

Usage:

```tsx
<Button variant="destructive" size="sm">
  Delete
</Button>
```

The goal is to provide the shadcn/CVA developer experience without CSS classes.

## 4. Style Composition

Shadcn commonly uses `cn()` for composing classes.

GPUIX should have a style equivalent:

```tsx
style={mergeStyles(
  baseStyle,
  variantStyle,
  props.style,
)}
```

Potential API:

```typescript
mergeStyles(
  styles.button,
  styles.primary,
  props.style
)
```

Ideally support dynamic state:

```tsx
style={(state) => ({
  ...base,

  ...(state.hovered && hover),
  ...(state.active && active),
  ...(state.focused && focus),
})}
```

This should become a foundational utility for the component system.

## 5. Component Roadmap

Don't implement everything immediately. Split work into phases.

### Phase 1 — Foundation Components

These establish the visual language:

- Button
- IconButton
- Text
- Heading
- Label
- Separator
- Badge
- Spinner

**Button variants:**

- default
- destructive
- outline
- secondary
- ghost
- link

**Sizes:**

- sm
- md
- lg
- icon

**States:**

- hover
- active
- focused
- disabled
- loading

## 6. Layout Components

Make applications pleasant to compose:

- Stack
- HStack
- VStack
- Center
- Container
- Spacer
- Grid

Example:

```tsx
<VStack gap="md">
  <Heading>Beatmap</Heading>

  <HStack gap="sm">
    <Button>Play</Button>
    <Button variant="outline">Analyze</Button>
  </HStack>
</VStack>
```

This can go beyond shadcn because GPUIX isn't constrained by CSS. Explicit layout primitives can provide a very clean native API.

## 7. Form Components

- Input
- Textarea
- Label
- Field
- Form
- Checkbox
- RadioGroup
- Switch
- Slider

Example:

```tsx
<Field>
  <Label>Username</Label>
  <Input placeholder="Enter username" />
</Field>
```

Eventually:

```tsx
<Form>
  <Field>
    <Label>Beatmap</Label>
    <Input />
  </Field>

  <Field>
    <Label>Difficulty</Label>
    <Select />
  </Field>

  <Button>Analyze</Button>
</Form>
```

## 8. Container Components

Implement the classic shadcn Card composition model:

- Card
- CardHeader
- CardTitle
- CardDescription
- CardContent
- CardFooter

Example:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Roxysu</CardTitle>
    <CardDescription>
      Beatmap analysis
    </CardDescription>
  </CardHeader>

  <CardContent>
    ...
  </CardContent>

  <CardFooter>
    <Button>Analyze</Button>
  </CardFooter>
</Card>
```

This is where the library starts feeling like shadcn.

## 9. Overlay System

This should be a major milestone.

Build:

- Tooltip
- Popover
- DropdownMenu
- ContextMenu
- Dialog
- AlertDialog
- Sheet
- Command

These should rely on GPUIX's native positioning/anchoring primitives rather than browser portals.

Architecture:

```text
Trigger
   │
   ▼
Overlay primitive
   │
   ├── positioning
   ├── focus
   ├── dismissal
   └── keyboard handling
          │
          ▼
       Styling
```

The goal is to create a reusable overlay foundation that every popup-style component can share.

## 10. Selection Components

GPUIX already has relevant primitive functionality here.

Build polished wrappers for:

- Select
- Combobox
- Autocomplete
- DropdownMenu
- Command

Example:

```tsx
<Select>
  <SelectTrigger>
    <SelectValue placeholder="Select difficulty" />
  </SelectTrigger>

  <SelectContent>
    <SelectItem value="easy">Easy</SelectItem>
    <SelectItem value="hard">Hard</SelectItem>
  </SelectContent>
</Select>
```

## 11. Navigation Components

- Tabs
- NavigationMenu
- Breadcrumb
- Pagination
- Menubar
- Sidebar

For Roxysu specifically, Tabs and Sidebar are likely to be high-value components.

## 12. Data Display

- Table
- List
- Avatar
- Progress
- Skeleton
- ScrollArea
- Empty

Example:

```tsx
<Empty
  title="No beatmaps found"
  description="Try another search."
  action={<Button>Refresh</Button>}
/>
```

## 13. Feedback Components

- Alert
- Toast
- Progress
- Spinner
- Skeleton
- Empty
- ErrorState

These should share common state and styling primitives.

## 14. Advanced Components

Implement these after the core system is stable:

- Calendar
- DatePicker
- Carousel
- Accordion
- Collapsible
- Drawer
- Resizable

## 15. Target Component Set

```text
FOUNDATION
├── Button
├── IconButton
├── Badge
├── Separator
├── Spinner
├── Skeleton
├── Typography
└── Label

LAYOUT
├── Stack
├── HStack
├── VStack
├── Center
├── Container
├── Grid
└── Spacer

FORMS
├── Input
├── Textarea
├── Field
├── Form
├── Checkbox
├── RadioGroup
├── Switch
├── Slider
└── Label

CONTAINERS
├── Card
├── CardHeader
├── CardTitle
├── CardDescription
├── CardContent
└── CardFooter

OVERLAYS
├── Tooltip
├── Popover
├── Dialog
├── AlertDialog
├── Sheet
├── DropdownMenu
├── ContextMenu
└── Command

SELECTION
├── Select
├── Combobox
└── Autocomplete

NAVIGATION
├── Tabs
├── Sidebar
├── Breadcrumb
├── Pagination
├── Menubar
└── NavigationMenu

DATA
├── Table
├── List
├── Avatar
├── Progress
├── ScrollArea
└── Empty

FEEDBACK
├── Alert
├── Toast
├── Loading
├── Skeleton
└── ErrorState

ADVANCED
├── Accordion
├── Collapsible
├── Calendar
├── DatePicker
├── Carousel
├── Drawer
└── Resizable
```

## 16. Source-first CLI

This is the most important shadcn-inspired feature.

Instead of installing an opaque component package:

```bash
npx shadcn add button
```

Provide:

```bash
bunx gpuix-ui add button
```

This creates:

```text
src/
└── components/
    └── ui/
        └── button.tsx
```

Multiple components:

```bash
bunx gpuix-ui add button card dialog input
```

Result:

```text
src/components/ui/
├── button.tsx
├── card.tsx
├── dialog.tsx
└── input.tsx
```

The component becomes application-owned source code. The runtime should not require `@gpuix/ui` just to render a copied component.

## 17. Configuration

Use a small configuration file:

```json
{
  "components": "./src/components/ui",
  "theme": "./src/theme",
  "aliases": {
    "ui": "@/components/ui",
    "theme": "@/theme"
  }
}
```

Then `bunx gpuix-ui add button` knows exactly where to put the component.

## 18. Themes

Provide a token-based theme system.

Potential presets:

```text
themes/
├── zinc
├── slate
├── neutral
├── stone
└── custom
```

Users should be able to modify tokens directly:

- `theme.colors.primary`
- `theme.colors.background`
- `theme.radius.md`

For Roxysu, possible themes could include:

```text
Roxysu
├── dark
├── light
└── oled
```

## 19. Documentation

Build documentation similar to shadcn:

```text
GPUIX UI

Introduction
Installation
Theming
Styling
Composition
Variants

Components
  Button
  Card
  Input
  Dialog
  Select
  ...
```

Each component page should contain:

**Preview**

```text
┌──────────────────────────────┐
│                              │
│       [ Analyze Map ]        │
│                              │
└──────────────────────────────┘
```

**Usage**

```tsx
<Button>
  Analyze Map
</Button>
```

**API**

- variant
- size
- disabled
- loading
- style
- children

**Source**

Show the complete component implementation so users understand and can customize it.

## 20. Testing Strategy

Each component should have a predictable structure:

```text
component/
├── button.tsx
├── button.test.tsx
└── button.example.tsx
```

Basic tests:

- renders
- accepts children
- variants
- disabled state
- hover
- active
- keyboard interaction
- focus
- event propagation
- composition

Interactive primitives should additionally test:

- keyboard navigation
- focus management
- dismissal
- positioning
- nested components

Visual/regression testing should eventually be part of the project as well.

## 21. Architectural Rule

The most important architectural rule:

```text
┌─────────────────────────┐
│       Component         │
│                         │
│ Button                  │
│ Dialog                  │
│ Select                  │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│      GPUIX primitive    │
│                         │
│ behavior                │
│ events                  │
│ focus                   │
│ positioning             │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│      GPUIX renderer     │
└─────────────────────────┘
```

Components should never depend on web APIs.

Avoid:

- `document`
- `window`
- `HTMLElement`
- CSS
- `className`
- DOM events
- Radix UI
- Base UI

Everything should remain usable inside a native GPUIX application.

## 22. MVP

Do not implement every component immediately.

The first usable release (v0.1) should contain:

**Infrastructure**

- Theme
- Variants
- Style utilities

**Foundation**

- Button
- IconButton
- Badge
- Separator

**Layout**

- Stack
- HStack
- VStack

**Forms**

- Input
- Textarea
- Label
- Field

**Containers**

- Card

**Inputs**

- Checkbox
- Switch

**Overlays**

- Tooltip
- Popover
- Dialog

**Selection**

- Select
- Combobox

**Navigation**

- Tabs

This is enough to build a real application.

### v0.2

Add:

- DropdownMenu
- ContextMenu
- Command
- Toast
- Alert
- Table
- Sidebar
- ScrollArea
- Progress
- Skeleton
- Accordion

### v0.3

Add:

- Calendar
- DatePicker
- Carousel
- Drawer
- Resizable
- NavigationMenu

And other advanced components based on real application needs.

## 23. Project Structure

A possible repository:

```text
gpuix-ui/
├── packages/
│   ├── core/
│   │   ├── variants/
│   │   ├── styles/
│   │   ├── theme/
│   │   └── utilities/
│   │
│   ├── primitives/
│   │   ├── overlay/
│   │   ├── focus/
│   │   ├── selection/
│   │   └── positioning/
│   │
│   └── components/
│       ├── button/
│       ├── card/
│       ├── input/
│       ├── dialog/
│       ├── select/
│       └── ...
│
├── cli/
│   └── gpuix-ui.ts
│
├── docs/
│
└── examples/
    └── showcase/
```

The important distinction is that the distributed component templates can be separate from the internal development package.

## 24. Development Workflow

A good workflow would be:

```text
1. Implement primitive
        ↓
2. Implement styled component
        ↓
3. Add variants
        ↓
4. Add interaction tests
        ↓
5. Add showcase example
        ↓
6. Add CLI template
        ↓
7. Add documentation
```

For an interactive component:

```text
Behavior
   ↓
Primitive
   ↓
State
   ↓
Styling
   ↓
Composition
   ↓
Tests
```

## 25. Roxysu Integration

For the Roxysu VSRG/analyzer application, `@roxysu/ui` could eventually become the first real consumer.

Example:

```tsx
import {
  Button,
  Card,
  Badge,
  Input,
  Select,
  Tabs,
  Dialog,
  Sidebar,
} from "@/components/ui"

<Card>
  <CardHeader>
    <CardTitle>Roxysu Analyzer</CardTitle>

    <Badge variant="success">
      Ready
    </Badge>
  </CardHeader>

  <CardContent>
    <Input placeholder="Search beatmaps..." />
  </CardContent>

  <CardFooter>
    <Button>
      Analyze
    </Button>
  </CardFooter>
</Card>
```

The application gets a consistent design language without Tailwind or browser UI dependencies.

## 26. Long-term Goal

The project should make GPUIX feel like a mature application UI framework:

```text
GPUIX
  │
  │ native React → GPUI rendering
  ▼
GPUIX UI
  │
  ├── design tokens
  ├── variants
  ├── headless primitives
  ├── accessible interaction patterns
  ├── composable components
  ├── source-first CLI
  └── documentation
       │
       ▼
   Native desktop apps
```

The goal is not to recreate Tailwind, Radix, or Base UI.

The goal is to take the best architectural ideas from the shadcn ecosystem and build them around GPUIX's native rendering model.

## 27. Guiding Principle

GPUIX provides the rendering engine. GPUIX UI provides the compositional design system. The application owns the final component source.

That should be the central philosophy of the project.
