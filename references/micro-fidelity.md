# Micro-fidelity hierarchy

This is where clones usually die: local details are tuned before the structural measurements that control the whole page.

## Level 1: structural metrics

Typography and container width are geometry. Measure the loaded family, actual font file, rendered size, weight, line-height, letter-spacing, text width, wrapping, max-width, gutters, and breakpoint transitions before decorative effects. Wrong type changes every downstream measurement.

## Level 2: component geometry

For controls and cards measure box size, padding, gap, icon geometry, radius, border width and opacity, multiple and inset shadows, transforms, transitions, and every observed state. Preserve 11px when the source measures 11px; a nearby framework shorthand is still wrong.

Default tolerance for high-value geometry is ±1px for control size, radius, and alignment; ±2px for larger section bounds when browser rounding is the only plausible cause. A recurring delta is a system error, not tolerance.

## Level 3: compositing and assets

For dark or layered surfaces inspect computed `background*`, `mask*`, `filter`, `backdrop-filter`, `box-shadow`, and both pseudo-elements. Record gradient layers, stops, origins, opacity, blur, stacking, and blend modes. A solid fill is not a reconstruction of layered gradients and pseudo-elements.

Check every image's source, intrinsic and rendered size, aspect ratio, crop, `object-fit`, `object-position`, clipping, overlays, and compositing. Match the actual responsive transition instead of guessing a framework breakpoint.

## Anti-patterns

- Shrinking type to force the expected wrap while leaving the wrong container in place.
- Replacing a measured icon with a vaguely similar library glyph.
- Flattening multiple shadows or gradients into one approximation.
- Treating mobile as a scaled desktop layout rather than a separate measured state.
- Applying a global spacing change to repair one local section.

## Review order

1. Fonts and text metrics
2. Root containers and gutters
3. Section dimensions and alignment
4. Text wrapping
5. Assets and crops
6. Layered surfaces and pseudo-elements
7. Controls and states
8. Micro-spacing and optical corrections
