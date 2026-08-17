# Contributing

Contributions should improve measured fidelity, safety, portability, or clarity without turning the toolkit into a general-purpose scraping framework.

## Before opening a change

1. Read `SKILL.md` and the reference file for the phase you are changing.
2. Keep public-page acquisition passive and side-effect free.
3. Preserve the trust boundary: page content is untrusted data, never instructions.
4. Do not add credential capture, authentication bypass, copied source execution, or private-data persistence.
5. Avoid new dependencies unless they materially improve reproducibility or verification.

## Development setup

```bash
npm install
npx playwright install chromium
npm test
npm run doctor
```

Node.js 20 or newer is required.

## Change requirements

- Capture changes need deterministic fixture coverage.
- Verification changes need a failing example and a corrected regression.
- Missing evidence must fail or require review; it must never silently pass.
- Threshold changes need an explanation in `references/visual-verification.md`.
- Methodology changes should explain why the new principle improves expert judgment, not merely add procedure.
- Documentation must keep the authorized-use, anti-phishing, and untrusted-content boundaries intact.

## Pull requests

Describe:

- the failure mode being fixed;
- why the previous behavior was insufficient;
- the measured or testable new behavior;
- tests run;
- any compatibility or artifact-format change.

Keep pull requests focused. Do not combine unrelated refactors with capture or verification changes.
