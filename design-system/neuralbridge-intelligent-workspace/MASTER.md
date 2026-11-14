# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** NeuralBridge Intelligent Workspace
**Generated:** 2026-10-31 21:31:15
**Category:** Developer Tool / IDE
**Design Dials:** Variance 6/10 (Balanced / Modern) | Motion 4/10 (Standard) | Density 7/10 (Standard)

---

## Global Rules

### Color Palette

> **Identidade oficial, aprovada em 2026-11-01:** preto neutro com laranja. Os valores vêm de `apps/desktop/src/renderer/src/styles.css`, que é a fonte de verdade.

| Role | Escuro | Claro | CSS Variable |
|------|--------|-------|--------------|
| Background | `#000000` | `#F5F7FB` | `--background` |
| Foreground | `#F2F2F2` | `#182033` | `--foreground` |
| Sidebar | `#080808` | `#EDF1F8` | `--sidebar` |
| Card | `#111111` | `#FFFFFF` | `--card` |
| Popover | `#161616` | `#FFFFFF` | `--popover` |
| Primary | `#F97316` | `#EA580C` | `--primary` |
| On Primary | `#FFFFFF` | `#FFFFFF` | `--primary-foreground` |
| Secondary / Muted | `#1B1B1B` | `#E5E9F3` | `--secondary`, `--muted` |
| Muted Foreground | `#A3A3A3` | `#59657B` | `--muted-foreground` |
| Accent | `#232323` | `#FFEDD5` | `--accent` |
| Border | `#2F2F2F` | `#D8DEEA` | `--border` |
| Input | `#3A3A3A` | `#C2CBD9` | `--input` |
| Destructive | `#F87171` | `#C24141` | `--destructive` |
| Warning | `#FBBF24` | `#9A6700` | `--warning` |
| Ring | `#FB923C` | `#C2410C` | `--ring` |

**Color Notes:** azul, roxo e ciano não fazem parte da identidade. A exceção são as cores categóricas de tipos de memória e de agentes (`--type-*`, `--agent-*`), que distinguem informação e não marcam a marca.

### Typography

- **Heading Font:** Inter
- **Body Font:** Inter
- **Mood:** dark, cinematic, technical, precision, clean, premium, developer, professional, high-end utility
- **Google Fonts:** [Inter + Inter](https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap)

**CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
```

### Spacing Variables

*Density: 7/10 — Standard*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding |
| `--space-lg` | `24px` / `1.5rem` | Section padding |
| `--space-xl` | `32px` / `2rem` | Large gaps |
| `--space-2xl` | `48px` / `3rem` | Section margins |
| `--space-3xl` | `64px` / `4rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: #F97316;
  color: #0F172A;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #F8FAFC;
  border: 2px solid #1E293B;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: #0F172A;
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-md);
  transition: all 200ms ease;
  cursor: pointer;
}

.card:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: #1E293B;
  outline: none;
  box-shadow: 0 0 0 3px #1E293B20;
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Dark Mode (OLED)

**Keywords:** Dark theme, low light, high contrast, deep black, midnight blue, eye-friendly, OLED, night mode, power efficient

**Best For:** Night-mode apps, coding platforms, entertainment, eye-strain prevention, OLED devices, low-light

**Key Effects:** Minimal glow (text-shadow: 0 0 10px), dark-to-light transitions, low white emission, high readability, visible focus

### Page Pattern

**Pattern Name:** FAQ/Documentation Landing

- **Conversion Strategy:** Reduce support tickets. Track search analytics. Show related articles. Contact escalation path.
- **CTA Placement:** Search bar prominent + Contact CTA for unresolved questions
- **Section Order:** Hero with search bar > Popular categories > FAQ accordion > Contact/support CTA

---

## Motion

**Companion HUD:** a shape that travels uses a spring and one that only appears uses a short time, both from `features/companion/companion-motion.ts`. Expand: stiffness 260, damping 28. Collapse: 300, 32. Impulse: 420, 18, at most 6 px. Hover 180 ms, press 150 ms, content 220 ms, session 280 ms, expression 140 ms. Never `transition: all`; size animates only on an element without layout-bearing children. The mascot shows real states only, and reduced motion removes every spring and loop.

**Stagger List** (Standard) — Trigger: load or scroll | Duration: 300-450ms | Easing: `back.out(1.4)`

```js
gsap.from('.grid-item', { opacity: 0, scale: 0.92, y: 16, duration: 0.4, stagger: { each: 0.06, from: 'start', grid: 'auto' }, ease: 'back.out(1.4)' });
```

**Framework notes:** grid: 'auto' lets GSAP infer rows/columns from a CSS grid layout for a natural wave stagger; Use matchMedia('(prefers-reduced-motion: reduce)') to skip non-essential motion and render the final state immediately

- ✅ Combine with from: 'center' for a bento-grid layout to draw the eye inward first
- ❌ Don't use back.out on dense data tables; the overshoot reads as sloppy on informational UI
- ⚡ Group DOM writes; avoid interleaving layout reads (getBoundingClientRect) between staggered tweens

---

## Anti-Patterns (Do NOT Use)

- ❌ Light mode default
- ❌ Slow performance

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
