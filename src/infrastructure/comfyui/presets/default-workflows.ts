import type { ComfyAssetType, ComfyWorkflowSlot } from '../types'

export const DEFAULT_WORKFLOW_SLOTS: Record<ComfyAssetType, ComfyWorkflowSlot> = {
  video_broll: {
    id: 'video_broll',
    label: 'Video B-Roll Cinemático',
    workflowName: 'Preset_Video_Broll_AnimateDiff.json',
    isCustom: false,
    bindings: {
      positivePromptNodeId: '2',
      positivePromptInputKey: 'text',
      negativePromptNodeId: '3',
      negativePromptInputKey: 'text',
      seedNodeId: '5',
      seedInputKey: 'seed',
      stepsNodeId: '5',
      cfgNodeId: '5',
      samplerNodeId: '5',
      widthNodeId: '4',
      heightNodeId: '4',
      outputNodeId: '7',
    },
    rawWorkflow: {
      '1': {
        inputs: { ckpt_name: 'v1-5-pruned-emaonly.safetensors' },
        class_type: 'CheckpointLoaderSimple',
      },
      '2': {
        inputs: { text: '', clip: ['1', 1] },
        class_type: 'CLIPTextEncode',
      },
      '3': {
        inputs: { text: 'blurry, low quality, artifacts, watermark', clip: ['1', 1] },
        class_type: 'CLIPTextEncode',
      },
      '4': {
        inputs: { width: 768, height: 512, batch_size: 24 },
        class_type: 'EmptyLatentImage',
      },
      '5': {
        inputs: {
          seed: 123456789,
          steps: 20,
          cfg: 7.0,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 1.0,
          model: ['1', 0],
          positive: ['2', 0],
          negative: ['3', 0],
          latent_image: ['4', 0],
        },
        class_type: 'KSampler',
      },
      '6': {
        inputs: { samples: ['5', 0], vae: ['1', 2] },
        class_type: 'VAEDecode',
      },
      '7': {
        inputs: {
          images: ['6', 0],
          frame_rate: 12,
          format: 'video/h264-mp4',
          filename_prefix: 'FreeCut_Video_Broll',
        },
        class_type: 'VHS_VideoCombine',
      },
    },
  },

  image: {
    id: 'image',
    label: 'Imagen Fija / Fondo',
    workflowName: 'Preset_Image_SDXL_Flux.json',
    isCustom: false,
    bindings: {
      positivePromptNodeId: '2',
      positivePromptInputKey: 'text',
      negativePromptNodeId: '3',
      negativePromptInputKey: 'text',
      seedNodeId: '5',
      seedInputKey: 'seed',
      stepsNodeId: '5',
      cfgNodeId: '5',
      samplerNodeId: '5',
      widthNodeId: '4',
      heightNodeId: '4',
      outputNodeId: '7',
    },
    rawWorkflow: {
      '1': {
        inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' },
        class_type: 'CheckpointLoaderSimple',
      },
      '2': {
        inputs: { text: '', clip: ['1', 1] },
        class_type: 'CLIPTextEncode',
      },
      '3': {
        inputs: { text: 'ugly, deformed, noise, low quality, artifacts', clip: ['1', 1] },
        class_type: 'CLIPTextEncode',
      },
      '4': {
        inputs: { width: 1024, height: 1024, batch_size: 1 },
        class_type: 'EmptyLatentImage',
      },
      '5': {
        inputs: {
          seed: 123456789,
          steps: 25,
          cfg: 7.0,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 1.0,
          model: ['1', 0],
          positive: ['2', 0],
          negative: ['3', 0],
          latent_image: ['4', 0],
        },
        class_type: 'KSampler',
      },
      '6': {
        inputs: { samples: ['5', 0], vae: ['1', 2] },
        class_type: 'VAEDecode',
      },
      '7': {
        inputs: { filename_prefix: 'FreeCut_Image', images: ['6', 0] },
        class_type: 'SaveImage',
      },
    },
  },

  voice: {
    id: 'voice',
    label: 'Voz en Off / Voz Natural con IA',
    workflowName: 'Preset_Voiceover_TTS.json',
    isCustom: false,
    bindings: {
      scriptTextNodeId: '1',
      scriptTextInputKey: 'speech_text',
      outputNodeId: '2',
    },
    rawWorkflow: {
      '1': {
        inputs: {
          speech_text: '',
          voice_name: 'es_speaker_1',
          speed: 1.0,
        },
        class_type: 'KokoroTTS',
      },
      '2': {
        inputs: {
          audio: ['1', 0],
          filename_prefix: 'FreeCut_Voice',
        },
        class_type: 'SaveAudio',
      },
    },
  },

  music: {
    id: 'music',
    label: 'Música de Fondo',
    workflowName: 'Preset_MusicGen.json',
    isCustom: false,
    bindings: {
      positivePromptNodeId: '1',
      positivePromptInputKey: 'text',
      negativePromptNodeId: '2',
      negativePromptInputKey: 'text',
      seedNodeId: '3',
      seedInputKey: 'seed',
      outputNodeId: '4',
    },
    rawWorkflow: {
      '1': {
        inputs: { text: '' },
        class_type: 'CLIPTextEncode',
      },
      '2': {
        inputs: { text: 'harsh, distorted, muddy, low bitrate' },
        class_type: 'CLIPTextEncode',
      },
      '3': {
        inputs: {
          seed: 123456789,
          steps: 25,
          cfg: 7.0,
          positive: ['1', 0],
          negative: ['2', 0],
          duration: 10,
        },
        class_type: 'AudioSampler',
      },
      '4': {
        inputs: { audio: ['3', 0], filename_prefix: 'FreeCut_Music' },
        class_type: 'SaveAudio',
      },
    },
  },

  sfx: {
    id: 'sfx',
    label: 'Efectos de Sonido (SFX)',
    workflowName: 'Preset_SFX_AudioLDM.json',
    isCustom: false,
    bindings: {
      positivePromptNodeId: '1',
      positivePromptInputKey: 'text',
      negativePromptNodeId: '2',
      negativePromptInputKey: 'text',
      seedNodeId: '3',
      seedInputKey: 'seed',
      outputNodeId: '4',
    },
    rawWorkflow: {
      '1': {
        inputs: { text: '' },
        class_type: 'CLIPTextEncode',
      },
      '2': {
        inputs: { text: 'speech bleed, hum, low-fi, echo' },
        class_type: 'CLIPTextEncode',
      },
      '3': {
        inputs: {
          seed: 123456789,
          steps: 20,
          cfg: 6.5,
          positive: ['1', 0],
          negative: ['2', 0],
          duration: 3,
        },
        class_type: 'AudioSampler',
      },
      '4': {
        inputs: { audio: ['3', 0], filename_prefix: 'FreeCut_SFX' },
        class_type: 'SaveAudio',
      },
    },
  },

  vfx: {
    id: 'vfx',
    label: 'Efectos Visuales / Img2Img',
    workflowName: 'Preset_VFX_Img2Img.json',
    isCustom: false,
    bindings: {
      inputMediaNodeId: '1',
      positivePromptNodeId: '2',
      positivePromptInputKey: 'text',
      negativePromptNodeId: '3',
      negativePromptInputKey: 'text',
      seedNodeId: '6',
      seedInputKey: 'seed',
      outputNodeId: '8',
    },
    rawWorkflow: {
      '1': {
        inputs: { image: 'input.png', upload: 'image' },
        class_type: 'LoadImage',
      },
      '2': {
        inputs: { text: '', clip: ['4', 1] },
        class_type: 'CLIPTextEncode',
      },
      '3': {
        inputs: { text: 'ugly, deformed, noise, artifacts', clip: ['4', 1] },
        class_type: 'CLIPTextEncode',
      },
      '4': {
        inputs: { ckpt_name: 'v1-5-pruned-emaonly.safetensors' },
        class_type: 'CheckpointLoaderSimple',
      },
      '5': {
        inputs: { pixels: ['1', 0], vae: ['4', 2] },
        class_type: 'VAEEncode',
      },
      '6': {
        inputs: {
          seed: 123456789,
          steps: 20,
          cfg: 7.0,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 0.65,
          model: ['4', 0],
          positive: ['2', 0],
          negative: ['3', 0],
          latent_image: ['5', 0],
        },
        class_type: 'KSampler',
      },
      '7': {
        inputs: { samples: ['6', 0], vae: ['4', 2] },
        class_type: 'VAEDecode',
      },
      '8': {
        inputs: { filename_prefix: 'FreeCut_VFX', images: ['7', 0] },
        class_type: 'SaveImage',
      },
    },
  },

  model3d: {
    id: 'model3d',
    label: 'Modelo 3D (.glb)',
    workflowName: 'Preset_Model3D_TripoSR.json',
    isCustom: false,
    bindings: {
      inputMediaNodeId: '1',
      positivePromptNodeId: '2',
      positivePromptInputKey: 'text',
      outputNodeId: '3',
    },
    rawWorkflow: {
      '1': {
        inputs: { image: 'input.png', upload: 'image' },
        class_type: 'LoadImage',
      },
      '2': {
        inputs: { text: '' },
        class_type: 'CLIPTextEncode',
      },
      '3': {
        inputs: { image: ['1', 0], filename_prefix: 'FreeCut_3D' },
        class_type: 'SaveGLTF',
      },
    },
  },

  transcription: {
    id: 'transcription',
    label: 'Transcripción de Audio a Texto',
    workflowName: 'Preset_Transcription_Whisper.json',
    isCustom: false,
    bindings: {
      inputMediaNodeId: '1',
      outputNodeId: '2',
    },
    rawWorkflow: {
      '1': {
        inputs: { audio: 'input_audio.wav', upload: 'audio' },
        class_type: 'LoadAudio',
      },
      '2': {
        inputs: {
          audio: ['1', 0],
          model_name: 'openai/whisper-large-v3-turbo',
          language: 'auto',
        },
        class_type: 'WhisperTranscribeAudio',
      },
    },
  },
}

