# Motus Royale UI Brief V1

Use the current screenshots as structural reference only. Do not preserve the current styling blindly.

## Attach These Screenshots

Home desktop:
`C:\Users\rchauvier\OneDrive - AUBAY\Documents\MotusBattleRoyal\.playwright-cli\page-2026-03-26T14-33-05-321Z.png`

Play desktop live round:
`C:\Users\rchauvier\OneDrive - AUBAY\Documents\MotusBattleRoyal\.playwright-cli\page-2026-03-26T14-37-17-527Z.png`

Play mobile live round:
`C:\Users\rchauvier\OneDrive - AUBAY\Documents\MotusBattleRoyal\.playwright-cli\page-2026-03-26T14-37-22-376Z.png`

Play mobile lobby/auth:
`C:\Users\rchauvier\OneDrive - AUBAY\Documents\MotusBattleRoyal\.playwright-cli\page-2026-03-26T12-35-39-621Z.png`

Optional extra context:
`C:\Users\rchauvier\OneDrive - AUBAY\Documents\MotusBattleRoyal\progress.md`

## Prompt To Send

```text
I’m attaching the current Motus Royale UI screenshots. Use them as structural reference only, not as style canon.

Design a high-fidelity, shipping-ready temporary UI refresh for Motus Royale, a French-first realtime word battle royale played in the browser.

Product context:
- Browser-based multiplayer word arena
- Not a TV-show clone
- Not a generic SaaS dashboard
- French-first experience
- Flow: home page -> guest/account auth -> public matchmaking or private room -> live round -> round reveal -> final results
- Core gameplay signals are fixed and must stay immediately readable:
  - lime = correct letter in correct slot
  - amber = present letter in wrong slot
  - cyan = locked revealed clue
  - dark slate = absent letter
  - coral/red = urgency, timer, danger

Current UI DNA to preserve:
- dark premium arena mood
- rounded shapes
- strong board readability
- visible word-tile system
- AZERTY on-screen keyboard
- competitive realtime tone
- fast access to guest auth, queue, private room, and join-by-code

What needs to improve:
- the current UI still feels too panel-heavy and slightly too dashboard-like
- there are too many equal-weight surfaces
- the home page should feel more branded and memorable
- the live play screen should feel more focused, more competitive, and more premium
- hierarchy should be stronger: the board and active round must dominate, secondary information must support rather than compete

Design direction:
- polished, dark, tense, readable
- restrained futurism, not cyberpunk cliche
- avoid purple-heavy neon
- avoid arcade gimmicks
- use expressive display typography for headlines and clean sans-serif UI typography for controls and data
- keep the palette tight: deep navy / graphite base, lime / amber / cyan as gameplay signals, coral only for danger
- fewer panels, better grouping, cleaner spacing, more deliberate contrast
- motion should be subtle and meaningful, only for countdown, reveal, success, elimination, and CTA emphasis

Required outputs:
- 1 desktop home page
- 1 desktop play lobby / auth / matchmaking screen
- 1 desktop live round screen
- 1 mobile live round screen
- 1 compact component strip showing:
  - tile states
  - keyboard key states
  - buttons
  - badges
  - panels
- short rationale explaining hierarchy, mood, and what changed from the current UI
- make it Figma-ready with Auto Layout logic and reusable component variants

Layout and UX constraints:
- during live play, the board must remain the visual center
- timer, score, attempts, room code, and legend must be visible but secondary
- avoid opening every information surface at once
- the home page should communicate “readability + competition + realtime” in under 3 seconds
- the lobby must make guest entry, public queue, private room creation, and join-by-code immediately obvious
- the live round must be instantly scannable on both desktop and mobile
- mobile target: 390x844
- desktop target: 1440px width
- keep tap targets large and the live interaction zone clean on mobile
- this must feel realistic to implement in an existing React/Tailwind app, not like a speculative concept car

Explicit anti-patterns to avoid:
- generic dashboard UI
- equal-weight glass cards everywhere
- visual noise for the sake of style
- random purple cyberpunk treatment
- decorative tile gimmicks
- clutter around the board
- tiny labels or low-contrast status colors
- concept art that looks expensive to build and hard to ship

If simplification improves the result, simplify. Prefer fewer, stronger surfaces over more UI.
```

## Why This Prompt Is Safe

- It preserves the product flow already implemented.
- It preserves the current gameplay color semantics.
- It asks for visual redesign, not architecture changes.
- It explicitly constrains the result to something realistic for an existing React and Tailwind codebase.
- It avoids the two main failure modes here: generic dashboard UI and overdesigned concept art.
