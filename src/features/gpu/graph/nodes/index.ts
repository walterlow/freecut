/**
 * Built-in shader graph node registration.
 */

import { NodeRegistry, globalRegistry } from '../node-registry';
import {
  createTextureSourceNode,
  createColorSourceNode,
  createGradientSourceNode,
} from './source-node';
import {
  createBrightnessNode,
  createContrastNode,
  createSaturationNode,
  createOpacityNode,
  createBrightnessContrastNode,
} from './effect-nodes';
import { createBlurNode, createGaussianBlurNode, createFastBlurNode } from './blur-node';
import {
  createBlendNode,
  createNormalBlendNode,
  createMultiplyBlendNode,
  createScreenBlendNode,
  createOverlayBlendNode,
  createAddBlendNode,
  createSubtractBlendNode,
  createDifferenceBlendNode,
  createDarkenBlendNode,
  createLightenBlendNode,
  createColorDodgeBlendNode,
  createColorBurnBlendNode,
  createHardLightBlendNode,
  createSoftLightBlendNode,
} from './blend-node';
import {
  createTransformNode,
  createScaleNode,
  createRotateNode,
  createTranslateNode,
  createFlipNode,
  createCropNode,
} from './transform-node';
import {
  createOutputNode,
  createExportOutputNode,
  createPreviewOutputNode,
} from './output-node';

/**
 * Register all built-in nodes with a registry.
 */
export function registerBuiltinNodes(registry: NodeRegistry = globalRegistry): void {
  registry.register('texture-source', createTextureSourceNode);
  registry.register('color-source', createColorSourceNode);
  registry.register('gradient-source', createGradientSourceNode);

  registry.register('brightness', createBrightnessNode);
  registry.register('contrast', createContrastNode);
  registry.register('saturation', createSaturationNode);
  registry.register('opacity', createOpacityNode);
  registry.register('brightness-contrast', createBrightnessContrastNode);

  registry.register('blur', createBlurNode);
  registry.register('gaussian-blur', createGaussianBlurNode);
  registry.register('fast-blur', createFastBlurNode);

  registry.register('blend', createBlendNode);
  registry.register('normal-blend', createNormalBlendNode);
  registry.register('multiply-blend', createMultiplyBlendNode);
  registry.register('screen-blend', createScreenBlendNode);
  registry.register('overlay-blend', createOverlayBlendNode);
  registry.register('add-blend', createAddBlendNode);
  registry.register('subtract-blend', createSubtractBlendNode);
  registry.register('difference-blend', createDifferenceBlendNode);
  registry.register('darken-blend', createDarkenBlendNode);
  registry.register('lighten-blend', createLightenBlendNode);
  registry.register('color-dodge-blend', createColorDodgeBlendNode);
  registry.register('color-burn-blend', createColorBurnBlendNode);
  registry.register('hard-light-blend', createHardLightBlendNode);
  registry.register('soft-light-blend', createSoftLightBlendNode);

  registry.register('transform', createTransformNode);
  registry.register('scale', createScaleNode);
  registry.register('rotate', createRotateNode);
  registry.register('translate', createTranslateNode);
  registry.register('flip', createFlipNode);
  registry.register('crop', createCropNode);

  registry.register('output', createOutputNode);
  registry.register('export-output', createExportOutputNode);
  registry.register('preview-output', createPreviewOutputNode);
}
