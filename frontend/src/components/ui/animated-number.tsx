"use client";

import { useEffect } from "react";
import { animate, useMotionValue, useTransform, motion, useReducedMotion } from "framer-motion";

/**
 * Une valeur chiffrée qui rejoint sa cible au lieu d'y sauter.
 *
 * Utile au-delà de l'effet : quand un montant change en direct, une transition dit *qu'il a
 * changé* et dans quel sens, là où une substitution brutale passe inaperçue. Le rendu passe par
 * une MotionValue plutôt que par un état React — le compteur ne provoque donc aucun rendu de
 * React pendant qu'il défile.
 *
 * Si le système demande moins d'animation, la valeur est posée directement : on ne ralentit pas
 * quelqu'un qui a explicitement demandé à ne pas être animé.
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
  const motionValue = useMotionValue(value);
  const text = useTransform(motionValue, (latest) => format(latest));

  useEffect(() => {
    if (reduced) {
      motionValue.set(value);
      return;
    }
    const controls = animate(motionValue, value, { duration, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [value, duration, reduced, motionValue]);

  return <motion.span className={className}>{text}</motion.span>;
}
