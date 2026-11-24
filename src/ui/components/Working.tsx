import { useEffect, useState } from "react";
import { formatDuration } from "../format";

/**
 * Words shown while Claude works, as Claude Code does with its own. One is picked at random for
 * each turn, and a long turn moves on to the next every WORD_SECONDS.
 */
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

/**
 * A sauropod walking in place: four frames, with the head nodding on every other one. Each
 * frame is a change the terminal has to draw again, so the walk is kept to a few frames a second.
 */
const HEAD_UP = [
  "............####.",
  "............#.###",
  "............##...",
  "...........##....",
  "...........##....",
];
const HEAD_DOWN = [
  ".................",
  "............####.",
  "............#.###",
  "...........###...",
  "...........##....",
];
// biome-ignore format: one string per row of pixels
const BODY = [
  ".....#######.....",
  "...#########.....",
  ".###########.....",
  "#..#########.....",
];
const LEGS = [
  ["....##...##......", "....##...##......"],
  ["....##...##......", "...##.....##....."],
  ["....##...##......", "....##...##......"],
  [".....##.##.......", ".....##.##......."],
];
const FRAME_MS = 250;

function spritePath(rows: string[]): string {
  return rows
    .flatMap((row, y) => [...row].map((cell, x) => (cell === "#" ? `M${x} ${y}h1v1h-1z` : "")))
    .join("");
}

const FRAMES = LEGS.map((legs, i) =>
  spritePath([...(i % 2 ? HEAD_DOWN : HEAD_UP), ...BODY, ...legs]),
);

/** With reduced motion the dinosaur stands still and the clock ticks once a second. */
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
  const frame = still ? 0 : Math.floor(elapsed / FRAME_MS) % FRAMES.length;
  return (
    <div className="working">
      <svg className="working-dino" viewBox="0 0 17 11" aria-hidden="true">
        <path d={FRAMES[frame]} />
      </svg>
      {word}… <span className="dim">{formatDuration(seconds * 1000)} · esc to stop</span>
    </div>
  );
}
