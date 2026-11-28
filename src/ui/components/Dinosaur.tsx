import { type ReactNode, useId } from "react";

export const LOOP_SECONDS = 11;

const TAU = Math.PI * 2;

export const n = (value: number) => value.toFixed(2);
export const translate = (x: number, y: number) => `translate(${n(x)} ${n(y)})`;
export const rotate = (angle: number, x: number, y: number) => `rotate(${n(angle)} ${x} ${y})`;
export const scaleAbout = (s: number, x: number, y: number) =>
  `translate(${x} ${y}) scale(${n(s)}) translate(${-x} ${-y})`;
export const clamp = (x: number) => Math.max(0, Math.min(1, x));
export const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const overshoot = (x: number) => 1 + 2.9 * (x - 1) ** 3 + 1.9 * (x - 1) ** 2;

export function leg(
  stride: number,
  amp: number,
  lift: number,
  hipX: number,
  hipY: number,
  tuck = 0,
) {
  const up = Math.max(0, -Math.cos(stride)) * lift;
  return `${translate(0, -up)} ${rotate(amp * Math.sin(stride) + tuck, hipX, hipY)}`;
}

type Puff = { cx: string; cy: string; r: string; opacity: string };
const NO_PUFF: Puff = { cx: "0", cy: "0", r: "0", opacity: "0" };

export function dust(stride: number, pace: number) {
  return (
    [
      [0, 38],
      [Math.PI, 34.3],
    ] as const
  ).flatMap(([phase, footX]): Puff[] => {
    const sinceLanding = (((stride + phase - 1.5 * Math.PI) % TAU) + TAU) % TAU;
    const age = sinceLanding / TAU / 0.5;
    if (age >= 1 || pace <= 0.5) return [NO_PUFF, NO_PUFF];
    return [
      {
        cx: n(footX - 2 - age * 5),
        cy: n(35.6 - age * 1.8),
        r: n(0.7 + age * 1.8),
        opacity: n(0.55 * (1 - age)),
      },
      {
        cx: n(footX + 1 + age * 2),
        cy: n(35.9 - age),
        r: n(0.5 + age * 1.2),
        opacity: n(0.45 * (1 - age)),
      },
    ];
  });
}

function pose(u: number) {
  const span = (a: number, b: number) => clamp((u - a) / (b - a));

  const laid = u >= 9.75;
  const e = laid ? 0 : u;
  const eggSpan = (a: number, b: number) => clamp((e - a) / (b - a));
  const wobble = e < 1.4 ? 7 * Math.sin(e * TAU * 2.2) * eggSpan(0, 1.2) : 0;
  const lid = ease(eggSpan(1.45, 1.7));
  const rise = overshoot(eggSpan(1.55, 1.95));
  const look = ease(eggSpan(2, 2.2)) - 2 * ease(eggSpan(2.5, 2.7)) + ease(eggSpan(2.95, 3.1));
  const babyBlink = e > 2.3 && e < 2.42;
  const hatched = e >= 3.35;
  const fall = eggSpan(3.35, 3.7);

  const hatch = span(3.3, 3.9);
  const hatchPuffs = (
    [
      [25, 34],
      [32, 31.5],
      [39, 34],
    ] as const
  ).map(([x, y]) =>
    hatch > 0 && hatch < 1
      ? {
          cx: n(x + (x - 32) * 0.3 * hatch),
          cy: n(y - 2 * hatch),
          r: n(1.2 + 3.5 * hatch),
          opacity: n(0.6 * (1 - hatch)),
        }
      : NO_PUFF,
  );

  const size =
    0.3 +
    0.15 * overshoot(span(3.35, 3.65)) +
    0.2 * overshoot(span(5.2, 5.5)) +
    0.2 * overshoot(span(6.6, 6.9)) +
    0.15 * overshoot(span(8, 8.3));
  const x = 8 * ease(span(9.2, 9.7)) + 46 * span(10.25, 10.95) ** 2;
  const pace =
    u < 9.6
      ? ease(span(3.5, 3.8))
      : u < 10.15
        ? 1 - ease(span(9.6, 9.8))
        : 1.3 * ease(span(10.15, 10.3));
  const p = u * TAU * 1.5;
  const squat = Math.sin(Math.PI * span(9.6, 10.1));
  const young = clamp(1 - (size - 0.45) / 0.55);
  const pupil = 1.15 + 0.45 * young;
  const hatOff = ease(span(6.6, 7.2));

  return {
    eggShown: u < 3.7 || laid,
    eggPop: laid ? scaleAbout(overshoot(span(9.75, 10.05)), 32, 37) : undefined,
    egg: rotate(wobble, 32, 37),
    crack: n(1 - ease(eggSpan(1.15, 1.45))),
    lid: `${translate(-1.5 * lid, -8.5 * lid)} ${rotate(-20 * lid, 32, 14)}`,
    babyShown: !hatched,
    baby: `${translate(0, 11 * (1 - rise))} ${rotate(-7 * look, 32, 24)}`,
    babyPupilX: n(33.8 + 0.6 * look),
    babyBlink,
    bottom: `${translate(0, 4 * fall)} ${rotate(6 * fall, 32, 37)}`,
    bottomOpacity: n(1 - fall),
    hatchPuffs,
    rexShown: u >= 3.35,
    rex: `${translate(x, 0)} ${scaleAbout(size, 32, 37)}`,
    nearLeg: leg(p, 26 * pace, 2.4 * pace, 33.2, 25),
    farLeg: leg(p + Math.PI, 26 * pace, 2.4 * pace, 29.5, 24),
    torso: translate(0, pace * (0.5 - 1.1 * Math.abs(Math.cos(p))) + 1.6 * squat),
    head: rotate(3 * pace * Math.sin(2 * p - 0.6) - 6 * squat, 42, 13),
    tail: rotate(7 * pace * Math.sin(p) - 10 * squat, 27, 21),
    jaw: rotate(8 * pace * Math.max(0, Math.sin(2 * p + 1)), 42, 14),
    arm: rotate(25 * Math.sin(2 * p), 38.6, 21.4),
    eyeWhite: n(2.1 + 0.8 * young),
    pupil: n(pupil),
    blink: u % 2.9 < 0.14,
    hat: `${translate(-6 * hatOff, -10 * hatOff + 14 * hatOff * hatOff)} ${rotate(-60 * hatOff, 47, 4)}`,
    hatOpacity: n(1 - hatOff),
    dust: dust(p, pace),
  };
}

