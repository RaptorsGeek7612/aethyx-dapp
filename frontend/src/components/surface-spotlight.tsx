"use client";

import { useEffect } from "react";

/**
 * Projecteur suivant le pointeur sur toutes les surfaces `.glass-card`.
 *
 * Monté une seule fois, à la racine : un écouteur délégué sur le document plutôt qu'un
 * `onPointerMove` par carte. Une page de tableau de bord porte une dizaine de surfaces, et dix
 * abonnements React qui réveillent chacun leur composant à chaque déplacement de souris coûtent
 * bien plus que le seul `closest()` fait ici.
 *
 * Rien ne passe par l'état React : les coordonnées sont écrites en propriétés personnalisées
 * (`--spot-x`, `--spot-y`) directement sur le nœud, que le dégradé de `.glass-card::after` lit.
 * Aucun rendu React n'a lieu pendant que la souris traverse la page — c'est la seule façon de
 * tenir 60 images par seconde sur un geste continu.
 *
 * N'est actif que sur un pointeur fin et survolable : sur un écran tactile, il n'y a pas de
 * survol à représenter, et l'effet n'existerait que sous le doigt qui le cache.
 */
export function SurfaceSpotlight() {
  useEffect(() => {
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    if (!finePointer.matches) return;

    let frame = 0;
    let pending: { card: HTMLElement; x: number; y: number } | null = null;

    // Le pointeur émet bien plus d'événements qu'il n'y a d'images à rendre : on ne retient que
    // la dernière position et on n'écrit qu'une fois par image.
    const flush = () => {
      frame = 0;
      if (!pending) return;
      pending.card.style.setProperty("--spot-x", `${pending.x}px`);
      pending.card.style.setProperty("--spot-y", `${pending.y}px`);
      pending = null;
    };

    const onPointerMove = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const card = target.closest<HTMLElement>(".glass-card");
      if (!card) return;

      const rect = card.getBoundingClientRect();
      pending = { card, x: event.clientX - rect.left, y: event.clientY - rect.top };
      frame ||= requestAnimationFrame(flush);
    };

    document.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
