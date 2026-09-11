import type { Transition, Variants } from "framer-motion";

/**
 * Vocabulaire de mouvement partagé par toute l'application.
 *
 * Deux principes le gouvernent. Les durées sont courtes et les courbes sortantes
 * (`cubic-bezier(0.22, 1, 0.36, 1)`) : une interface financière doit répondre, pas se donner en
 * spectacle — l'animation sert à situer ce qui apparaît, jamais à faire patienter. Et rien
 * n'anime autre chose que `transform` et `opacity`, les deux seules propriétés que le
 * compositeur traite sans repasser par la mise en page.
 *
 * L'accessibilité n'est pas traitée ici : `prefers-reduced-motion` est neutralisé une fois pour
 * toutes dans globals.css, ce qui couvre aussi les animations que Framer Motion produit.
 */

/** Courbe sortante commune : départ franc, arrivée amortie. */
export const EASE_OUT: Transition["ease"] = [0.22, 1, 0.36, 1];

/** Ressort des interactions directes — survol, pression. Assez raide pour paraître instantané. */
export const SPRING: Transition = { type: "spring", stiffness: 420, damping: 34, mass: 0.7 };

/**
 * Conteneur qui décale l'entrée de ses enfants. Le décalage donne au regard un ordre de lecture :
 * on suit la séquence au lieu d'affronter tout le contenu d'un coup.
 */
export const staggerContainer = (stagger = 0.06, delay = 0): Variants => ({
  hidden: {},
  visible: { transition: { staggerChildren: stagger, delayChildren: delay } },
});

/** Entrée standard : une remontée courte, jamais plus de quelques pixels. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_OUT } },
};

/** Pour ce qui apparaît sur place — cartes, tuiles — sans direction à suggérer. */
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.97 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.4, ease: EASE_OUT } },
};

/** Contenu qui se déplie : la hauteur `auto` est interpolée par Framer Motion. */
export const collapse: Variants = {
  hidden: { opacity: 0, height: 0 },
  visible: { opacity: 1, height: "auto", transition: { duration: 0.3, ease: EASE_OUT } },
};

/** Réglages d'apparition au défilement, communs à toutes les sections. */
export const inViewOnce = { once: true, amount: 0.15 } as const;
