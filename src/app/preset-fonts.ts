import {
  DM_Sans, EB_Garamond, Figtree, Geist, Geist_Mono, IBM_Plex_Sans,
  Instrument_Sans, Instrument_Serif, Inter, JetBrains_Mono, Lora,
  Manrope, Merriweather, Montserrat, Noto_Sans, Noto_Serif,
  Nunito_Sans, Outfit, Oxanium, Playfair_Display, Public_Sans,
  Raleway, Roboto, Roboto_Slab, Source_Sans_3, Space_Grotesk,
} from "next/font/google";

// Every preset can be selected at runtime. Keep the faces available without
// preloading unused fonts on every page.
const dmSans = DM_Sans({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-dm-sans" })
const ebGaramond = EB_Garamond({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-eb-garamond" })
const figtree = Figtree({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-figtree" })
const geist = Geist({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-geist" })
const geistMono = Geist_Mono({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-geist-mono" })
const ibmPlexSans = IBM_Plex_Sans({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-ibm-plex-sans" })
const instrumentSans = Instrument_Sans({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-instrument-sans" })
const instrumentSerif = Instrument_Serif({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-instrument-serif" })
const inter = Inter({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-inter" })
const jetbrainsMono = JetBrains_Mono({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-jetbrains-mono" })
const lora = Lora({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-lora" })
const manrope = Manrope({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-manrope" })
const merriweather = Merriweather({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-merriweather" })
const montserrat = Montserrat({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-montserrat" })
const notoSans = Noto_Sans({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-noto-sans" })
const notoSerif = Noto_Serif({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-noto-serif" })
const nunitoSans = Nunito_Sans({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-nunito-sans" })
const outfit = Outfit({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-outfit" })
const oxanium = Oxanium({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-oxanium" })
const playfairDisplay = Playfair_Display({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-playfair-display" })
const publicSans = Public_Sans({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-public-sans" })
const raleway = Raleway({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-raleway" })
const roboto = Roboto({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-roboto" })
const robotoSlab = Roboto_Slab({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-roboto-slab" })
const sourceSans3 = Source_Sans_3({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-source-sans-3" })
const spaceGrotesk = Space_Grotesk({ weight: "400", subsets: ["latin"], display: "swap", preload: false, variable: "--font-preset-space-grotesk" })

export const presetFontClasses = [
  dmSans, ebGaramond, figtree, geist, geistMono, ibmPlexSans, instrumentSans, instrumentSerif, inter, jetbrainsMono, lora, manrope, merriweather, montserrat, notoSans, notoSerif, nunitoSans, outfit, oxanium, playfairDisplay, publicSans, raleway, roboto, robotoSlab, sourceSans3, spaceGrotesk,
].map((font) => font.variable).join(" ");
