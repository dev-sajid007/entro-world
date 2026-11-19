import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ZONES, ZONE_IDS, type ZoneId } from "@entroworld/shared";
import { useAuth } from "../features/auth/AuthContext";
import styles from "./LandingPage.module.css";

const LandingScene = lazy(() => import("./LandingScene"));

/** 3D only where it will run well: WebGL available and the visitor hasn't asked for less motion. */
function canShow3d(): boolean {
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Falls back to the flat illustration if the 3D scene fails for any reason. */
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

const FEATURES: { icon: string; title: string; text: string }[] = [
  { icon: "🏙️", title: "A living 3D city", text: "Walk, run and jump through plazas, parks, a waterfront and busy streets, with everyone else who's online." },
  { icon: "🎙️", title: "Talk face to face", text: "Proximity voice and chat: people near you hear you, just like in real life. Emotes say the rest." },
  { icon: "🧩", title: "Coding Academy", text: "Program a robot with blocks in the Puzzle Lab, earn XP and badges, pair up with friends or battle them." },
  { icon: "🤖", title: "AI Agent Street", text: "Walk into shops run by AI shopkeepers and get help with code, ideas and more. Every AI is clearly labelled." },
  { icon: "🎪", title: "Live events", text: "Teach a class on the big screen in the Event Center, or drop in on what's happening tonight." },
  { icon: "🏡", title: "A home of your own", text: "Claim a plot in the Residential Area, share posts with friends, and build your corner of the city." },
];

const DISTRICT_STYLE: Record<ZoneId, { icon: string; color: string }> = {
  "zone-central": { icon: "⛲", color: "#38bdf8" },
  "zone-business": { icon: "🏢", color: "#818cf8" },
  "zone-residential": { icon: "🏘️", color: "#f59e0b" },
  "zone-park": { icon: "🌳", color: "#22c55e" },
  "zone-beach": { icon: "🌊", color: "#06b6d4" },
  "zone-event": { icon: "🎤", color: "#ec4899" },
  "zone-market": { icon: "🛍️", color: "#a78bfa" },
  "zone-academy": { icon: "🎓", color: "#f97316" },
};

const STEPS = [
  { title: "Create your avatar", text: "Pick a look and a name. It takes a minute." },
  { title: "Step into the city", text: "No download: the city runs right in your browser." },
  { title: "Meet, learn, explore", text: "Say hi in the plaza, solve a puzzle, or visit a shop." },
];

export default function LandingPage() {
  const { status, user } = useAuth();
  const signedIn = status === "authenticated" && user;
  const primary = signedIn ? { to: "/world", label: "Enter the city" } : { to: "/register", label: "Join the city — it's free" };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand} aria-label="EntroWorld home">
          <Logo />
          <span>EntroWorld</span>
        </Link>
        <nav className={styles.links} aria-label="Sections">
          <a href="#features">Features</a>
          <a href="#districts">Districts</a>
          <a href="#how">How it works</a>
        </nav>
        <div className={styles.auth}>
          {signedIn ? (
            <>
              <Link to="/feed" className={styles.ghost}>
                Feed
              </Link>
              <Link to="/world" className={styles.cta}>
                Enter the city
              </Link>
            </>
          ) : (
            <>
              <Link to="/login" className={styles.ghost}>
                Sign in
              </Link>
              <Link to="/register" className={styles.cta}>
                Create account
              </Link>
            </>
          )}
        </div>
      </header>

      <main>
        <section className={styles.hero}>
          <div className={styles.heroText}>
            <span className={styles.eyebrow}>
              <span className={styles.liveDot} /> New: Coding Academy &amp; AI Agent Street
            </span>
            <h1>
              A social network you can <span className={styles.gradient}>walk around in</span>.
            </h1>
            <p className={styles.lead}>
              Meet people in a living 3D city. Chat face to face, learn to code with friends, visit AI-run shops, go to live events and
              build a home of your own — right in your browser.
            </p>
            <div className={styles.actions}>
              <Link to={primary.to} className={`${styles.cta} ${styles.big}`}>
                {signedIn ? `Welcome back, ${user.displayName} — enter the city` : primary.label}
              </Link>
              <Link to="/sandbox" className={`${styles.secondary} ${styles.big}`}>
                Try it without an account
              </Link>
            </div>
            <ul className={styles.trust}>
              <li>✓ Free to play</li>
              <li>✓ No download</li>
              <li>✓ Works on desktop &amp; mobile</li>
            </ul>
            {import.meta.env.DEV && (
              <Link to="/dev/multiplayer" className={styles.devLink}>
                Multiplayer test (dev)
              </Link>
            )}
          </div>
          <CityIllustration />
        </section>

        <section id="features" className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.kicker}>What you can do</span>
            <h2>More than a feed. A place.</h2>
            <p>Everything you'd do on a social network, plus the things you can only do when you're actually there together.</p>
          </div>
          <div className={styles.features}>
            {FEATURES.map((f) => (
              <article key={f.title} className={styles.feature}>
                <span className={styles.featureIcon} aria-hidden>
                  {f.icon}
                </span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="districts" className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.kicker}>Explore</span>
            <h2>Eight districts, one city</h2>
            <p>Take the transit kiosks to hop between them, or just walk — there's always someone around the next corner.</p>
          </div>
          <div className={styles.districts}>
            {ZONE_IDS.map((id) => {
              const zone = ZONES[id];
              const look = DISTRICT_STYLE[id];
              return (
                <div key={id} className={styles.district} style={{ ["--district" as string]: look.color }}>
                  <span className={styles.districtIcon} aria-hidden>
                    {look.icon}
                  </span>
                  <div>
                    <h3>{zone.name}</h3>
                    <p>{zone.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section id="how" className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.kicker}>Get started</span>
            <h2>In the city in under a minute</h2>
          </div>
          <ol className={styles.steps}>
            {STEPS.map((s, i) => (
              <li key={s.title} className={styles.step}>
                <span className={styles.stepNumber}>{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.final}>
          <h2>Your friends are already walking around.</h2>
          <p>Come say hi in the plaza.</p>
          <div className={styles.actions}>
            <Link to={primary.to} className={`${styles.cta} ${styles.big}`}>
              {primary.label}
            </Link>
            <Link to="/sandbox" className={`${styles.secondary} ${styles.big}`}>
              Explore the sandbox
            </Link>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <span className={styles.brandSmall}>
          <Logo /> EntroWorld
        </span>
        <span>A social city in your browser.</span>
      </footer>
    </div>
  );
}

function Logo() {
  return (
    <svg className={styles.logo} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="ew-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <path d="M16 2 29 9.5v13L16 30 3 22.5v-13Z" fill="url(#ew-logo)" />
      <path d="M16 9 22.5 12.75v7.5L16 24l-6.5-3.75v-7.5Z" fill="#0b1120" opacity="0.85" />
      <path d="M16 13.5 19 15.25v3.5L16 20.5l-3-1.75v-3.5Z" fill="#e0f2fe" />
    </svg>
  );
}

/** An isometric slice of the city: buildings, a road with a car, people chatting. Pure SVG + CSS. */
function CityIllustration() {
  // Load the 3D city after the page has painted, so the first view is instant.
  const [show3d, setShow3d] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!canShow3d()) return;
    const id = window.setTimeout(() => setShow3d(true), 150);
    return () => window.clearTimeout(id);
  }, []);
  // Isometric helpers: x to the right-down, z to the left-down.
  const iso = (x: number, z: number, y = 0) => `${200 + (x - z) * 17},${150 + (x + z) * 9.8 - y}`;
  const block = (x: number, z: number, w: number, d: number, h: number, top: string, left: string, right: string, key: string) => (
    <g key={key}>
      <polygon points={[iso(x, z, h), iso(x + w, z, h), iso(x + w, z + d, h), iso(x, z + d, h)].join(" ")} fill={top} />
      <polygon points={[iso(x, z + d, h), iso(x + w, z + d, h), iso(x + w, z + d, 0), iso(x, z + d, 0)].join(" ")} fill={left} />
      <polygon points={[iso(x + w, z, h), iso(x + w, z + d, h), iso(x + w, z + d, 0), iso(x + w, z, 0)].join(" ")} fill={right} />
    </g>
  );
  const buildings = [
    block(-6, -6, 3, 3, 120, "#7dd3fc", "#0ea5e9", "#0369a1", "b1"),
    block(-2, -7, 3, 3, 80, "#c4b5fd", "#8b5cf6", "#6d28d9", "b2"),
    block(2, -7, 3, 2.5, 150, "#a5b4fc", "#6366f1", "#4338ca", "b3"),
    block(-7, -1.5, 2.5, 3, 60, "#fcd34d", "#f59e0b", "#b45309", "b4"),
    block(6, -6, 2.5, 3, 95, "#f9a8d4", "#ec4899", "#be185d", "b5"),
    block(6, 3, 3, 3, 55, "#fdba74", "#f97316", "#c2410c", "b6"),
  ];
  const tree = (x: number, z: number, k: string) => {
    const [cx, cy] = iso(x, z).split(",").map(Number);
    return (
      <g key={k}>
        <rect x={cx! - 1.5} y={cy! - 14} width={3} height={14} fill="#78350f" />
        <circle cx={cx} cy={cy! - 20} r={9} fill="#22c55e" />
        <circle cx={cx! + 4} cy={cy! - 24} r={6} fill="#4ade80" />
      </g>
    );
  };
  return (
    <div className={styles.illustration} aria-hidden>
      <div className={styles.glow} />
      {show3d && (
        <div className={`${styles.scene} ${ready ? styles.sceneReady : ""}`}>
          <SceneBoundary>
            <Suspense fallback={null}>
              <SceneMounted onReady={() => setReady(true)} />
            </Suspense>
          </SceneBoundary>
        </div>
      )}
      <svg viewBox="0 0 400 330" className={`${styles.city} ${ready ? styles.cityHidden : ""}`}>
        {/* Ground island */}
        <polygon points={[iso(-9, -9), iso(10, -9), iso(10, 10), iso(-9, 10)].join(" ")} fill="#1e293b" />
        <polygon points={[iso(-9, 10), iso(10, 10), iso(10, 10, -14), iso(-9, 10, -14)].join(" ")} fill="#0f172a" />
        <polygon points={[iso(10, -9), iso(10, 10), iso(10, 10, -14), iso(10, -9, -14)].join(" ")} fill="#020617" />
        {/* Plaza and grass */}
        <polygon points={[iso(-3, -3), iso(4, -3), iso(4, 1), iso(-3, 1)].join(" ")} fill="#cbd5e1" opacity="0.9" />
        <polygon points={[iso(-8, 3), iso(-2, 3), iso(-2, 9), iso(-8, 9)].join(" ")} fill="#166534" />
        {/* Road */}
        <polygon points={[iso(-9, 1.5), iso(10, 1.5), iso(10, 4), iso(-9, 4)].join(" ")} fill="#334155" />
        {Array.from({ length: 9 }, (_, i) => (
          <polygon key={i} points={[iso(-8 + i * 2, 2.65), iso(-7 + i * 2, 2.65), iso(-7 + i * 2, 2.85), iso(-8 + i * 2, 2.85)].join(" ")} fill="#f8fafc" opacity="0.7" />
        ))}
        {/* Fountain */}
        <ellipse cx={iso(0.5, -1).split(",")[0]} cy={iso(0.5, -1).split(",")[1]} rx="22" ry="12" fill="#38bdf8" opacity="0.8" className={styles.water} />
        {buildings}
        {tree(-6, 5, "t1")}
        {tree(-4, 7, "t2")}
        {tree(-7, 7.5, "t3")}
        {tree(8, -1, "t4")}
        {/* A car driving along the road */}
        <g className={styles.car}>
          <polygon points="-14,0 6,-11 18,-4 -2,7" fill="#ef4444" />
          <polygon points="-6,-6 4,-12 10,-8 0,-2" fill="#0f172a" />
          <polygon points="-14,0 -2,7 -2,11 -14,4" fill="#b91c1c" />
        </g>
        {/* People in the plaza */}
        {[
          [-1.5, -1.8, "#f472b6"],
          [2.5, -0.5, "#facc15"],
          [3.4, -1.9, "#34d399"],
        ].map(([x, z, c], i) => {
          const [px, py] = iso(x as number, z as number).split(",").map(Number);
          return (
            <g key={i} className={styles.person} style={{ animationDelay: `${i * 0.4}s` }}>
              <rect x={px! - 3} y={py! - 16} width={6} height={12} rx={3} fill={c as string} />
              <circle cx={px} cy={py! - 20} r={4} fill="#fde68a" />
            </g>
          );
        })}
      </svg>
      <div className={`${styles.bubble} ${styles.bubbleA}`}>hey! want to try the puzzle lab? 🧩</div>
      <div className={`${styles.bubble} ${styles.bubbleB}`}>omw 🏃</div>
      <div className={styles.liveCard}>
        <span className={styles.liveDot} />
        <div>
          <strong>Central Plaza</strong>
          <span>Live now · voice on</span>
        </div>
      </div>
    </div>
  );
}

/** The lazily loaded 3D scene; reports when it has mounted so the flat illustration can fade out. */
function SceneMounted({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    const id = window.setTimeout(onReady, 300);
    return () => window.clearTimeout(id);
  }, [onReady]);
  return <LandingScene />;
}
