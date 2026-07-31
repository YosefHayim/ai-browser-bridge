# MYPR PRESS mascot generation pack

**One character only:** the black faceless stick-figure with a matte black
`PRESS` baseball cap (white PRESS lettering). Same body proportions, same
style across every pose. Do **not** invent other cast members (no cream
reporter, no suit founder, no white intern).

## Style rules (must keep)

- Flat bold cartoon, thick black outlines
- **Transparent** background preferred (or pure white that can be keyed out)
- Faceless black head + black long-sleeve body
- Cap: black with white `PRESS` (readable, not mirrored)
- Accents: cyan / blue only (props, glow, UI chips)
- Full body or clear waist-up; readable at ~64–72px
- Product vibe: press, pitch, interview, send, news desk

## Base references

- `mascot-base.png` / `pose-reading.png` — canonical character
- Any `pose-*.png` for action language

## Phone pose note

`pose-phone.png` holds the phone on the **right** ear (viewer’s right).
`PRESS` text stays readable (not letter-mirrored).

## More pose ideas (same black PRESS figure)

1. Waving a newspaper high
2. Pointing at a headline board
3. Holding two phones (desk + field)
4. Running with a paper plane
5. High-five with a blue check spark
6. Sitting on a stool with laptop on knees
7. Spotlight / live “ON AIR” pose
8. Map pin / Israel media map glance
9. Follow-up clock / reminder pose
10. Celebrating a cover splash

Save as `pose-<action>.png` with transparent background, copy into
`MYPR-App/client/assets/mascot/`, wire in
`client/src/features/auth/loginScene/mascotPoses.ts`.
