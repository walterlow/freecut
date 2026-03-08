/**
 * Curated style LoRAs for Daydream Cloud API (StreamDiffusion).
 * Only include LoRAs compatible with SD1.5, SDXL, or SD2.1 base models.
 */

export type LoraFamily = 'SD1.5' | 'SDXL' | 'SD2.1';

export interface CuratedLoraPreset {
  id: string;
  label: string;
  modelId: string;
  family: LoraFamily;
  defaultScale: number;
  triggerWord: string;
}

export const CURATED_LORA_PRESETS: CuratedLoraPreset[] = [
  {
    id: 'your-name-style',
    label: 'Your Name Style',
    modelId: 'vislupus/SD1.5-LoRA-Your-Name-Style',
    family: 'SD1.5',
    defaultScale: 0.8,
    triggerWord: 'yn_style',
  },
  {
    id: 'princess-mononoke-style',
    label: 'Princess Mononoke Style',
    modelId: 'vislupus/SD1.5-LoRA-Princess-Mononoke-Style',
    family: 'SD1.5',
    defaultScale: 0.8,
    triggerWord: 'mononoke_style',
  },
  {
    id: '3d-rendering',
    label: '3D Rendering',
    modelId: 'imagepipeline/3D-rendering-style-LoRa-SD1.5',
    family: 'SD1.5',
    defaultScale: 0.75,
    triggerWord: '',
  },
  {
    id: 'oil-canvas',
    label: 'Oil Canvas',
    modelId: 'Eunju2834/LoRA_oilcanvas_style',
    family: 'SD1.5',
    defaultScale: 0.8,
    triggerWord: '(Oil Painting: 1.1), (Impressionism: 1.2)',
  },
  {
    id: 'studio-ghibli',
    label: 'Studio Ghibli',
    modelId: 'ntc-ai/SDXL-LoRA-slider.Studio-Ghibli-style',
    family: 'SDXL',
    defaultScale: 0.8,
    triggerWord: 'Studio Ghibli style',
  },
  {
    id: 'pixar-style',
    label: 'Pixar Style',
    modelId: 'ntc-ai/SDXL-LoRA-slider.pixar-style',
    family: 'SDXL',
    defaultScale: 0.8,
    triggerWord: 'pixar-style',
  },
  {
    id: 'barbiecore',
    label: 'BarbieCore',
    modelId: 'mnemic/BarbieCore-SD1.5-LoRA',
    family: 'SD1.5',
    defaultScale: 0.8,
    triggerWord: 'BarbieCore',
  },
  {
    id: 'chessman-sd21',
    label: 'Chessman (SD2.1)',
    modelId: 'vivym/chessman-sd2.1-lora-01',
    family: 'SD2.1',
    defaultScale: 0.8,
    triggerWord: '',
  },
  // SD2.1 (sd-turbo)
  { id: 'sd21-dpo', label: 'DPO LoRA (SD2.1)', modelId: 'radames/sd-21-DPO-LoRA', family: 'SD2.1', defaultScale: 0.8, triggerWord: '' },
  { id: 'tcd-sd21', label: 'TCD SD2.1', modelId: 'h1t/TCD-SD21-base-LoRA', family: 'SD2.1', defaultScale: 0.8, triggerWord: '' },
  { id: 'sd21-chairs', label: 'SD2.1 Chairs', modelId: 'traptrip/sd-2-1-chairs-lora', family: 'SD2.1', defaultScale: 0.8, triggerWord: '' },
  // SDXL
  { id: 'sdxl-turbo-lora', label: 'SDXL Turbo LoRA', modelId: 'shiroppo/sd_xl_turbo_lora', family: 'SDXL', defaultScale: 0.8, triggerWord: '' },
  { id: 'golden-dragon-blossoms', label: 'Golden Dragon Blossoms', modelId: 'lunaalice01/sdxl_turbo_lora_GoldenDragonBlossoms', family: 'SDXL', defaultScale: 0.8, triggerWord: 'dragon' },
  { id: 'sdxl-turbo-dpo', label: 'DPO LoRA (SDXL Turbo)', modelId: 'radames/sdxl-turbo-DPO-LoRA', family: 'SDXL', defaultScale: 0.8, triggerWord: '' },
  { id: 'time-machine-morph', label: 'Time Machine Morph', modelId: 'zentrocdot/SDXL_Time_Machine_Morph_LoRA', family: 'SDXL', defaultScale: 0.8, triggerWord: 'time machine' },
  { id: 'lora-sdxl-index', label: 'LoRA SDXL Index', modelId: 'nphSi/LoRA_SDXL', family: 'SDXL', defaultScale: 0.85, triggerWord: '' },
  { id: 'lora-sdxl-njstyle', label: 'NJ Style', modelId: 'johnowhitaker/lora-sdxl-njstyle', family: 'SDXL', defaultScale: 0.8, triggerWord: 'in szn style' },
  { id: 'lora-sdxl-eighties', label: 'Eighties', modelId: 'xgga/lora-sdxl-eighties', family: 'SDXL', defaultScale: 0.8, triggerWord: 'in sze style' },
  { id: 'danielle-model-xl', label: 'Danielle Model', modelId: 'SamJu3/sd-danielle-model-lora10with-xl', family: 'SDXL', defaultScale: 0.8, triggerWord: '' },
  { id: 'lora-sdxl-plushie', label: 'Plushie', modelId: 'johnowhitaker/lora-sdxl-plushie', family: 'SDXL', defaultScale: 0.8, triggerWord: 'plushie' },
  { id: 'pomological-watercolor', label: 'Pomological Watercolor', modelId: 'artificialguybr/pomological-watercolor-redmond-lora-for-sd-xl', family: 'SDXL', defaultScale: 0.8, triggerWord: 'Pomological Watercolor' },
  { id: 'lora-sdxl-flatillustration', label: 'Flat Illustration', modelId: 'modamsko/lora-sdxl-flatillustration', family: 'SDXL', defaultScale: 0.8, triggerWord: 'in szn style' },
  { id: 'lego-xl', label: 'LEGO (MiniFig / BrickHeadz / Creator)', modelId: 'lordjia/lelo-lego-lora-for-xl-sd1-5', family: 'SDXL', defaultScale: 0.8, triggerWord: 'LEGO MiniFig, LEGO BrickHeadz, LEGO Creator' },
  { id: 'doodle-redmond', label: 'Doodle Hand Drawing', modelId: 'artificialguybr/doodle-redmond-doodle-hand-drawing-style-lora-for-sd-xl', family: 'SDXL', defaultScale: 0.8, triggerWord: 'doodle, DoodleRedm' },
  { id: 'amigurumi-crochet', label: 'Amigurumi Crochet', modelId: 'artificialguybr/amigurami-redmond-amigurami-crochet-sd-xl-lora', family: 'SDXL', defaultScale: 0.8, triggerWord: 'Crochet, Amigurumi' },
  { id: 'lcm-lora-sdxl', label: 'LCM LoRA SDXL', modelId: 'latent-consistency/lcm-lora-sdxl', family: 'SDXL', defaultScale: 0.8, triggerWord: '' },
  { id: 'tcd-sdxl', label: 'TCD SDXL', modelId: 'h1t/TCD-SDXL-LoRA', family: 'SDXL', defaultScale: 0.8, triggerWord: '' },
  { id: 'ultra-realistic-illustration', label: 'Ultra Realistic Illustration', modelId: 'ntc-ai/SDXL-LoRA-slider.ultra-realistic-illustration', family: 'SDXL', defaultScale: 0.8, triggerWord: 'ultra realistic illustration' },
  { id: 'cinematic-lighting', label: 'Cinematic Lighting', modelId: 'ntc-ai/SDXL-LoRA-slider.cinematic-lighting', family: 'SDXL', defaultScale: 0.8, triggerWord: 'cinematic lighting' },
  { id: 'alien-style', label: 'Alien Style', modelId: 'RalFinger/alien-style-lora-sdxl', family: 'SDXL', defaultScale: 0.8, triggerWord: 'alienzkin' },
  { id: 'conan-lora', label: 'Conan Anime', modelId: 'yifei28/sdxl-base-1.0-Conan-lora', family: 'SDXL', defaultScale: 0.8, triggerWord: 'Still from the Anime' },
  { id: 'spo-sdxl', label: 'SPO SDXL (Aesthetic)', modelId: 'LyliaEngine/spo_sdxl_10ep_4k-data_lora_webui', family: 'SDXL', defaultScale: 0.8, triggerWord: '' },
  { id: 'ferocious-dragon', label: 'Ferocious Dragon', modelId: 'ntc-ai/SDXL-LoRA-slider.ferocious-dragon', family: 'SDXL', defaultScale: 0.8, triggerWord: 'ferocious dragon' },
  { id: 'face-helper-sdxl', label: 'Face Helper', modelId: 'ostris/face-helper-sdxl-lora', family: 'SDXL', defaultScale: 1, triggerWord: '' },
  { id: 'noodles-lora', label: 'Noodles', modelId: 'RalFinger/noodles-lora-sdxl', family: 'SDXL', defaultScale: 0.8, triggerWord: 'noodlez' },
  { id: 'pixel-art', label: 'Pixel Art', modelId: 'ntc-ai/SDXL-LoRA-slider.pixel-art', family: 'SDXL', defaultScale: 0.8, triggerWord: 'pixel art' },
  { id: 'cartoon', label: 'Cartoon', modelId: 'ntc-ai/SDXL-LoRA-slider.cartoon', family: 'SDXL', defaultScale: 0.8, triggerWord: 'cartoon' },
  { id: 'watercolor-style', label: 'Watercolor Style', modelId: 'ostris/watercolor_style_lora_sdxl', family: 'SDXL', defaultScale: 1, triggerWord: '' },
  { id: 'nice-hands', label: 'Nice Hands', modelId: 'ntc-ai/SDXL-LoRA-slider.nice-hands', family: 'SDXL', defaultScale: 0.8, triggerWord: 'nice hands' },
  { id: 'anime', label: 'Anime', modelId: 'ntc-ai/SDXL-LoRA-slider.anime', family: 'SDXL', defaultScale: 0.8, triggerWord: 'anime' },
  { id: 'filmgrain-sdxl', label: 'Film Grain', modelId: 'artificialguybr/filmgrain-redmond-filmgrain-lora-for-sdxl', family: 'SDXL', defaultScale: 0.8, triggerWord: 'Film Grain, FilmGrainAF' },
  { id: 'kream-product', label: 'KREAM Product', modelId: 'hahminlew/sdxl-kream-model-lora-2.0', family: 'SDXL', defaultScale: 0.8, triggerWord: '' },
  { id: 'lcm-lora-sdxl-turbo', label: 'LCM LoRA SDXL Turbo', modelId: 'openskyml/lcm-lora-sdxl-turbo', family: 'SDXL', defaultScale: 0.8, triggerWord: '' },
  { id: '90s-anime', label: '90s Anime', modelId: 'ntc-ai/SDXL-LoRA-slider.90s-anime', family: 'SDXL', defaultScale: 0.8, triggerWord: '90s anime' },
  { id: 'medieval-knight', label: 'Medieval Knight', modelId: 'thliang01/medieval-knight-sdxl-lora-r8-v0-1', family: 'SDXL', defaultScale: 0.8, triggerWord: 'knight' },
  { id: 'van-gogh', label: 'Van Gogh', modelId: 'ntc-ai/SDXL-LoRA-slider.van-gogh', family: 'SDXL', defaultScale: 0.8, triggerWord: 'van gogh' },
  { id: 'ps1-game-graphics', label: 'PS1 Game Graphics', modelId: 'artificialguybr/ps1redmond-ps1-game-graphics-lora-for-sdxl', family: 'SDXL', defaultScale: 0.8, triggerWord: 'Playstation 1 Graphics, PS1 Game' },
  { id: 'sdxl-flash-lora', label: 'SDXL Flash LoRA', modelId: 'sd-community/sdxl-flash-lora', family: 'SDXL', defaultScale: 0.55, triggerWord: '' },
  { id: 'smol-animals', label: 'Smol Animals', modelId: 'RalFinger/smol-animals-sdxl-lora', family: 'SDXL', defaultScale: 0.8, triggerWord: 'zhibi' },
  { id: 'embroidery-style', label: 'Embroidery Style', modelId: 'ostris/embroidery_style_lora_sdxl', family: 'SDXL', defaultScale: 1, triggerWord: '' },
  { id: 'blacklight-makeup', label: 'Blacklight Makeup', modelId: 'chillpixel/blacklight-makeup-sdxl-lora', family: 'SDXL', defaultScale: 0.8, triggerWord: 'blacklight makeup' },
  { id: 'honore-daumier', label: 'Honoré Daumier', modelId: 'Blib-la/honore_daumier_lora_sdxl', family: 'SDXL', defaultScale: 0.8, triggerWord: 'lithography by Honoré Daumier' },
  { id: 'cinematic-moody', label: 'Cinematic Moody Ambiance', modelId: 'ntc-ai/SDXL-LoRA-slider.cinematic-lighting-with-moody-ambiance', family: 'SDXL', defaultScale: 0.8, triggerWord: 'cinematic lighting with moody ambiance' },
  { id: 'simpstyle', label: 'Simp Style', modelId: 'Norod78/SDXL-simpstyle-Lora', family: 'SDXL', defaultScale: 0.8, triggerWord: 'simpstyle' },
  { id: 'aether-ghost', label: 'Aether Ghost', modelId: 'joachimsallstrom/aether-ghost-lora-for-sdxl', family: 'SDXL', defaultScale: 0.8, triggerWord: '' },
  { id: 'psychemelt', label: 'Psychemelt Style', modelId: 'Norod78/SDXL-Psychemelt-style-LoRA', family: 'SDXL', defaultScale: 0.8, triggerWord: 'psychemelt style' },
  { id: 'caricature-sdxl', label: 'Caricature', modelId: 'Blib-la/caricature_lora_sdxl', family: 'SDXL', defaultScale: 0.8, triggerWord: 'caricature' },
  { id: 'claymationx', label: 'ClaymationX', modelId: 'Norod78/claymationx-sdxl-lora', family: 'SDXL', defaultScale: 0.8, triggerWord: 'ClaymationX' },
  { id: 'muppetshow', label: 'Muppet Show', modelId: 'Norod78/sdxl-muppetshow-lora', family: 'SDXL', defaultScale: 0.8, triggerWord: 'MuppetShow' },
  { id: 'aether-glitch', label: 'Aether Glitch (VHS)', modelId: 'joachimsallstrom/aether-glitch-lora-for-sdxl', family: 'SDXL', defaultScale: 0.8, triggerWord: 'vhs glitch' },
  { id: 'wool-style', label: 'Wool Style', modelId: 'RalFinger/wool-style-sdxl-lora', family: 'SDXL', defaultScale: 0.8, triggerWord: 'zwuul' },
  { id: 'raw', label: 'Raw', modelId: 'ntc-ai/SDXL-LoRA-slider.raw', family: 'SDXL', defaultScale: 0.8, triggerWord: 'raw' },
  { id: 'photo-manipulation', label: 'Photo Manipulation', modelId: 'nDimensional/Photo-Manipulation-SDXL-LoRA', family: 'SDXL', defaultScale: 0.8, triggerWord: '' },
  { id: 'realistic-portrait', label: 'Realistic Portrait (Midjourney-style)', modelId: 'AiWise/RealisticPortrait-MidjourneyMimic-SDXL-LoRA-v1-RVXLv4-Baked-VAE', family: 'SDXL', defaultScale: 0.7, triggerWord: '' },
  { id: 'crowd-of-people', label: 'Crowd of People', modelId: 'ntc-ai/SDXL-LoRA-slider.crowd-of-people', family: 'SDXL', defaultScale: 0.8, triggerWord: 'crowd of people' },
  { id: 'wood-figure', label: 'Wood Figure Style', modelId: 'RalFinger/wood-figure-style-sdxl-lora', family: 'SDXL', defaultScale: 0.8, triggerWord: 'woodfigurez' },
  { id: 'great-lighting', label: 'Great Lighting', modelId: 'ntc-ai/SDXL-LoRA-slider.great-lighting', family: 'SDXL', defaultScale: 0.8, triggerWord: 'great lighting' },
  { id: 'chrome-style', label: 'Chrome Style', modelId: 'RalFinger/chrome-style-sdxl-lora', family: 'SDXL', defaultScale: 0.8, triggerWord: 'ral-chrome' },
  { id: 'jojoso-style', label: 'JoJo So Style', modelId: 'Norod78/SDXL-jojoso_style-Lora', family: 'SDXL', defaultScale: 0.8, triggerWord: 'jojoso style' },
  { id: 'makeup', label: 'Makeup', modelId: 'ntc-ai/SDXL-LoRA-slider.makeup', family: 'SDXL', defaultScale: 0.8, triggerWord: 'makeup' },
];

