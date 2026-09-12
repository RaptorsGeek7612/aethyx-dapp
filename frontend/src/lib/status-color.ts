/**
 * Palette d'état, en un seul endroit.
 *
 * Les quatre pas sont fixes et ne se rethématisent pas : ils sont choisis pour tenir le contraste
 * sur la surface sombre de l'application et pour rester distincts les uns des autres en vision
 * des couleurs déficiente. Trois fichiers les redéclaraient chacun de leur côté — `lib/coverage.ts`,
 * `oracle-status-tile.tsx`, `audit-badge.tsx` — avec des valeurs déjà en train de diverger.
 *
 * Ce sont des références à des variables CSS, pas des hexadécimaux : la définition vit dans
 * `globals.css` avec le reste des jetons, et les surcharges d'accessibilité (contraste renforcé,
 * couleurs forcées) s'y appliquent d'elles-mêmes.
 *
 * Règle d'emploi : une couleur d'état ne dit que l'état. Jamais une classe d'actif, jamais un
 * ornement — sinon un écran entièrement coloré ne signale plus rien. Et elle ne porte jamais le
 * sens seule : toujours accompagnée d'une icône et d'un libellé.
 */
export const STATUS_COLOR = {
  good: "var(--status-good)",
  warning: "var(--status-warning)",
  serious: "var(--status-serious)",
  critical: "var(--status-critical)",
  /** Ni bon ni mauvais : en attente, non configuré, inconnu. */
  neutral: "var(--muted-foreground)",
} as const;
