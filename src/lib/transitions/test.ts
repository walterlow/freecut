/**
 * Transition System Test
 * 
 * Simple test component to verify transitions are rendering correctly.
 * Run this test to confirm the transition system is working.
 */

import type { Transition, WipeDirection } from '@/types/transition';
import type { VideoItem } from '@/types/timeline';
import { calculateEasingCurve, calculateTransitionStyles, findActiveTransitions, buildClipMap } from './engine';

// Test data
const testTransition: Transition = {
  id: 'test-transition-1',
  type: 'crossfade',
  presentation: 'fade',
  timing: 'linear',
  leftClipId: 'clip-left',
  rightClipId: 'clip-right',
  trackId: 'track-1',
  durationInFrames: 30,
};

const testWipeTransition: Transition = {
  id: 'test-transition-2',
  type: 'crossfade',
  presentation: 'wipe',
  timing: 'linear',
  leftClipId: 'clip-left',
  rightClipId: 'clip-right',
  trackId: 'track-1',
  durationInFrames: 30,
  direction: 'from-left' as WipeDirection,
};

const leftClip: VideoItem = {
  id: 'clip-left',
  type: 'video',
  from: 0,
  durationInFrames: 60,
  trackId: 'track-1',
  src: 'test-video.mp4',
  sourceStart: 0,
  trimStart: 0,
  trimEnd: 60,
  speed: 1,
  label: 'Left Clip',
};

const rightClip: VideoItem = {
  id: 'clip-right',
  type: 'video',
  from: 60,
  durationInFrames: 60,
  trackId: 'track-1',
  src: 'test-video.mp4',
  sourceStart: 0,
  trimStart: 0,
  trimEnd: 60,
  speed: 1,
  label: 'Right Clip',
};

/**
 * Run all transition system tests
 */
export function runTransitionTests(): { passed: number; failed: number; results: string[] } {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => boolean): void {
    try {
      const result = fn();
      if (result) {
        passed++;
        results.push(`✅ ${name}`);
      } else {
        failed++;
        results.push(`❌ ${name}`);
      }
    } catch (error) {
      failed++;
      results.push(`❌ ${name} - Error: ${error}`);
    }
  }

  // Test 1: Easing curve calculation
  test('Easing curve calculation', () => {
    const curve = calculateEasingCurve({
      timing: 'linear',
      fps: 30,
      durationInFrames: 30,
    });
    return curve.length === 30 && curve[0] === 0 && curve[29] === 1;
  });

  // Test 2: Fade transition styles
  test('Fade transition - outgoing opacity at start', () => {
    const styles = calculateTransitionStyles(testTransition, 0, true, 1920, 1080);
    return styles.opacity === 1;
  });

  test('Fade transition - outgoing opacity at end', () => {
    const styles = calculateTransitionStyles(testTransition, 1, true, 1920, 1080);
    return Math.abs(styles.opacity! - 0) < 0.01;
  });

  test('Fade transition - incoming opacity at start', () => {
    const styles = calculateTransitionStyles(testTransition, 0, false, 1920, 1080);
    return Math.abs(styles.opacity! - 0) < 0.01;
  });

  test('Fade transition - incoming opacity at end', () => {
    const styles = calculateTransitionStyles(testTransition, 1, false, 1920, 1080);
    return styles.opacity === 1;
  });

  // Test 3: Wipe transition
  test('Wipe transition - outgoing clipPath at start', () => {
    const styles = calculateTransitionStyles(testWipeTransition, 0, true, 1920, 1080);
    return styles.clipPath === 'inset(0 0 0 0%)';
  });

  test('Wipe transition - outgoing clipPath at end', () => {
    const styles = calculateTransitionStyles(testWipeTransition, 1, true, 1920, 1080);
    return styles.clipPath === 'inset(0 0 0 100%)';
  });

  // Test 4: Active transition detection
  test('Active transition detection at cut point', () => {
    const clipMap = buildClipMap([leftClip, rightClip]);
    const active = findActiveTransitions([testTransition], clipMap, 60, 30);
    return active.length === 1 && active[0]!.isInTransition;
  });

  test('Active transition detection before transition', () => {
    const clipMap = buildClipMap([leftClip, rightClip]);
    const active = findActiveTransitions([testTransition], clipMap, 30, 30);
    return active.length === 0;
  });

  test('Active transition detection after transition', () => {
    const clipMap = buildClipMap([leftClip, rightClip]);
    const active = findActiveTransitions([testTransition], clipMap, 90, 30);
    return active.length === 0;
  });

  // Test 5: Spring timing
  test('Spring timing produces curve', () => {
    const curve = calculateEasingCurve({
      timing: 'spring',
      fps: 30,
      durationInFrames: 30,
    });
    return curve.length === 30 && curve[0] === 0;
  });

  return { passed, failed, results };
}

/**
 * Console test runner
 */
export function runTestsInConsole(): void {
  console.log('🧪 Running Transition System Tests...\n');
  
  const { passed, failed, results } = runTransitionTests();
  
  results.forEach(result => console.log(result));
  
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log('✨ All tests passed! Transition system is working correctly.\n');
  } else {
    console.log('⚠️  Some tests failed. Please check the implementation.\n');
  }
}

// Auto-run tests in development
if (import.meta.env.DEV) {
  runTestsInConsole();
}