const MODEL_ID_TO_FAMILY: Record<string, LoraFamily> = {
  'stabilityai/sd-turbo': 'SD2.1',
  'stabilityai/sdxl-turbo': 'SDXL',
  'Lykon/dreamshaper-8': 'SD1.5',
  'prompthero/openjourney-v4': 'SD1.5',
};

const MODEL_ID_TO_LABEL: Record<string, string> = {
  'stabilityai/sd-turbo': 'SD 2.1 Turbo',
  'stabilityai/sdxl-turbo': 'SDXL Turbo',
  'Lykon/dreamshaper-8': 'Dreamshaper 8',
  'prompthero/openjourney-v4': 'Open Journey v4',
};

export function getFamilyForModelId(modelId: string): LoraFamily {
  return MODEL_ID_TO_FAMILY[modelId] ?? 'SD2.1';
}

export function getModelLabelForId(modelId: string): string {
  return MODEL_ID_TO_LABEL[modelId] ?? 'SD 2.1 Turbo';
}

export function getCuratedLorasForFamily(family: LoraFamily): CuratedLoraPreset[] {
  return CURATED_LORA_PRESETS.filter((p) => p.family === family);
}

export function getTriggerWordsForModelIds(modelIds: string[]): string[] {
  const set = new Set(modelIds);
  return CURATED_LORA_PRESETS.filter((p) => set.has(p.modelId) && p.triggerWord.trim())
    .map((p) => p.triggerWord)
    .filter(Boolean);
}