const EGG =
  "M32 5.5C40 5.5 45.5 17 45.5 25.5C45.5 32.5 39.5 37 32 37C24.5 37 18.5 32.5 18.5 25.5C18.5 17 24 5.5 32 5.5Z";
const CRACK = "21,21 24,18.3 27,21.6 30,18.3 33,21.6 36,18.3 39,21.6 42,18.3 47,21";
const SPOTS = [
  [27, 12, 1.6],
  [37.5, 13.5, 1.2],
  [24, 28, 1.8],
  [39, 30, 1.4],
  [33, 25, 1],
] as const;

function Shell({ clip }: { clip: string }) {
  return (
    <g clipPath={`url(#${clip})`}>
      <path d={EGG} className="shell" />
      {SPOTS.map(([cx, cy, r]) => (
        <circle key={`${cx},${cy}`} cx={cx} cy={cy} r={r} className="spot" />
      ))}
    </g>
  );
}

function Puffs({ puffs }: { puffs: Puff[] }) {
  return (
    <g className="dust">
      {puffs.map((puff, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed set of puffs, reused every frame
        <circle key={i} {...puff} />
      ))}
    </g>
  );
}

export type RexPose = {
  farLeg: string;
  nearLeg: string;
  torso: string;
  tail: string;
  head: string;
  jaw: string;
  arm: string;
  eyeWhite: string;
  pupil: string;
  blink: boolean;
  dust: Puff[];
  lift?: string;
  shadow?: string;
  maw?: string;
  happy?: boolean;
};

export function Rex({ pose, hat }: { pose: RexPose; hat: ReactNode }) {
  return (
    <>
      <ellipse cx="32" cy="37.3" rx="12" ry="1.5" transform={pose.shadow} className="shadow" />
      <Puffs puffs={pose.dust} />
      <g transform={pose.lift}>
        <g transform={pose.farLeg} className="shade">
          <rect x="26.5" y="23" width="6" height="12" rx="3" />
          <ellipse cx="31" cy="35.2" rx="4.2" ry="1.9" />
        </g>
        <g transform={pose.torso}>
          <path
            transform={pose.tail}
            d="M27 16.5C19 17 9.5 21 3 26.5C10 26 18 26.5 27 26.5Z"
            className="skin"
          />
          <ellipse
            cx="32"
            cy="21.5"
            rx="9.5"
            ry="8.2"
            transform="rotate(-25 32 21.5)"
            className="skin"
          />
          <ellipse cx="35.2" cy="24" rx="4.6" ry="5" className="belly" />
          <path transform={pose.arm} d="M38.6 21.4l3 1.6l.9 -1.3" className="arm" />
          <g transform={pose.head}>
            {pose.maw && (
              <path d="M42 13.6H54L51.5 18.6L44.5 18.2Z" opacity={pose.maw} className="maw" />
            )}
            <path
              transform={pose.jaw}
              d="M41.5 13.5H53.5C55 13.5 55.4 16.2 53.6 16.8L44.5 17.6C41 17.6 39.6 14.2 41.5 13.5Z"
              className="shade"
            />
            <path d="M45 14.2l.7 1.2l.7 -1.2ZM49.4 14.2l.7 1.2l.7 -1.2Z" className="white" />
            <path
              d="M37 11.5C37 6 41.5 3 48 3C54.5 3 57.8 5.6 57.8 9.6C57.8 12.8 55.6 14.5 52.5 14.5H43.5C39.5 14.5 37 14 37 11.5Z"
              className="skin"
            />
            <ellipse cx="50.8" cy="11.6" rx="1.9" ry="1" className="blush" />
            {pose.happy ? (
              <path d="M45.6 8.9Q47.5 6 49.4 8.9" className="grin" />
            ) : (
              <>
                <circle cx="47.5" cy="8" r={pose.eyeWhite} className="white" />
                <ellipse
                  cx="48.2"
                  cy="8.1"
                  rx={pose.pupil}
                  ry={pose.blink ? 0.12 : pose.pupil}
                  className="ink"
                />
              </>
            )}
            <circle cx="56" cy="7.2" r=".45" className="ink" />
            {hat}
          </g>
        </g>
        <g transform={pose.nearLeg} className="skin">
          <rect x="30" y="24" width="6.4" height="11.5" rx="3.2" />
          <ellipse cx="34.8" cy="35.3" rx="4.4" ry="2" />
        </g>
      </g>
    </>
  );
}

