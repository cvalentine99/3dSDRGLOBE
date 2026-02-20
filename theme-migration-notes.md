# Theme Migration Reference

## Replacement Patterns

### Text colors
- `text-white` → `text-foreground`
- `text-white/90` → `text-foreground/90`
- `text-white/80` → `text-foreground/80`
- `text-white/70` → `text-foreground/70`
- `text-white/60` → `text-muted-foreground`
- `text-white/50` → `text-muted-foreground`
- `text-white/40` → `text-muted-foreground/70`
- `text-white/30` → `text-muted-foreground/50`
- `text-white/20` → `text-muted-foreground/30`

### Background colors
- `bg-black/40` → `bg-background/60`
- `bg-black/50` → `bg-background/70`
- `bg-black/60` → `bg-background/80`
- `bg-black/30` → `bg-background/50`
- `bg-black/20` → `bg-background/40`
- `bg-white/5` → `bg-foreground/5`
- `bg-white/10` → `bg-foreground/10`
- `bg-white/15` → `bg-foreground/15`
- `bg-white/20` → `bg-foreground/20`

### Border colors
- `border-white/10` → `border-border`
- `border-white/15` → `border-border`
- `border-white/20` → `border-border`
- `border-white/30` → `border-border/80`

### Special cases to KEEP (intentionally white/black)
- Colored button text that should always be white (e.g., on colored backgrounds)
- Globe/3D rendering text overlays (always on dark background)
- Loading screen (always dark)
- Spectrogram/waterfall (always dark canvas)
