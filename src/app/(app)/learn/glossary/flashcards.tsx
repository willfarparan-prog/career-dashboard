"use client";

import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui";
import { setProgressAction } from "../actions";

type Card = { key: string; term: string; definition: string; example?: string };

/**
 * Cycles through terms you haven't marked as known. "I know this" saves it as
 * known and drops it from the deck; "Still learning" saves that and sends it
 * to the back.
 */
export function Flashcards({ cards }: { cards: Card[] }) {
  const [deck, setDeck] = useState(cards);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const current = deck[0];

  if (!current) {
    return <p className="text-sm text-ok">{cards.length ? "Deck finished: every term here is marked known." : "No terms left to practice in this view."}</p>;
  }

  function answer(known: boolean) {
    const card = current;
    const form = new FormData();
    form.set("key", `term:${card.key}`);
    form.set("status", known ? "confident" : "learning");
    setError("");
    startTransition(async () => {
      const result = await setProgressAction(null, form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDeck((rest) => (known ? rest.slice(1) : [...rest.slice(1), card]));
      setRevealed(false);
    });
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground tabular-nums">{deck.length} to go</p>
      <div className="mt-2 rounded-lg border border-border bg-muted/40 px-4 py-5 text-center">
        <p className="text-lg font-bold">{current.term}</p>
        {revealed ? (
          <div className="mx-auto mt-3 max-w-xl text-left text-sm">
            <p>{current.definition}</p>
            {current.example ? <p className="mt-2 text-muted-foreground">e.g. {current.example}</p> : null}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Say what it means out loud, then reveal.</p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {revealed ? (
          <>
            <button type="button" className={buttonClass("secondary")} disabled={pending} onClick={() => answer(false)}>
              Still learning
            </button>
            <button type="button" className={buttonClass("primary")} disabled={pending} onClick={() => answer(true)}>
              I know this
            </button>
          </>
        ) : (
          <button type="button" className={buttonClass("primary")} onClick={() => setRevealed(true)}>
            Reveal
          </button>
        )}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-center text-sm text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
