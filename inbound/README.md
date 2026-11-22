# Thrive inbound program page

What runs at <https://thrive-inbound.pages.dev/>: the plans, how calls
are billed, what earns a refund, hours, target states and training.
The onboarding pages link to it as their "rules" page, which is what
`build-onboarding.mjs --rules` points at.

It had no copy here until now. It lived only as a published artifact,
so every change to it was unversioned and unreviewable, and the only
way to see what the live page said was to open it. A page that tells
agents what does and does not earn a refund is worth keeping in the
repository with everything else.

`public/index.html` is the whole page -- one file, no build step, no
relay URL and no key in it.

## Deploying

```
npx wrangler pages deploy ./public --project-name thrive-inbound --branch main --commit-dirty=true
```

`--branch main` is not optional. Without it wrangler takes the branch
from git, and a deploy from a feature branch goes up as a preview and
leaves the live page exactly as it was -- succeeding loudly and
changing nothing.

## The artifact

The same page is published at
<https://claude.ai/artifact/Qo8Zf3Yatz7WT5tKRFibqy>, shared as "anyone
with the link". The two do not sync: a change made in one has to be
carried to the other, and the artifact is the copy people edit by
hand, so read it before publishing over it rather than assuming this
file is current.
