// The pack index on the home page reads this list. Add a pack here when it is announced; `status` is the
// line on its pill, `preview` the image that follows the pointer over its row.
export const packs = [
  {
    id: "everyday-cars",
    no: "01",
    title: "Everyday Cars",
    subtitle: "Low Poly Vehicle Pack",
    engine: "Unity",
    status: "Coming soon to the Unity Asset Store",
    href: "/packs/everyday-cars/",
    preview: "/assets/img/lineup-960.webp",
    summary: "Thirteen road vehicles and a semi-trailer, from a compact hatchback to a semi truck.",
    stats: [
      { n: 14, label: "models" },
      { n: 269, label: "prefabs" },
      { n: 3, label: "LODs each" },
    ],
  },
  {
    id: "helicopters",
    no: "02",
    title: "RotorTrail",
    subtitle: "Helicopter Pack",
    engine: "Unity",
    status: "Coming soon to the Unity Asset Store",
    href: "/packs/helicopters/",
    preview: "/assets/img/helicopters/cover-800.webp",
    summary: "Twelve detailed helicopters with cockpits, crew, spinning rotors and procedural paint.",
    stats: [
      { n: 12, label: "aircraft" },
      { n: 5, label: "shaders" },
      { n: 3, label: "LODs each" },
    ],
  },
  {
    id: "workshop-unreal",
    no: "03",
    title: "In the workshop",
    subtitle: "Our first pack for Unreal Engine",
    engine: "Unreal Engine",
    status: "On the bench",
    quiet: true,
  },
];
