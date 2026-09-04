import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mammi Order",
    short_name: "Mammi",
    description: "Mammi online ordering",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#315b34",
    icons: [
      {
        src: "/logo.png?v=1.0",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
