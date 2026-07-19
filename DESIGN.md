# Design System

## Overview

This is a restrained mobile product interface for a private daily task. The
physical scene is a user glancing at a Redmi phone at home, sometimes in bright
daylight and sometimes beside the bed, wanting certainty in a few seconds. The
interface therefore follows the system theme, keeps the daily action prominent,
and avoids decorative healthcare imagery.

## Color

Use OKLCH tokens and tinted neutrals rather than pure black or white.

- Canvas light: `oklch(0.985 0.006 95)`
- Surface light: `oklch(0.955 0.008 95)`
- Canvas dark: `oklch(0.185 0.008 250)`
- Surface dark: `oklch(0.235 0.01 250)`
- Text light: `oklch(0.24 0.012 250)`
- Text dark: `oklch(0.93 0.008 95)`
- Primary action: `oklch(0.58 0.14 158)`
- Pending: `oklch(0.7 0.13 78)`
- Missed: `oklch(0.61 0.16 28)`
- Focus: `oklch(0.62 0.14 245)`

Color is semantic. Every state also includes an icon and a text label.

## Typography

Use the Android and system sans stack. Keep a fixed product scale with no
viewport-based font sizing.

- Page title: 24px, 700
- Today state: 20px, 700
- Section heading: 16px, 650
- Body and controls: 15px, 450 to 600
- Supporting text: 13px, 450
- Calendar day number: 14px, 600

Letter spacing is zero. Numeric date and time values use tabular numerals.

## Layout

- Mobile-first single-screen structure with a compact top bar.
- Today's status occupies the first viewport and leads directly to one large
  action.
- The monthly calendar follows as an unframed section, not a nested card.
- Monthly summary sits beside the calendar heading rather than becoming a hero
  metric.
- Settings use a separate page with grouped rows and inline controls.
- Content width is capped for browser previews, while the Android app uses the
  full safe width with 16 to 20px side padding. The working surface is capped at
  448px so it retains comfortable outer breathing room on large phones.

## Components

- Use shadcn/ui Button, Dialog, Switch, Input, Label, Select, and Sheet or Drawer
  where their established behavior fits.
- Calendar cells have stable square dimensions and never resize on state change.
- The primary confirmation control has a minimum height of 56px.
- Action buttons use a visible border, elevation, icon, and pressed-state
  feedback so they do not read as static cards.
- Weekday headings use semibold foreground text at strong contrast, including
  outdoors and in dark mode.
- Reminder time opens a styled hour-and-minute dialog. Repeat interval uses
  5-minute stepper controls rather than a long dropdown.
- Radius is 6 to 8px for controls and framed elements.
- Use Lucide icons for in-app controls. The launcher icon is a neutral calendar
  and check symbol with no medicine imagery.

## Interaction

- Tapping today's primary action marks the day as taken and cancels pending
  notifications.
- Tapping a past or current calendar date opens an inline action surface.
- Reverting a taken day requires confirmation.
- Future days are visibly disabled and do not respond.
- State transitions use 150 to 220ms opacity and transform animation, with reduced
  motion support.
- Focus rings are visible, and all icon-only controls have accessible labels and
  tooltips when unfamiliar.

## Content

Month summary counts every calendar day that is visually meaningful
(taken / missed / pending), including backfilled history before tracking
started. Blank pre-tracking days stay empty and do not inflate the total.

Weekday headers use light muted chips and strong graphite text so they stay
readable outdoors without a heavy dark bar.

Use privacy-neutral labels on every surface, including `每日记录`, `待确认`,
`已完成`, `未完成`, and `今天不再提醒`. Do not expose medicine-related wording
inside the app, launcher, notifications, or Android task surfaces.

## Responsive Behavior

- Primary target: 360 to 440 CSS-pixel mobile widths.
- Narrow mobile: preserve 7 calendar columns with fixed gaps and shorten secondary
  text before reducing control size.
- Tablet and desktop preview: center a phone-scale working surface and keep settings
  readable without turning the product into a dashboard.
- Text wrapping must never overlap calendar cells, buttons, or adjacent sections.
