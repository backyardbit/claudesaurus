import { useEffect, useRef, useState } from "react";
import {
  clamp,
  dust,
  ease,
  leg,
  n,
  Rex,
  type RexPose,
  rotate,
  scaleAbout,
  translate,
} from "./Dinosaur";

const DINO_SECONDS = 4.4;

const FRAME_MS = 1000 / 30;

const STILL_MS = 3000;
const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const DINO_WIDTH = 170;
const UNIT = DINO_WIDTH / 64;
const HEADROOM = 12;
const FEET = 37.3;
const BUBBLE_ROOM = 190;

const HOPS_AT = 1.7;
const HOP_SECONDS = 0.6;
const HOPS = 2;

const TAU = Math.PI * 2;

type Stage = { ground: number; left: number; right: number; width: number; height: number };

function measureStage(): Stage {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const composer = document.querySelector(".composer-wrap")?.getBoundingClientRect();
  if (!composer) return { ground: height - 80, left: 24, right: width - 24, width, height };
  return { ground: composer.top, left: composer.left, right: composer.right, width, height };
}

type Party = {
  x: number;
  opacity: number;
  rex: RexPose;
  lift: number;
  bubble: number;
};

function span(t: number, from: number, to: number) {
  return clamp((t - from) / (to - from));
}

function partyAt(t: number, stage: Stage): Party {
  const middle = (stage.left + stage.right) / 2 - DINO_WIDTH / 2;
  const from = Math.max(-DINO_WIDTH - 20, middle - 640);
  const to = Math.min(stage.width + 20, middle + 900);

  let x = middle;
  let pace = 0;
  let stepsPerSecond = 3;
  if (t < 1.5) {
    x = from + (middle - from) * (1 - (1 - t / 1.5) ** 2);
    pace = 1 - ease(span(t, 1.1, 1.5));
  } else if (t >= 3.2) {
    x = middle + (to - middle) * span(t, 3.2, DINO_SECONDS - 0.1) ** 2;
    pace = 1.3 * ease(span(t, 3.2, 3.4));
    stepsPerSecond = 3.6;
  }
  const stride = t * TAU * stepsPerSecond;

  const hopping = !still && t >= HOPS_AT && t < HOPS_AT + HOPS * HOP_SECONDS;
  const hop = hopping ? ((t - HOPS_AT) / HOP_SECONDS) % 1 : 0;
  const air = Math.sin(hop * Math.PI);
  const landing = hopping ? Math.max(0, 1 - Math.min(hop, 1 - hop) / 0.1) : 0;
  const crouch = Math.sin(Math.PI * span(t, HOPS_AT - 0.15, HOPS_AT)) + 0.8 * landing;
  const roar = still ? 1 : ease(span(t, 1.6, 1.75)) - ease(span(t, 2.95, 3.15));
  const wave = t * TAU * 4.5;
  const lift = 13 * air;

  return {
    x,
    opacity: Math.min(span(t, 0, 0.15), 1 - span(t, DINO_SECONDS - 0.15, DINO_SECONDS)),
    lift,
    bubble: still ? 1 : ease(span(t, 1.75, 1.9)) * (1 - ease(span(t, 3, 3.2))),
    rex: {
      farLeg: leg(stride + Math.PI, 26 * pace, 2.4 * pace, 29.5, 24, -16 * air),
      nearLeg: leg(stride, 26 * pace, 2.4 * pace, 33.2, 25, 14 * air),
      torso: translate(0, pace * (0.5 - 1.1 * Math.abs(Math.cos(stride))) + 1.6 * crouch),
      head: rotate(
        3 * pace * Math.sin(2 * stride - 0.6) - 10 * roar + 2 * roar * Math.sin(wave),
        42,
        13,
      ),
      jaw: rotate(
        8 * pace * Math.max(0, Math.sin(2 * stride + 1)) + roar * (18 + 5 * Math.sin(wave * 1.2)),
        42,
        14,
      ),
      tail: rotate(7 * pace * Math.sin(stride) + 12 * roar * Math.sin(t * TAU * 3), 27, 21),
      arm: rotate(
        25 * Math.sin(2 * stride) * (1 - roar) + roar * (-20 + 40 * Math.sin(wave)),
        38.6,
        21.4,
      ),
      eyeWhite: "2.1",
      pupil: "1.15",
      blink: t % 2.9 < 0.14,
      happy: roar > 0.5,
      maw: n(roar),
      dust: dust(stride, pace),
      lift: translate(0, -lift),
      shadow: scaleAbout(1 - 0.35 * air, 32, 37.3),
    },
  };
}

function PartyHat({ wobble }: { wobble: number }) {
  return (
    <g transform={`translate(45 4.3) rotate(${n(-14 + wobble)})`}>
      <clipPath id="party-hat-cone">
        <polygon points="-4,0 4,0 0,-10.5" />
      </clipPath>
      <g clipPath="url(#party-hat-cone)">
        <rect x="-5" y="-11" width="10" height="12" className="hat" />
        <rect x="-5" y="-3.4" width="10" height="1.6" className="hat-stripe" />
        <rect x="-5" y="-7" width="10" height="1.4" className="hat-stripe" />
      </g>
      <ellipse cx="0" cy="0" rx="4.4" ry=".9" className="hat-stripe" />
      <circle cx="0" cy="-10.6" r="1.5" className="hat-pompom" />
    </g>
  );
}

