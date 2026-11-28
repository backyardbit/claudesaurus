import { useEffect, useState } from "react";
import { formatDuration } from "../format";
import { Dinosaur } from "./Dinosaur";

const WORDS = [
  "Stomping",
  "Roaring",
  "Hatching",
  "Fossilizing",
  "Excavating",
  "Foraging",
  "Grazing",
  "Lumbering",
  "Stampeding",
  "Basking",
  "Nesting",
  "Chomping",
  "Thundering",
  "Prowling",
  "Unearthing",
  "Evolving",
  "Migrating",
  "Rumbling",
  "Tromping",
  "Fern-munching",
  "Swamp-wading",
  "Tail-swishing",
  "Bone-digging",
  "Meteor-dodging",
  "Egg-sitting",
  "Paleontologizing",
];

const WORD_SECONDS = 12;

const FRAME_MS = 1000 / 12;

const STILL_AT = 9;
const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Working({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  const [firstWord] = useState(() => Math.floor(Math.random() * WORDS.length));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), still ? 1000 : FRAME_MS);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, now - since);
  const seconds = Math.floor(elapsed / 1000);
  const word = WORDS[(firstWord + Math.floor(seconds / WORD_SECONDS)) % WORDS.length];
  const dinoSeconds = still ? STILL_AT : (Math.floor(elapsed / FRAME_MS) * FRAME_MS) / 1000;
  return (
    <div className="working">
      <Dinosaur seconds={dinoSeconds} />
      {word}… <span className="dim">{formatDuration(seconds * 1000)} · esc to stop</span>
    </div>
  );
}
