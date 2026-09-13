"use client";

import { useEffect, useRef, useState } from "react";
import { animate, motion, useReducedMotion } from "framer-motion";

/**
 * Une valeur chiffrée qui rejoint sa cible au lieu d'y sauter.
 *
 * Utile au-delà de l'effet : quand un montant change en direct, une transition dit *qu'il a
 * changé* et dans quel sens, là où une substitution brutale passe inaperçue.
 *
 * Si le système demande moins d'animation, la valeur cible est affichée directement : on ne
 * ralentit pas quelqu'un qui a explicitement demandé à ne pas être animé.
 *
 * Le texte affiché est un vrai enfant React (un `useState`, pas une MotionValue passée en
 * `children`) — nécessaire pour que `.text-ink`/`.hud-readout`, qui s'appuient sur
 * `background-clip: text`, aient réellement des glyphes à découper. Passer une MotionValue
 * directement en enfant laissait le clip s'appliquer à une boîte sans texte, rendue comme un
 * rectangle plein plutôt que le chiffre.
 */
export function AnimatedNumber({
  value,
  format,
  className,
  duration = 0.9,
}: {
  value: number;
  format: (value: number) => string;
  className?: string;
  duration?: number;
}) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const displayRef = useRef(value);

  useEffect(() => {
    if (reduced) return;
    const controls = animate(displayRef.current, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => {
        displayRef.current = latest;
        setDisplay(latest);
      },
    });
    return () => controls.stop();
  }, [value, duration, reduced]);

  const shown = reduced ? value : display;
  return <motion.span className={className}>{format(shown)}</motion.span>;
}