const STANDING: RexPose = {
  farLeg: "",
  nearLeg: "",
  torso: "",
  tail: "",
  head: "",
  jaw: "",
  arm: "",
  eyeWhite: "2.10",
  pupil: "1.15",
  blink: false,
  dust: [],
};

export function StandingDinosaur() {
  return (
    <svg className="dino standing-dino" viewBox="1 1 59 39" aria-hidden="true">
      <Rex pose={STANDING} hat={null} />
    </svg>
  );
}

export function Dinosaur({ seconds }: { seconds: number }) {
  const id = `dino${useId().replace(/:/g, "")}`;
  const top = `${id}-top`;
  const bottom = `${id}-bottom`;
  const inside = `${id}-inside`;
  const at = pose(seconds % LOOP_SECONDS);
  return (
    <svg className="dino working-dino" viewBox="0 0 64 40" aria-hidden="true">
      <defs>
        <clipPath id={top}>
          <polygon points={`0,0 64,0 64,21 ${CRACK.split(" ").reverse().join(" ")} 0,21`} />
        </clipPath>
        <clipPath id={inside}>
          <path d={EGG} />
          <rect width="64" height="21" />
        </clipPath>
        <clipPath id={bottom}>
          <polygon points={`0,21 ${CRACK} 64,21 64,40 0,40`} />
        </clipPath>
      </defs>

      {at.eggShown && (
        <g transform={scaleAbout(0.8, 32, 37)}>
          <g transform={at.eggPop}>
            <ellipse cx="32" cy="37.3" rx="12" ry="1.5" className="shadow" />
            <g transform={at.egg}>
              {at.babyShown && (
                <>
                  <g transform={at.lid}>
                    <Shell clip={top} />
                  </g>
                  <g clipPath={`url(#${inside})`}>
                    <g transform={at.baby}>
                      <rect x="28.3" y="19" width="7.4" height="12" rx="3.5" className="skin" />
                      <ellipse cx="32" cy="17" rx="6" ry="5.3" className="skin" />
                      <ellipse cx="37.2" cy="18.6" rx="4.3" ry="2.9" className="skin" />
                      <path d="M34.2 20.4Q37.5 21.4 40.6 19.7" className="mouth" />
                      <ellipse
                        cx="33.5"
                        cy="15.6"
                        rx="1.9"
                        ry={at.babyBlink ? 0.25 : 1.9}
                        className="white"
                      />
                      <ellipse
                        cx={at.babyPupilX}
                        cy="15.7"
                        rx="1.05"
                        ry={at.babyBlink ? 0.1 : 1.05}
                        className="ink"
                      />
                      <circle cx="40.2" cy="17.4" r=".4" className="ink" />
                    </g>
                  </g>
                </>
              )}
              <g transform={at.bottom} opacity={at.bottomOpacity}>
                <Shell clip={bottom} />
                <path
                  d="M20.5 21L24 18.3L27 21.6L30 18.3L33 21.6L36 18.3L39 21.6L42 18.3L44.6 20.6"
                  pathLength={1}
                  strokeDashoffset={at.crack}
                  className="crack"
                />
              </g>
            </g>
          </g>
        </g>
      )}

      <Puffs puffs={at.hatchPuffs} />

      {at.rexShown && (
        <g transform={at.rex}>
          <Rex
            pose={at}
            hat={
              <g transform={at.hat} opacity={at.hatOpacity}>
                <g transform="translate(46.5 5.2) rotate(-12) scale(.75) translate(-32 -20.5)">
                  <Shell clip={top} />
                </g>
              </g>
            }
          />
        </g>
      )}
    </svg>
  );
}
