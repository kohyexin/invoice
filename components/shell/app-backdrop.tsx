/** Fixed backdrop behind the app shell: Gatehub's Midnight scene, blue glow
 *  orbs with a calm constellation sky, in light and dark. */

const orbs = [
  {
    className: "absolute -left-24 top-[-12%] h-[42rem] w-[42rem] rounded-full blur-[170px] bg-brand-500/8 dark:bg-brand-500/22",
    delay: "0s",
  },
  {
    className: "absolute right-[-10%] top-[2%] h-[40rem] w-[40rem] rounded-full blur-[170px] bg-sky-400/6 dark:bg-sky-500/14",
    delay: "-7s",
  },
  {
    className:
      "absolute left-1/2 top-[22%] h-[40rem] w-[44rem] -translate-x-1/2 rounded-full blur-[180px] bg-blue-400/6 dark:bg-blue-500/12",
    delay: "-10s",
  },
  {
    className: "absolute bottom-[-18%] left-1/4 h-[40rem] w-[40rem] rounded-full blur-[170px] bg-indigo-400/6 dark:bg-indigo-500/10",
    delay: "-13s",
  },
  {
    className: "absolute bottom-[-8%] right-[6%] h-[34rem] w-[34rem] rounded-full blur-[170px] bg-cyan-400/5 dark:bg-blue-400/10",
    delay: "-4s",
  },
];

export function AppBackdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-canvas">
      {orbs.map((orb, i) => (
        <div key={i} className={`animate-blob ${orb.className}`} style={{ animationDelay: orb.delay }} />
      ))}

      <div className="app-midnight-stars absolute inset-0" />
      <div
        className="midnight-meteor app-midnight-meteor"
        style={{ top: "8%", left: "58%", "--meteor-duration": "19s", "--meteor-delay": "3s" } as React.CSSProperties}
      />
      <div
        className="midnight-meteor app-midnight-meteor"
        style={{ top: "20%", left: "26%", "--meteor-duration": "27s", "--meteor-delay": "13s" } as React.CSSProperties}
      />

      {/* Soft top rim-light + gentle bottom settle so the colored field feels lit */}
      <div className="absolute inset-0 bg-gradient-to-b from-white/25 via-transparent to-transparent dark:from-transparent dark:to-canvas/70" />
    </div>
  );
}
