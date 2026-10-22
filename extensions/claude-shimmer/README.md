# Claude Shimmer Sakura (bundled)

Claude Code–style working spinner, recolored for sakura-macaron.

```text
✻ Whisking...  ( HIGH · ↓ ~128 tokens · 00:12 )
```

- One verb per run, including tool rounds and automatic retries; 200+ existing verbs retained.
- One 90ms animation clock drives the glyph, gradient, dots, and token tween. No idle or non-TUI animation.
- Live token readings use the greater of provider usage and the incremental estimate; `~` marks estimates. Successful final usage is authoritative; aborted/error stubs cannot replace a larger estimate.
- The elapsed clock covers the whole run. A plain-text completion notice is emitted once, only after successful `agent_settled`, not after errors or cancellation.
- Thinking effort tiers: MINIMAL / LOW / MEDIUM / HIGH / XHIGH / MAX.
- Concurrent subagent labels remain visible while their tools run.
- Narrow terminals drop effort, then elapsed time before the token reading. Long status labels are ellipsized to keep tokens visible; tiny widths show only the spinner and a shortened status. The next animation tick adapts to terminal resizing.
- Zentui Working line has priority: shimmer yields the unkeyed working surface when it is enabled.
- Truecolor, 256-color, and `NO_COLOR` are supported.

Fork of [pi-claude-shimmer](https://github.com/ouzhenkun/pi-claude-shimmer) (MIT), including width-budget fitting inspired by [v1.0.7](https://github.com/ouzhenkun/pi-claude-shimmer/commit/4fbacfef74bc43f6778646a630fef5d745614a2a), with selected fixes adapted from [pi-sakura-cyberdeck v1.2.0](https://github.com/beautifulrem/pi-sakura-cyberdeck) (MIT).
