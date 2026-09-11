"use client";

import { useEffect, useState } from "react";

/** Horloge partagée pour les comptes à rebours. Un intervalle unique par composant, plutôt qu'une
 *  nouvelle date à chaque rendu : un `Date.now()` appelé pendant le rendu rend le composant
 *  impur et fait diverger le rendu serveur du rendu client. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