function hatWobble(t: number) {
  if (still || t < HOPS_AT || t >= HOPS_AT + HOPS * HOP_SECONDS) return 0;
  return -12 * Math.sin((((t - HOPS_AT) / HOP_SECONDS) % 1) * TAU);
}

type Bit = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  spin: number;
  spinSpeed: number;
  flip: number;
  flipSpeed: number;
  color: string;
  round: boolean;
};

function confettiColors() {
  const style = getComputedStyle(document.documentElement);
  const named = ["--accent", "--blue", "--green", "--yellow", "--red"].map((name) =>
    style.getPropertyValue(name).trim(),
  );
  return [...named.filter(Boolean), "#8250df"];
}

const GRAVITY = 0.22;
const FALL = 3.4;

function volley(stage: Stage, count: number, colors: string[]) {
  const speed = Math.sqrt(2 * GRAVITY * stage.ground * 0.6);
  const bits: Bit[] = [];
  for (const [x, aim] of [
    [stage.left + 24, -Math.PI / 2 + 0.45],
    [stage.right - 24, -Math.PI / 2 - 0.45],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const angle = aim + (Math.random() - 0.5) * 0.75;
      const v = speed * (0.55 + Math.random() * 0.6);
      bits.push({
        x,
        y: stage.ground,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        width: 6 + Math.random() * 4,
        height: 3.5 + Math.random() * 3,
        spin: Math.random() * TAU,
        spinSpeed: (Math.random() - 0.5) * 0.3,
        flip: Math.random() * TAU,
        flipSpeed: 0.1 + Math.random() * 0.2,
        color: colors[i % colors.length] ?? "#d97757",
        round: Math.random() < 0.2,
      });
    }
  }
  return bits;
}

function drawConfetti(context: CanvasRenderingContext2D, bits: Bit[], steps: number, stage: Stage) {
  context.clearRect(0, 0, stage.width, stage.height);
  let flying = false;
  for (const bit of bits) {
    if (bit.y > stage.height + 20) continue;
    bit.vx *= 0.985 ** steps;
    bit.vy = Math.min(bit.vy + GRAVITY * steps, FALL);
    bit.x += (bit.vx + Math.sin(bit.flip) * 0.6) * steps;
    bit.y += bit.vy * steps;
    bit.spin += bit.spinSpeed * steps;
    bit.flip += bit.flipSpeed * steps;
    flying = true;
    context.save();
    context.translate(bit.x, bit.y);
    context.rotate(bit.spin);
    context.scale(1, Math.cos(bit.flip));
    context.fillStyle = bit.color;
    if (bit.round) {
      context.beginPath();
      context.arc(0, 0, bit.height * 0.7, 0, TAU);
      context.fill();
    } else {
      context.fillRect(-bit.width / 2, -bit.height / 2, bit.width, bit.height);
    }
    context.restore();
  }
  return flying;
}

export function Celebration({ pr, onEnd }: { pr: number | null; onEnd: () => void }) {
  const [stage] = useState(measureStage);
  const [seconds, setSeconds] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (still) {
      const timer = window.setTimeout(onEnd, STILL_MS);
      return () => window.clearTimeout(timer);
    }
    const context = canvas.current?.getContext("2d");
    if (!context || !canvas.current) return;
    const scale = window.devicePixelRatio || 1;
    canvas.current.width = stage.width * scale;
    canvas.current.height = stage.height * scale;
    context.scale(scale, scale);
    const colors = confettiColors();
    const bits: Bit[] = [];
    const volleys = [HOPS_AT, HOPS_AT + HOP_SECONDS];
    const start = performance.now();
    let last = start;
    const timer = window.setInterval(() => {
      const now = performance.now();
      const t = (now - start) / 1000;
      while (volleys[0] !== undefined && t >= volleys[0]) {
        volleys.shift();
        bits.push(...volley(stage, bits.length === 0 ? 55 : 40, colors));
      }
      const flying = drawConfetti(context, bits, (now - last) / (1000 / 60), stage);
      last = now;
      setSeconds(Math.min(t, DINO_SECONDS));
      if (t >= DINO_SECONDS && !flying && volleys.length === 0) onEnd();
    }, FRAME_MS);
    return () => window.clearInterval(timer);
  }, [stage, onEnd]);

  const party = partyAt(still ? 2 : seconds, stage);
  const top = stage.ground - (FEET + HEADROOM) * UNIT + 3;
  return (
    <div className="celebration" aria-hidden="true">
      <canvas ref={canvas} />
      <svg
        className="dino party-dino"
        aria-hidden="true"
        viewBox={`0 ${-HEADROOM} 64 ${40 + HEADROOM}`}
        style={{ transform: `translate(${n(party.x)}px, ${n(top)}px)`, opacity: n(party.opacity) }}
      >
        <Rex pose={party.rex} hat={<PartyHat wobble={hatWobble(seconds)} />} />
      </svg>
      {party.bubble > 0 && (
        <div
          className="party-bubble"
          style={{
            left: Math.min(party.x + DINO_WIDTH - 20, stage.width - BUBBLE_ROOM),
            top: top + (HEADROOM - party.lift) * UNIT - 40,
            opacity: n(party.bubble),
            transform: `scale(${n(0.6 + 0.4 * party.bubble)})`,
          }}
        >
          {pr === null ? "Merged!" : `PR #${pr} merged!`} 🎉
        </div>
      )}
    </div>
  );
}
