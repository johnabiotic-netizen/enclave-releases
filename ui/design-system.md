# Design system

A design brief for the desktop app, the phone PWA, and the landing page. The goal is a tool that feels like a secure, calm control room for sensitive identities. Not a flashy "hacker" aesthetic, not a generic SaaS card grid.

## Brand idea

**Sealed and calm.** The product's job is to keep identities separate and private, and never surprise you. The interface should feel deliberate, quiet and trustworthy, like good security hardware. Confidence through restraint.

## Direction

Avoid the current generated-design clichés: cream background with a serif display and a terracotta accent; near black with one acid accent; identical rounded cards with the same soft shadow; all caps eyebrow labels; arrows glued to button text. None of those.

Instead:

- **Mood:** a deep, cool, near navy work surface with real depth, not flat grey. Think the inside of a vault lit softly, not a dashboard template.
- **One memorable element:** the profile as a physical "cell" or "capsule". Each profile is a tile with a sealed look: a thin status seam that glows quietly in its status color (grey stopped, amber starting, green running, red error). The seam is the signature detail. Everything else stays quiet.
- **Spend boldness there only.** The rest (forms, settings, lists) is plain and legible.

## Color

Base palette (adjust while building, keep the spirit):

```
--bg-900: #0E1420   /* app background, deep cool navy */
--bg-800: #141C2B   /* panels */
--bg-700: #1C2638   /* raised elements, inputs */
--line:    #2A3647  /* hairline borders */
--text-100: #EAF0F7  /* primary text, soft white */
--text-300: #A7B4C6  /* secondary text */
--text-500: #6B7A8F  /* muted */
--accent:  #4C8DFF   /* single cool accent: links, focus, primary action */
--ok:      #35C27A   /* running */
--warn:    #E8B13A   /* starting / attention */
--err:     #E5604D   /* error */
```

One accent only. Status colors are used for status, not decoration.

## Type

Two families, clearly distinct:

- **Interface and body:** Inter, or a similarly neutral humanist sans. Used for everything functional.
- **Numerals and identifiers:** a monospace (e.g. IBM Plex Mono) ONLY for machine data: IP addresses, profile ids, ports, fingerprint values. This is meaningful, not decorative: monospace signals "this is exact technical data". Do not use it for labels or headings.

Type scale (desktop): 12, 14 (base), 16, 20, 28, 40. Headings use weight and size for hierarchy, not color. Sentence case everywhere. No all caps labels.

Line length under 80 characters in any longer text.

## Layout

- Desktop app: a slim left rail (navigation: Profiles, Settings, Setup), a main area, and a right detail panel when a profile is selected. Left aligned content.
- Profile grid: tiles sized so the status seam reads at a glance. Not identical floating cards with drop shadows; tiles sit in the surface with hairline separation and the status seam.
- Phone: single column, full screen viewer when a profile is open, with a thin control bar.

## Motion

Almost none. Two allowed moments:
1. The status seam easing between colors when a profile changes state.
2. A short confirmation when an action completes (a profile seals/unseals).
No fade-and-slide on every section. No hover animation on every tile. Respect reduced motion.

## Accessibility and quality floor

- Visible keyboard focus (accent ring) on every control.
- Contrast meets WCAG AA against the dark surface.
- Works down to a small laptop screen; phone PWA is touch first.
- Reduced motion respected.

## Iconography

Minimal line icons, consistent stroke. A profile's state is shown by the seam color and a short word ("Running"), not by icon alone.
